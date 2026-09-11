import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import mri from "mri";

import { copyTextToClipboard } from "./clipboard.js";
import { CompulsiveError, type CompulsiveErrorCode } from "./errors.js";
import { runGit } from "./git.js";
import { createRepositoryManager } from "./manager.js";
import { formatCdCommand } from "./shell.js";
import {
  confirmAction,
  createTerminalTheme,
  formatCount,
  helpText,
  renderOrganizePlan,
  renderRepositoryCollection,
  renderWorkspaceCollection,
  selectNavigationTarget,
  selectRepository,
  selectWorkspace,
  withSpinner,
  type NavigationTarget,
  type TerminalTheme,
} from "./terminal.js";
import type {
  ManagerConfig,
  OrganizePlan,
  RepositoryManager,
  RepositoryRecord,
  WorkspaceRecord,
} from "./types.js";

const booleanFlags = [
  "json",
  "register",
  "dry-run",
  "yes",
  "help",
  "color",
  "all",
  "worktree",
  "create-branch",
];
const valueFlags = ["root", "depth", "path", "alias", "branch", "workspace"];

interface ParsedArguments {
  command: string;
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

class CliCancelled extends Error {}

export interface CliContext {
  manager: RepositoryManager;
  stdout(value: string): void;
  stderr(value: string): void;
  copyText(value: string): Promise<void>;
  isTTY: boolean;
  theme: TerminalTheme;
  chooseRepository(
    message: string,
    repositories: RepositoryRecord[],
  ): Promise<RepositoryRecord | undefined>;
  chooseWorkspace(
    message: string,
    workspaces: WorkspaceRecord[],
  ): Promise<WorkspaceRecord | undefined>;
  chooseDestination(
    message: string,
    targets: NavigationTarget[],
  ): Promise<NavigationTarget | undefined>;
  confirm(message: string): Promise<boolean | undefined>;
  runTask<T>(message: string, task: () => Promise<T>): Promise<T>;
}

function createDefaultContext(): CliContext {
  const isTTY = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  return {
    manager: createRepositoryManager(),
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
    copyText: copyTextToClipboard,
    isTTY,
    theme: createTerminalTheme({
      color: "auto",
      unicode: true,
      isTTY,
    }),
    chooseRepository: selectRepository,
    chooseWorkspace: selectWorkspace,
    chooseDestination: selectNavigationTarget,
    confirm: confirmAction,
    runTask: withSpinner,
  };
}

function parseArguments(argv: string[]): ParsedArguments {
  const separatorIndex = argv.indexOf("--");
  const options = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const trailingPositionals = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const result = mri(options, {
    alias: {
      ...Object.fromEntries([...booleanFlags, ...valueFlags].map((name) => [name, []])),
      h: "help",
    },
    boolean: [...booleanFlags],
    string: [...valueFlags],
    unknown(flag) {
      throw new CompulsiveError("INVALID_INPUT", `Unknown flag: ${flag}`);
    },
  });

  const positionals = [...result._, ...trailingPositionals];
  const command = result.help ? "help" : (positionals.shift() ?? "");
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

function describeWorkspace(workspace: WorkspaceRecord, context: CliContext): string {
  return context.theme.workspace(workspace.name, workspace.absolutePath, workspace.members.length);
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
  const normalizedQuery = query.trim().toLowerCase();
  const exact = matches.find((record) =>
    [record.id, record.name, record.classificationPath, record.absolutePath].some(
      (value) => value.toLowerCase() === normalizedQuery,
    ),
  );
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  if (!allowPrompt) {
    throw new CompulsiveError(
      "AMBIGUOUS_MATCH",
      `Multiple repositories match "${query}": ${matches.map((item) => item.name).join(", ")}`,
    );
  }
  const selected = await context.chooseRepository("Choose a repository", matches);
  if (!selected) throw new CliCancelled();
  return selected;
}

async function selectOneWorkspace(
  manager: RepositoryManager,
  query: string,
  context: CliContext,
  allowPrompt: boolean,
): Promise<WorkspaceRecord> {
  const matches = await manager.searchWorkspaces({ query });
  if (matches.length === 0) {
    throw new CompulsiveError("NOT_FOUND", `No workspace matches: ${query}`);
  }
  const normalizedQuery = query.trim().toLowerCase();
  const exact = matches.find((workspace) =>
    [workspace.id, workspace.name, workspace.absolutePath].some(
      (value) => value.toLowerCase() === normalizedQuery,
    ),
  );
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  if (!allowPrompt) {
    throw new CompulsiveError(
      "AMBIGUOUS_MATCH",
      `Multiple workspaces match "${query}": ${matches.map((item) => item.name).join(", ")}`,
    );
  }
  const selected = await context.chooseWorkspace("Choose a workspace", matches);
  if (!selected) throw new CliCancelled();
  return selected;
}

async function repositoriesInWorkspace(
  manager: RepositoryManager,
  workspace: WorkspaceRecord,
  query = "",
): Promise<RepositoryRecord[]> {
  const records = await manager.search();
  const normalizedQuery = query.trim().toLowerCase();
  const memberByRepository = new Map(
    workspace.members.map((member) => [member.repositoryId, member] as const),
  );
  return records.filter((record) => {
    const member = memberByRepository.get(record.id);
    if (!member) return false;
    if (!normalizedQuery) return true;
    return [
      member.alias,
      record.id,
      record.name,
      record.classificationPath,
      record.absolutePath,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

async function selectWorkspaceRepository(
  manager: RepositoryManager,
  workspace: WorkspaceRecord,
  query: string,
  context: CliContext,
  allowPrompt: boolean,
): Promise<RepositoryRecord> {
  const matches = await repositoriesInWorkspace(manager, workspace, query);
  if (matches.length === 0) {
    throw new CompulsiveError("NOT_FOUND", `No workspace repository matches: ${query}`);
  }
  const normalizedQuery = query.trim().toLowerCase();
  const exact = matches.find((record) => {
    const member = workspace.members.find((item) => item.repositoryId === record.id);
    return [
      member?.alias,
      record.id,
      record.name,
      record.classificationPath,
      record.absolutePath,
    ].some((value) => value?.toLowerCase() === normalizedQuery);
  });
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  if (!allowPrompt) {
    throw new CompulsiveError(
      "AMBIGUOUS_MATCH",
      `Multiple workspace repositories match "${query}": ${matches.map((item) => item.name).join(", ")}`,
    );
  }
  const selected = await context.chooseRepository("Choose a workspace repository", matches);
  if (!selected) throw new CliCancelled();
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
  return items.filter((item) => !item.plan.isNoop);
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

async function outputWorkspaceCd(
  workspace: WorkspaceRecord,
  context: CliContext,
  json: boolean,
): Promise<void> {
  const command = formatCdCommand(workspace.absolutePath);
  let copied = true;
  try {
    await context.copyText(command);
  } catch {
    copied = false;
    context.stderr(context.theme.warning("Unable to copy the cd command; it is printed below."));
  }
  if (json) printValue(context, { workspace, cdCommand: command, copied }, true);
  else context.stdout(command);
}

async function openRepositoryPicker(context: CliContext): Promise<void> {
  const records = await context.manager.search();
  if (records.length === 0) {
    context.stdout("No repositories are registered.");
    return;
  }
  const selected = await context.chooseRepository("Search repositories", records);
  if (selected) await outputCd(selected, context, false);
}

async function openWorkspacePicker(context: CliContext): Promise<void> {
  const workspaces = await context.manager.searchWorkspaces();
  if (workspaces.length === 0) {
    context.stdout("No workspaces are registered.");
    return;
  }
  const selected = await context.chooseWorkspace("Search workspaces", workspaces);
  if (selected) await outputWorkspaceCd(selected, context, false);
}

async function openDestinationPicker(context: CliContext): Promise<void> {
  const [repositories, workspaces] = await Promise.all([
    context.manager.search(),
    context.manager.searchWorkspaces(),
  ]);
  const aliasesByRepository = new Map<string, string[]>();
  for (const workspace of workspaces) {
    for (const member of workspace.members) {
      const aliases = aliasesByRepository.get(member.repositoryId) ?? [];
      aliases.push(`${workspace.name}/${member.alias}`);
      aliasesByRepository.set(member.repositoryId, aliases);
    }
  }
  const targets: NavigationTarget[] = [
    ...workspaces.map((workspace) => ({ kind: "workspace" as const, workspace })),
    ...repositories.map((repository) => ({
      kind: "repository" as const,
      repository,
      aliases: aliasesByRepository.get(repository.id) ?? [],
    })),
  ];
  if (targets.length === 0) {
    context.stdout("No repositories or workspaces are registered.");
    return;
  }
  const selected = await context.chooseDestination("Search repositories and workspaces", targets);
  if (!selected) return;
  if (selected.kind === "repository") await outputCd(selected.repository, context, false);
  else await outputWorkspaceCd(selected.workspace, context, false);
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
  } else if (action === "set-workspace-root") {
    config = await context.manager.updateConfig({
      workspaceRoot: requireValue(value, "Workspace root path"),
    });
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

async function gitCommonDirectory(path: string): Promise<string> {
  const result = await runGit(["rev-parse", "--git-common-dir"], { cwd: path });
  return realpath(isAbsolute(result.stdout) ? result.stdout : resolve(path, result.stdout));
}

async function inspectWorkspaceMember(
  workspace: WorkspaceRecord,
  member: WorkspaceRecord["members"][number],
  repositories: RepositoryRecord[],
): Promise<string> {
  const repository = repositories.find((record) => record.id === member.repositoryId);
  if (!repository) throw new Error("Referenced repository is not registered.");
  const memberPath = join(workspace.absolutePath, member.alias);
  const entry = await lstat(memberPath);
  if (member.mode === "link") {
    if (!entry.isSymbolicLink()) throw new Error("Member path is not a symbolic link.");
    const [resolvedMember, resolvedRepository] = await Promise.all([
      realpath(memberPath),
      realpath(repository.absolutePath),
    ]);
    if (resolvedMember !== resolvedRepository) {
      throw new Error("Symbolic link points to a different repository.");
    }
    return `link -> ${resolvedRepository}`;
  }

  const legacy = resolve(member.worktreePath) === resolve(memberPath);
  if (!legacy) {
    const expectedPath = join(repository.absolutePath, ".worktrees", workspace.name);
    if (resolve(member.worktreePath) !== resolve(expectedPath)) {
      throw new Error("Managed worktree path does not match workspace metadata.");
    }
    if (!entry.isSymbolicLink()) throw new Error("Member path is not a symbolic link.");
    if ((await realpath(memberPath)) !== (await realpath(member.worktreePath))) {
      throw new Error("Symbolic link points to a different worktree.");
    }
  } else if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("Member path is not a Git worktree directory.");
  }
  const worktreeEntry = await lstat(member.worktreePath);
  if (!worktreeEntry.isDirectory() || worktreeEntry.isSymbolicLink()) {
    throw new Error("Managed worktree is not a directory.");
  }
  const [memberCommon, repositoryCommon, branch, status] = await Promise.all([
    gitCommonDirectory(member.worktreePath),
    gitCommonDirectory(repository.absolutePath),
    runGit(["branch", "--show-current"], { cwd: member.worktreePath }),
    runGit(["status", "--porcelain"], { cwd: member.worktreePath }),
  ]);
  if (memberCommon !== repositoryCommon || branch.stdout !== member.branch) {
    throw new Error("Git worktree identity does not match workspace metadata.");
  }
  return `worktree ${member.branch} -> ${member.worktreePath}${status.stdout ? " (dirty)" : ""}`;
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
    const config = await context.manager.getConfig();
    await access(config.workspaceRoot, constants.W_OK);
    const [workspaces, repositories] = await Promise.all([
      context.manager.searchWorkspaces(),
      context.manager.search(),
    ]);
    checks.push({ name: "workspace-root", ok: true, detail: config.workspaceRoot });
    for (const workspace of workspaces) {
      for (const member of workspace.members) {
        const name = `workspace:${workspace.name}/${member.alias}`;
        try {
          checks.push({
            name,
            ok: true,
            detail: await inspectWorkspaceMember(workspace, member, repositories),
          });
        } catch (error) {
          checks.push({ name, ok: false, detail: String(error) });
        }
      }
    }
  } catch (error) {
    checks.push({ name: "workspaces", ok: false, detail: String(error) });
  }
  try {
    if (process.platform !== "darwin") throw new Error("macOS only in v1");
    await access("/usr/bin/pbcopy", constants.X_OK);
    checks.push({ name: "clipboard", ok: true, detail: "/usr/bin/pbcopy" });
  } catch (error) {
    checks.push({ name: "clipboard", ok: false, detail: String(error) });
  }
  if (json) printValue(context, checks, true);
  else {
    const labels: Record<string, string> = {
      git: "Git",
      storage: "Managed root",
      "workspace-root": "Workspace root",
      workspaces: "Workspaces",
      clipboard: "Clipboard",
    };
    const passed = checks.filter((check) => check.ok).length;
    const failed = checks.length - passed;
    const body = checks
      .map((check) =>
        context.theme.check(
          check.ok,
          labels[check.name] ?? check.name.replace(/^workspace:/, "Workspace "),
          check.detail,
        ),
      )
      .join("\n\n");
    context.stdout(
      [
        context.theme.header("doctor"),
        "",
        body,
        "",
        context.theme.summary([
          formatCount(passed, "check passed", "checks passed"),
          ...(failed > 0 ? [formatCount(failed, "check failed", "checks failed")] : []),
        ]),
      ].join("\n"),
    );
  }
  if (checks.some((check) => !check.ok)) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "One or more doctor checks failed.", checks);
  }
}

async function handleWorkspace(
  parsed: ParsedArguments,
  context: CliContext,
  json: boolean,
  allowPrompt: boolean,
): Promise<void> {
  const [action, ...arguments_] = parsed.positionals;
  if (!action) {
    if (allowPrompt) {
      await openWorkspacePicker(context);
      return;
    }
    throw new CompulsiveError("INVALID_INPUT", "Workspace action is required.");
  }

  if (action === "create") {
    const workspace = await context.manager.createWorkspace({
      name: requireValue(arguments_[0], "Workspace name"),
      ...(parsed.values.has("path") ? { path: parsed.values.get("path")! } : {}),
    });
    printValue(context, json ? workspace : describeWorkspace(workspace, context), json);
    return;
  }

  if (action === "list") {
    const workspaces = await context.manager.searchWorkspaces({ query: arguments_.join(" ") });
    if (json) printValue(context, workspaces, true);
    else
      context.stdout(
        renderWorkspaceCollection(
          context.theme,
          workspaces,
          arguments_.length > 0 ? `workspaces matching "${arguments_.join(" ")}"` : "workspaces",
        ),
      );
    return;
  }

  if (action === "show" || action === "go") {
    const query = requireValue(arguments_.join(" "), "Workspace query");
    const workspace = await selectOneWorkspace(context.manager, query, context, allowPrompt);
    if (action === "go") await outputWorkspaceCd(workspace, context, json);
    else printValue(context, json ? workspace : describeWorkspace(workspace, context), json);
    return;
  }

  if (action === "add") {
    const workspaceQuery = requireValue(arguments_[0], "Workspace query");
    const repositoryQuery = requireValue(arguments_[1], "Repository query");
    const workspace = await selectOneWorkspace(
      context.manager,
      workspaceQuery,
      context,
      allowPrompt,
    );
    const repository = await selectOne(context.manager, repositoryQuery, context, allowPrompt);
    const alias = parsed.values.get("alias") ?? repository.name;
    const explicitBranch = parsed.values.get("branch");
    const readableBranch = `workspace/${workspace.name}/${alias}`;
    const validReadableBranch = await runGit(["check-ref-format", "--branch", readableBranch], {
      cwd: repository.absolutePath,
      allowFailure: true,
    });
    const branch =
      explicitBranch ??
      (validReadableBranch.exitCode === 0
        ? readableBranch
        : `workspace/${workspace.id.split(":").at(-1)!}/${repository.id.split(":").at(-1)!}`);
    const updated = await context.manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      mode: "worktree",
      branch,
      createBranch: explicitBranch === undefined || parsed.flags.has("create-branch"),
      alias,
    });
    printValue(context, json ? updated : describeWorkspace(updated, context), json);
    return;
  }

  if (action === "remove") {
    const workspace = await selectOneWorkspace(
      context.manager,
      requireValue(arguments_[0], "Workspace query"),
      context,
      allowPrompt,
    );
    const repository = await selectWorkspaceRepository(
      context.manager,
      workspace,
      requireValue(arguments_[1], "Repository query"),
      context,
      allowPrompt,
    );
    if (!parsed.flags.has("yes")) {
      if (!allowPrompt) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Use --yes to remove a workspace member non-interactively.",
        );
      }
      const confirmed = await context.confirm(
        `Remove ${repository.name} from workspace ${workspace.name}?`,
      );
      if (!confirmed) throw new CliCancelled();
    }
    const updated = await context.manager.removeWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    printValue(context, json ? updated : describeWorkspace(updated, context), json);
    return;
  }

