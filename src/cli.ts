import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { copyTextToClipboard } from "./clipboard.js";
import { CompulsiveError, type CompulsiveErrorCode } from "./errors.js";
import { runGit } from "./git.js";
import { createRepositoryManager } from "./manager.js";
import { formatCdCommand } from "./shell.js";
import type { ManagerConfig, RepositoryManager, RepositoryRecord } from "./types.js";

const helpText = `Compulsive — safely organize local Git repositories

Usage:
  cpl init [--root <path>]
  cpl clone <git-url> [--depth <number>]
  cpl add <path>
  cpl scan [paths...] [--register]
  cpl list [query] [--json]
  cpl go <query> [--json]
  cpl organize <query> [--dry-run | --yes] [--json]
  cpl forget <query> [--yes]
  cpl config [show | set-root <path> | add-scan-root <path> | remove-scan-root <path>]
  cpl doctor [--json]

Compulsive never deletes repository files.`;

const booleanFlags = new Set(["json", "register", "dry-run", "yes", "help"]);
const valueFlags = new Set(["root", "depth"]);

interface ParsedArguments {
  command: string;
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

export interface CliContext {
  manager: RepositoryManager;
  stdout(value: string): void;
  stderr(value: string): void;
  copyText(value: string): Promise<void>;
  prompt(question: string): Promise<string>;
  isTTY: boolean;
}

function defaultPrompt(question: string): Promise<string> {
  const interface_ = createInterface({ input: process.stdin, output: process.stderr });
  return interface_.question(question).finally(() => interface_.close());
}

function createDefaultContext(): CliContext {
  return {
    manager: createRepositoryManager(),
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
    copyText: copyTextToClipboard,
    prompt: defaultPrompt,
    isTTY: Boolean(process.stdin.isTTY && process.stderr.isTTY),
  };
}

function parseArguments(argv: string[]): ParsedArguments {
  const [command = "help", ...arguments_] = argv;
  const parsed: ParsedArguments = {
    command,
    positionals: [],
    flags: new Set(),
    values: new Map(),
  };
  let positionalOnly = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index]!;
    if (argument === "--") {
      positionalOnly = true;
      continue;
    }
    if (!positionalOnly && argument.startsWith("--")) {
      const [rawName, inlineValue] = argument.slice(2).split("=", 2);
      const name = rawName!;
      if (booleanFlags.has(name)) {
        if (inlineValue !== undefined) {
          throw new CompulsiveError("INVALID_INPUT", `Flag --${name} does not accept a value.`);
        }
        parsed.flags.add(name);
        continue;
      }
      if (valueFlags.has(name)) {
        const value = inlineValue ?? arguments_[index + 1];
        if (!value || (inlineValue === undefined && value.startsWith("--"))) {
          throw new CompulsiveError("INVALID_INPUT", `Flag --${name} requires a value.`);
        }
        parsed.values.set(name, value);
        if (inlineValue === undefined) index += 1;
        continue;
      }
      throw new CompulsiveError("INVALID_INPUT", `Unknown flag: --${name}`);
    }
    parsed.positionals.push(argument);
  }
  return parsed;
}

function requireValue(value: string | undefined, label: string): string {
  if (!value) throw new CompulsiveError("INVALID_INPUT", `${label} is required.`);
  return value;
}

function exitCodeFor(error: CompulsiveError): number {
  const mapping: Partial<Record<CompulsiveErrorCode, number>> = {
    INVALID_INPUT: 2,
    INVALID_REMOTE: 2,
    NOT_INITIALIZED: 2,
    NOT_FOUND: 3,
    AMBIGUOUS_MATCH: 4,
    CONFLICT: 4,
    GIT_FAILED: 5,
    FILESYSTEM_FAILED: 5,
  };
  return mapping[error.code] ?? 5;
}

function printValue(context: CliContext, value: unknown, json: boolean): void {
  context.stdout(json ? JSON.stringify(value) : String(value));
}

function describeRecord(record: RepositoryRecord): string {
  return `${record.classificationPath}\t${record.absolutePath}`;
}

