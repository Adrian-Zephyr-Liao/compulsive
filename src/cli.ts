import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import mri from "mri";

import { copyTextToClipboard } from "./clipboard.js";
import { CompulsiveError, type CompulsiveErrorCode } from "./errors.js";
import {
  loadCompulsiveConfig,
  type CompulsiveFileConfig,
  type LoadedCompulsiveConfig,
} from "./file-config.js";
import { runGit } from "./git.js";
import { createRepositoryManager } from "./manager.js";
import { formatCdCommand } from "./shell.js";
import {
  confirmAction,
  createTerminalTheme,
  selectRepository,
  withSpinner,
  type TerminalTheme,
} from "./terminal.js";
import type { ManagerConfig, OrganizePlan, RepositoryManager, RepositoryRecord } from "./types.js";

const helpText = `Compulsive — safely organize local Git repositories

Usage:
  cpl [--config <path>] [--color | --no-color] <command>
  cpl init [--root <path>]
  cpl clone <git-url> [--depth <number>]
  cpl add <path>
  cpl scan [paths...] [--register]
  cpl list [query] [--json]
  cpl go <query> [--json]
  cpl organize <query> [--dry-run | --yes] [--json]
  cpl organize --all [--dry-run | --yes] [--json]
  cpl forget <query> [--yes]
  cpl config [show | file | set-root <path> | add-scan-root <path> | remove-scan-root <path>]
  cpl doctor [--json]

Compulsive never deletes repository files.`;

const booleanFlags = ["json", "register", "dry-run", "yes", "help", "color", "all"];
const valueFlags = ["root", "depth", "config"];

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
  isTTY: boolean;
  fileConfig: CompulsiveFileConfig;
  configPath?: string;
  theme: TerminalTheme;
  chooseRepository(
    message: string,
    repositories: RepositoryRecord[],
  ): Promise<RepositoryRecord | undefined>;
  confirm(message: string): Promise<boolean | undefined>;
  runTask<T>(message: string, task: () => Promise<T>): Promise<T>;
}

function createDefaultContext(loaded: LoadedCompulsiveConfig = { config: {} }): CliContext {
  const isTTY = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  return {
    manager: createRepositoryManager(
      loaded.config.rootDir === undefined ? {} : { defaultRootDir: loaded.config.rootDir },
    ),
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
    copyText: copyTextToClipboard,
    isTTY,
    fileConfig: loaded.config,
    ...(loaded.path === undefined ? {} : { configPath: loaded.path }),
    theme: createTerminalTheme({
      color: loaded.config.ui?.color ?? "auto",
      unicode: loaded.config.ui?.unicode ?? true,
      isTTY,
    }),
    chooseRepository: selectRepository,
    confirm: confirmAction,
    runTask: withSpinner,
  };
}