  if (action === "sync") {
    const query = arguments_.join(" ").trim();
    const workspaces = query
      ? [await selectOneWorkspace(context.manager, query, context, allowPrompt)]
      : await context.manager.searchWorkspaces();
    const results = [];
    for (const workspace of workspaces) {
      results.push(await context.manager.syncWorkspace(workspace.id));
    }
    if (json) printValue(context, query ? results[0] : results, true);
    else {
      for (const result of results) {
        context.stdout(describeWorkspace(result.workspace, context));
        for (const issue of result.issues) context.stderr(context.theme.warning(issue.message));
      }
    }
    if (results.some((result) => result.issues.length > 0)) {
      throw new CompulsiveError("CONFLICT", "One or more workspace members could not be synced.");
    }
    return;
  }

  if (action === "migrate") {
    const query = arguments_.join(" ").trim();
    const workspaces = query
      ? [await selectOneWorkspace(context.manager, query, context, allowPrompt)]
      : await context.manager.searchWorkspaces();
    if (!parsed.flags.has("yes")) {
      if (!allowPrompt) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Use --yes to migrate workspaces non-interactively.",
        );
      }
      const confirmed = await context.confirm(
        query
          ? `Migrate legacy worktrees in workspace ${workspaces[0]!.name}?`
          : `Migrate legacy worktrees in ${String(workspaces.length)} workspaces?`,
      );
      if (!confirmed) throw new CliCancelled();
    }
    const result = await context.manager.migrateWorkspaces(
      query ? workspaces.map((workspace) => workspace.id) : undefined,
    );
    printValue(
      context,
      json ? result : context.theme.success(`Migrated ${formatCount(result.migrated, "worktree")}`),
      json,
    );
    return;
  }

  if (action === "delete") {
    const workspace = await selectOneWorkspace(
      context.manager,
      requireValue(arguments_.join(" "), "Workspace query"),
      context,
      allowPrompt,
    );
    if (!parsed.flags.has("yes")) {
      if (!allowPrompt) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Use --yes to delete a workspace non-interactively.",
        );
      }
      const confirmed = await context.confirm(`Delete workspace ${workspace.name}?`);
      if (!confirmed) throw new CliCancelled();
    }
    await context.manager.deleteWorkspace(workspace.id);
    printValue(
      context,
      json ? { deleted: workspace.id } : context.theme.success(`Deleted ${workspace.name}`),
      json,
    );
    return;
  }

  throw new CompulsiveError("INVALID_INPUT", `Unknown workspace action: ${action}`);
}