async function selectOne(
  manager: RepositoryManager,
  query: string,
  context: CliContext,
  allowPrompt: boolean,
): Promise<RepositoryRecord> {
  const matches = await manager.search({ query });
  if (matches.length === 0) {
    throw new CompulsiveError("NOT_FOUND", `No repository matches: ${query}`);
  }
  if (matches.length === 1) return matches[0]!;
  if (!allowPrompt) {
    throw new CompulsiveError(
      "AMBIGUOUS_MATCH",
      `Multiple repositories match "${query}": ${matches.map((item) => item.name).join(", ")}`,
    );
  }
  matches.forEach((record, index) =>
    context.stderr(`${String(index + 1)}. ${describeRecord(record)}`),
  );
  const answer = Number.parseInt(await context.prompt("Choose a repository number: "), 10);
  const selected = matches[answer - 1];
  if (!selected) throw new CompulsiveError("INVALID_INPUT", "Invalid repository selection.");
  return selected;
}

async function outputCd(
  record: RepositoryRecord,
  context: CliContext,
  json: boolean,
): Promise<void> {
  const command = formatCdCommand(record.absolutePath);
  let copied = true;
  try {
    await context.copyText(command);
  } catch {
    copied = false;
    context.stderr("Warning: unable to copy the cd command; it is printed below.");
  }
  if (json) printValue(context, { repository: record, cdCommand: command, copied }, true);
  else context.stdout(command);
}

async function handleConfig(
  parsed: ParsedArguments,
  context: CliContext,
  json: boolean,
): Promise<void> {
  const [action = "show", value] = parsed.positionals;
  let config: ManagerConfig;
  if (action === "show") {
    config = await context.manager.getConfig();
  } else if (action === "set-root") {
    config = await context.manager.updateConfig({ rootDir: requireValue(value, "Root path") });
  } else if (action === "add-scan-root" || action === "remove-scan-root") {
    const scanRoot = requireValue(value, "Scan root");
    const normalizedScanRoot = resolve(scanRoot);
    const current = await context.manager.getConfig();
    const roots =
      action === "add-scan-root"
        ? [...new Set([...current.scanRoots, normalizedScanRoot])]
        : current.scanRoots.filter((item) => item !== normalizedScanRoot);
    config = await context.manager.updateConfig({ scanRoots: roots });
  } else {
    throw new CompulsiveError("INVALID_INPUT", `Unknown config action: ${action}`);
  }
  printValue(context, json ? config : JSON.stringify(config, undefined, 2), json);
}

async function handleDoctor(context: CliContext, json: boolean): Promise<void> {
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  try {
    const git = await runGit(["--version"]);
    checks.push({ name: "git", ok: true, detail: git.stdout });
  } catch (error) {
    checks.push({ name: "git", ok: false, detail: String(error) });
  }
  try {
    const config = await context.manager.getConfig();
    await access(config.rootDir, constants.W_OK);
    await context.manager.search();
    checks.push({ name: "storage", ok: true, detail: config.rootDir });
  } catch (error) {
    checks.push({ name: "storage", ok: false, detail: String(error) });
  }
  try {
    if (process.platform !== "darwin") throw new Error("macOS only in v1");
    await access("/usr/bin/pbcopy", constants.X_OK);
    checks.push({ name: "clipboard", ok: true, detail: "/usr/bin/pbcopy" });
  } catch (error) {
    checks.push({ name: "clipboard", ok: false, detail: String(error) });
  }
  if (json) printValue(context, checks, true);
  else
    checks.forEach((check) =>
      context.stdout(`${check.ok ? "PASS" : "FAIL"}\t${check.name}\t${check.detail}`),
    );
  if (checks.some((check) => !check.ok)) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "One or more doctor checks failed.", checks);
  }
}