function parseArguments(argv: string[]): ParsedArguments {
  const separatorIndex = argv.indexOf("--");
  const options = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const trailingPositionals = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  let unknownFlag: string | undefined;
  const result = mri(options, {
    alias: {
      ...Object.fromEntries([...booleanFlags, ...valueFlags].map((name) => [name, []])),
      h: "help",
    },
    boolean: booleanFlags,
    string: valueFlags,
    unknown(flag) {
      unknownFlag = flag;
    },
  });
  if (unknownFlag) throw new CompulsiveError("INVALID_INPUT", `Unknown flag: ${unknownFlag}`);

  const positionals = [...result._, ...trailingPositionals];
  const command = result.help ? "help" : (positionals.shift() ?? "help");
  const flags = new Set(booleanFlags.filter((name) => result[name] === true && name !== "color"));
  if (result.color === true) flags.add("color");
  if (result.color === false) flags.add("no-color");
  const values = new Map<string, string>();
  for (const name of valueFlags) {
    const value: unknown = result[name];
    if (value === "") {
      throw new CompulsiveError("INVALID_INPUT", `Flag --${name} requires a value.`);
    }
    if (typeof value === "string") values.set(name, value);
  }
  return { command, positionals, flags, values };
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

function describeRecord(record: RepositoryRecord, context: CliContext): string {
  return context.theme.repository(record.classificationPath, record.absolutePath);
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
  const selected = await context.chooseRepository("Choose a repository", matches);
  if (!selected) throw new CompulsiveError("INVALID_INPUT", "Repository selection cancelled.");
  return selected;
}

interface BatchOrganizeItem {
  record: RepositoryRecord;
  plan: OrganizePlan;
}

async function planAllRepositories(manager: RepositoryManager): Promise<BatchOrganizeItem[]> {
  const records = await manager.search();
  const items: BatchOrganizeItem[] = [];
  const targets = new Map<string, RepositoryRecord>();
  for (const record of records) {
    const plan = await manager.planOrganize(record.id);
    const existing = targets.get(plan.target);
    if (existing) {
      throw new CompulsiveError(
        "CONFLICT",
        `Repositories ${existing.classificationPath} and ${record.classificationPath} share the same organize target: ${plan.target}`,
      );
    }
    targets.set(plan.target, record);
    items.push({ record, plan });
  }
  return items;
}

function printBatchPlan(items: BatchOrganizeItem[], context: CliContext): void {
  for (const { record, plan } of items) {
    context.stdout(
      `${record.classificationPath}\n${context.theme.transition(plan.source, plan.target)}`,
    );
    for (const warning of plan.warnings) {
      context.stderr(context.theme.warning(`${record.classificationPath}: ${warning}`));
    }
  }
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
    context.stderr(context.theme.warning("Unable to copy the cd command; it is printed below."));
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
  if (action === "file") {
    printValue(
      context,
      json
        ? { path: context.configPath ?? null, config: context.fileConfig }
        : (context.configPath ?? "No compulsive.config file is active."),
      json,
    );
    return;
  } else if (action === "show") {
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
      context.stdout(context.theme.check(check.ok, check.name, check.detail)),
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
      const rootDir = parsed.values.get("root") ?? context.fileConfig.rootDir;
      const scanRoots = context.fileConfig.scanRoots;
      const config = await context.manager.initialize({
        ...(rootDir === undefined ? {} : { rootDir }),
        ...(scanRoots === undefined ? {} : { scanRoots }),
      });
      printValue(
        context,
        json ? config : context.theme.success("Initialized", config.rootDir),
        json,
      );
      return;
    }
    case "clone": {
      const remote = requireValue(parsed.positionals[0], "Git remote");
      const depthValue = parsed.values.get("depth");
      const task = () =>
        context.manager.clone({
          remote,
          ...(depthValue === undefined ? {} : { depth: Number(depthValue) }),
        });
      const record = allowPrompt ? await context.runTask("Cloning repository", task) : await task();
      await outputCd(record, context, json);
      return;
    }
    case "add": {
      const record = await context.manager.register({
        path: requireValue(parsed.positionals[0], "Repository path"),
      });
      printValue(context, json ? record : describeRecord(record, context), json);
      return;
    }
    case "scan": {
      const task = () =>
        context.manager.discover(
          parsed.positionals.length > 0 ? { paths: parsed.positionals } : {},
        );
      const result = allowPrompt
        ? await context.runTask("Scanning repositories", task)
        : await task();
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
              ? describeRecord(item, context)
              : context.theme.repository(item.classificationPath, item.absolutePath),
          ),
        );
      return;
    }
    case "list": {
      const records = await context.manager.search({ query: parsed.positionals.join(" ") });
      if (json) printValue(context, records, true);
      else records.forEach((record) => context.stdout(describeRecord(record, context)));
      return;
    }
    case "go": {
      const query = requireValue(parsed.positionals.join(" "), "Repository query");
      await outputCd(await selectOne(context.manager, query, context, allowPrompt), context, json);
      return;
    }
    case "organize": {
      if (parsed.flags.has("dry-run") && parsed.flags.has("yes")) {
        throw new CompulsiveError("INVALID_INPUT", "Use either --dry-run or --yes, not both.");
      }
      if (parsed.flags.has("all")) {
        if (parsed.positionals.length > 0) {
          throw new CompulsiveError(
            "INVALID_INPUT",
            "A repository query cannot be combined with --all.",
          );
        }
        const items = await planAllRepositories(context.manager);
        if (json && parsed.flags.has("dry-run")) {
          printValue(
            context,
            items.map((item) => item.plan),
            true,
          );
          return;
        }
        if (!json) printBatchPlan(items, context);
        if (parsed.flags.has("dry-run")) return;
        if (!parsed.flags.has("yes")) {
          if (!allowPrompt) {
            throw new CompulsiveError(
              "INVALID_INPUT",
              "Use --yes to organize all repositories non-interactively.",
            );
          }
          const moveCount = items.filter((item) => !item.plan.isNoop).length;
          const confirmed = await context.confirm(
            `Organize ${String(moveCount)} repositories into the managed root?`,
          );
          if (!confirmed) {
            throw new CompulsiveError("INVALID_INPUT", "Organization cancelled.");
          }
        }
        const organizeAll = async () => {
          const organized: RepositoryRecord[] = [];
          for (const item of items) {
            organized.push(
              item.plan.isNoop ? item.record : await context.manager.organize(item.plan),
            );
          }
          return organized;
        };
        const organized = allowPrompt
          ? await context.runTask("Organizing repositories", organizeAll)
          : await organizeAll();
        if (json) printValue(context, organized, true);
        else {
          const moveCount = items.filter((item) => !item.plan.isNoop).length;
          const noopCount = items.length - moveCount;
          context.stdout(
            context.theme.success(
              `Organized ${String(moveCount)} repositories`,
              noopCount === 0
                ? undefined
                : `${String(noopCount)} repositories were already organized.`,
            ),
          );
        }
        return;
      }
      const query = requireValue(parsed.positionals.join(" "), "Repository query");
      const record = await selectOne(context.manager, query, context, allowPrompt);
      const plan = await context.manager.planOrganize(record.id);
      if (!json) {
        plan.warnings.forEach((warning) => context.stderr(context.theme.warning(warning)));
      }
      if (parsed.flags.has("dry-run")) {
        printValue(context, json ? plan : context.theme.transition(plan.source, plan.target), json);
        return;
      }
      if (!parsed.flags.has("yes")) {
        if (!allowPrompt) {
          throw new CompulsiveError("INVALID_INPUT", "Use --yes to organize non-interactively.");
        }
        const confirmed = await context.confirm(`Move ${plan.source} to ${plan.target}?`);
        if (!confirmed) {
          throw new CompulsiveError("INVALID_INPUT", "Organization cancelled.");
        }
      }
      const organizeTask = () => context.manager.organize(plan);
      const organized = allowPrompt
        ? await context.runTask("Organizing repository", organizeTask)
        : await organizeTask();
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
        const confirmed = await context.confirm(`Forget ${record.name} without deleting files?`);
        if (!confirmed) {
          throw new CompulsiveError("INVALID_INPUT", "Forget cancelled.");
        }
      }
      await context.manager.forget(record.id);
      context.stdout(
        context.theme.success(`Forgot ${record.name}`, "Repository files were not deleted."),
      );
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
  let context = { ...createDefaultContext(), ...overrides };
  const json = argv.includes("--json");
  try {
    const parsed = parseArguments(argv);
    const configPath = parsed.values.get("config");
    const loaded = await loadCompulsiveConfig(configPath === undefined ? {} : { configPath });
    context = { ...createDefaultContext(loaded), ...overrides };
    if (!("theme" in overrides)) {
      context.theme = createTerminalTheme({
        color: parsed.flags.has("no-color")
          ? "never"
          : parsed.flags.has("color")
            ? "always"
            : (context.fileConfig.ui?.color ?? "auto"),
        unicode: context.fileConfig.ui?.unicode ?? true,
        isTTY: context.isTTY,
      });
    }
    await dispatch(parsed, context);
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
        : context.theme.error(failure.code, failure.message),
    );
    return exitCodeFor(failure);
  }
}