async function dispatch(parsed: ParsedArguments, context: CliContext): Promise<void> {
  const json = parsed.flags.has("json");
  const allowPrompt = context.isTTY && !json;
  switch (parsed.command) {
    case "": {
      if (allowPrompt) await openDestinationPicker(context);
      else context.stdout(helpText);
      return;
    }
    case "help":
    case "--help":
    case "-h": {
      context.stdout(helpText);
      return;
    }
    case "init": {
      const rootDir = parsed.values.get("root");
      const config = await context.manager.initialize(rootDir === undefined ? {} : { rootDir });
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
        result.repositories.filter((repository) => !repository.isRegistered);
      if (parsed.flags.has("register")) {
        const registered: RepositoryRecord[] = [];
        for (const repository of output) {
          registered.push(await context.manager.register({ path: repository.absolutePath }));
        }
        output = registered;
      }
      if (json) printValue(context, output, true);
      else {
        const body =
          output.length === 0
            ? context.theme.empty("No new repositories found.")
            : output
                .map((item) =>
                  "id" in item
                    ? describeRecord(item, context)
                    : context.theme.repository(item.classificationPath, item.absolutePath),
                )
                .join("\n\n");
        context.stdout(
          [
            context.theme.header("scan"),
            "",
            body,
            "",
            context.theme.summary([
              formatCount(
                output.length,
                parsed.flags.has("register") ? "repository registered" : "repository found",
                parsed.flags.has("register") ? "repositories registered" : "repositories found",
              ),
              ...(parsed.flags.has("register") ? [] : ["preview only"]),
            ]),
          ].join("\n"),
        );
      }
      return;
    }
    case "list": {
      const query = parsed.positionals.join(" ");
      const records = await context.manager.search({ query });
      if (json) printValue(context, records, true);
      else
        context.stdout(
          renderRepositoryCollection(
            context.theme,
            records,
            query ? `repositories matching "${query}"` : "repositories",
            query ? `No repositories match "${query}".` : "No repositories are registered.",
          ),
        );
      return;
    }
    case "search": {
      const query = parsed.positionals.join(" ").trim();
      if (!query && allowPrompt) {
        await openRepositoryPicker(context);
        return;
      }
      requireValue(query, "Repository query");
      const workspaceQuery = parsed.values.get("workspace");
      const records = workspaceQuery
        ? await repositoriesInWorkspace(
            context.manager,
            await selectOneWorkspace(context.manager, workspaceQuery, context, allowPrompt),
            query,
          )
        : await context.manager.search({ query });
      if (json) printValue(context, records, true);
      else
        context.stdout(
          renderRepositoryCollection(
            context.theme,
            records,
            `search "${query}"`,
            `No repositories match "${query}".`,
          ),
        );
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
        if (!json) {
          const config = await context.manager.getConfig();
          const rendered = renderOrganizePlan(
            context.theme,
            items,
            await realpath(config.rootDir),
            parsed.flags.has("dry-run"),
          );
          context.stdout(rendered.output);
          for (const warning of rendered.warnings) {
            context.stderr(context.theme.warning(warning.message, warning.name));
          }
        }
        if (parsed.flags.has("dry-run")) return;
        if (items.length === 0) {
          if (json) printValue(context, [], true);
          return;
        }
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
            organized.push(await context.manager.organize(item.plan));
          }
          return organized;
        };
        const organized = allowPrompt
          ? await context.runTask("Organizing repositories", organizeAll)
          : await organizeAll();
        if (json) printValue(context, organized, true);
        else {
          context.stdout(context.theme.success(`Organized ${String(items.length)} repositories`));
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
        if (json) printValue(context, plan, true);
        else {
          const config = await context.manager.getConfig();
          const rootDir = await realpath(config.rootDir);
          context.stdout(
            renderOrganizePlan(context.theme, plan.isNoop ? [] : [{ record, plan }], rootDir, true)
              .output,
          );
        }
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
    case "workspace":
    case "ws": {
      await handleWorkspace(parsed, context, json, allowPrompt);
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
    const parsed = parseArguments(argv);
    if (!("theme" in overrides)) {
      context.theme = createTerminalTheme({
        color: parsed.flags.has("no-color")
          ? "never"
          : parsed.flags.has("color")
            ? "always"
            : "auto",
        unicode: true,
        isTTY: context.isTTY,
      });
    }
    await dispatch(parsed, context);
    return 0;
  } catch (error) {
    if (error instanceof CliCancelled) return 0;
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