async function dispatch(parsed: ParsedArguments, context: CliContext): Promise<void> {
  const json = parsed.flags.has("json");
  const allowPrompt = context.isTTY && !json;
  switch (parsed.command) {
    case "help":
    case "--help":
    case "-h": {
      context.stdout(helpText);
      return;
    }
    case "init": {
      const rootDir = parsed.values.get("root");
      const config = await context.manager.initialize(rootDir === undefined ? {} : { rootDir });
      printValue(context, json ? config : `Initialized ${config.rootDir}`, json);
      return;
    }
    case "clone": {
      const remote = requireValue(parsed.positionals[0], "Git remote");
      const depthValue = parsed.values.get("depth");
      const record = await context.manager.clone({
        remote,
        ...(depthValue === undefined ? {} : { depth: Number(depthValue) }),
      });
      await outputCd(record, context, json);
      return;
    }
    case "add": {
      const record = await context.manager.register({
        path: requireValue(parsed.positionals[0], "Repository path"),
      });
      printValue(context, json ? record : describeRecord(record), json);
      return;
    }
    case "scan": {
      const result = await context.manager.discover(
        parsed.positionals.length > 0 ? { paths: parsed.positionals } : {},
      );
      let output: Array<RepositoryRecord | (typeof result.repositories)[number]> =
        result.repositories;
      if (parsed.flags.has("register")) {
        const registered: RepositoryRecord[] = [];
        for (const repository of result.repositories) {
          registered.push(await context.manager.register({ path: repository.absolutePath }));
        }
        output = registered;
      }
      if (json) printValue(context, output, true);
      else
        output.forEach((item) =>
          context.stdout(
            "id" in item
              ? describeRecord(item)
              : `${item.classificationPath}\t${item.absolutePath}`,
          ),
        );
      return;
    }
    case "list": {
      const records = await context.manager.search({ query: parsed.positionals.join(" ") });
      if (json) printValue(context, records, true);
      else records.forEach((record) => context.stdout(describeRecord(record)));
      return;
    }
    case "go": {
      const query = requireValue(parsed.positionals.join(" "), "Repository query");
      await outputCd(await selectOne(context.manager, query, context, allowPrompt), context, json);
      return;
    }
    case "organize": {
      const query = requireValue(parsed.positionals.join(" "), "Repository query");
      const record = await selectOne(context.manager, query, context, allowPrompt);
      const plan = await context.manager.planOrganize(record.id);
      if (!json) {
        plan.warnings.forEach((warning) => context.stderr(`Warning: ${warning}`));
      }
      if (parsed.flags.has("dry-run")) {
        printValue(context, json ? plan : `${plan.source} -> ${plan.target}`, json);
        return;
      }
      if (!parsed.flags.has("yes")) {
        if (!allowPrompt) {
          throw new CompulsiveError("INVALID_INPUT", "Use --yes to organize non-interactively.");
        }
        const answer = await context.prompt(`Move ${plan.source} to ${plan.target}? [y/N] `);
        if (!/^y(?:es)?$/i.test(answer.trim())) {
          throw new CompulsiveError("INVALID_INPUT", "Organization cancelled.");
        }
      }
      const organized = await context.manager.organize(plan);
      await outputCd(organized, context, json);
      return;
    }
    case "forget": {
      const query = requireValue(parsed.positionals.join(" "), "Repository query");
      const record = await selectOne(context.manager, query, context, allowPrompt);
      if (!parsed.flags.has("yes")) {
        if (!allowPrompt) {
          throw new CompulsiveError("INVALID_INPUT", "Use --yes to forget non-interactively.");
        }
        const answer = await context.prompt(`Forget ${record.name} without deleting files? [y/N] `);
        if (!/^y(?:es)?$/i.test(answer.trim())) {
          throw new CompulsiveError("INVALID_INPUT", "Forget cancelled.");
        }
      }
      await context.manager.forget(record.id);
      context.stdout(`Forgot ${record.name}; files were not deleted.`);
      return;
    }
    case "config": {
      await handleConfig(parsed, context, json);
      return;
    }
    case "doctor": {
      await handleDoctor(context, json);
      return;
    }
    default:
      throw new CompulsiveError("INVALID_INPUT", `Unknown command: ${parsed.command}`);
  }
}

export async function runCli(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const context = { ...createDefaultContext(), ...overrides };
  const json = argv.includes("--json");
  try {
    await dispatch(parseArguments(argv), context);
    return 0;
  } catch (error) {
    const failure =
      error instanceof CompulsiveError
        ? error
        : new CompulsiveError(
            "FILESYSTEM_FAILED",
            error instanceof Error ? error.message : String(error),
          );
    context.stderr(
      json
        ? JSON.stringify({ error: { code: failure.code, message: failure.message } })
        : `${failure.code}: ${failure.message}`,
    );
    return exitCodeFor(failure);
  }
}
