import { autocomplete, confirm, isCancel, spinner, type SpinnerOptions } from "@clack/prompts";
import { relative, sep } from "node:path";
import pc from "picocolors";

import type { OrganizePlan, RepositoryRecord, WorkspaceRecord } from "./types.js";

export const helpText = `Compulsive
Safely organize and navigate local Git repositories.

USAGE
  cpl <command> [options]
  cpl                         Search repositories and workspaces

REPOSITORIES
  cpl init [--root <path>]    Initialize the managed repository root
  cpl clone <git-url> [--depth <number>]
                              Clone, register, and copy a cd command
  cpl add <path>              Register an existing repository
  cpl scan [paths...] [--register]
                              Discover or register repositories
  cpl list [query] [--json]   List registered repositories
  cpl search <query> [--workspace <workspace-query>] [--json]
  cpl go <query> [--json]     Copy and print a safe cd command
  cpl organize <query> [--dry-run | --yes] [--json]
  cpl organize --all [--dry-run | --yes] [--json]
  cpl forget <query> [--yes]  Unregister without deleting files

WORKSPACES
  cpl workspace|ws create <name> [--path <path>] [--json]
  cpl workspace|ws list [query] [--json]
  cpl workspace|ws show|go <workspace-query> [--json]
  cpl workspace|ws add <workspace-query> <repository-query> [options]
  cpl workspace|ws remove <workspace-query> <repository-query> [--yes] [--json]
  cpl workspace|ws sync [workspace-query] [--json]
  cpl workspace|ws migrate [workspace-query] [--yes] [--json]
  cpl workspace|ws delete <workspace-query> [--yes] [--json]

SYSTEM
  cpl config show
  cpl config set-root|set-workspace-root <path>
  cpl config add-scan-root|remove-scan-root <path>
  cpl doctor [--json]

GLOBAL OPTIONS
  --json       Print machine-readable JSON
  --color      Force colors
  --no-color   Disable colors
  -h, --help   Show help

Compulsive never deletes repository files.`;

export type TerminalColorMode = "auto" | "always" | "never";

export type NavigationTarget =
  | { kind: "repository"; repository: RepositoryRecord; aliases?: string[] }
  | { kind: "workspace"; workspace: WorkspaceRecord };

export interface OrganizeDisplayItem {
  record: RepositoryRecord;
  plan: OrganizePlan;
}

export interface TerminalThemeOptions {
  color: TerminalColorMode;
  unicode: boolean;
  isTTY: boolean;
}

export interface TerminalTheme {
  header(title: string): string;
  success(title: string, detail?: string): string;
  warning(message: string, subject?: string): string;
  error(code: string, message: string): string;
  empty(message: string): string;
  repository(classification: string, path: string): string;
  workspace(name: string, path: string, memberCount: number): string;
  check(ok: boolean, name: string, detail: string): string;
  move(name: string, source: string, target: string): string;
  summary(parts: string[]): string;
}

export function createTerminalTheme(options: TerminalThemeOptions): TerminalTheme {
  const colors = pc.createColors(
    options.color === "always" ||
      (options.color === "auto" && options.isTTY && pc.isColorSupported),
  );
  const icons = options.unicode
    ? { success: "◆", item: "◇", warning: "▲", error: "✖", pass: "●", fail: "●" }
    : { success: "OK", item: "-", warning: "!", error: "x", pass: "OK", fail: "x" };

  return {
    header(title) {
      return `${colors.dim("cpl")}  ${colors.bold(title)}`;
    },
    success(title, detail) {
      const heading = `${colors.green(icons.success)} ${colors.bold(title)}`;
      return detail === undefined ? heading : `${heading}\n   ${colors.dim(detail)}`;
    },
    warning(message, subject) {
      if (subject === undefined) {
        return `${colors.yellow(icons.warning)} ${colors.yellow(message)}`;
      }
      return `${colors.yellow(icons.warning)} ${colors.bold(subject)}\n  ${colors.yellow(message)}`;
    },
    error(code, message) {
      return `${colors.red(icons.error)} ${colors.red(colors.bold(code))}\n\n  ${message}`;
    },
    empty(message) {
      return colors.dim(message);
    },
    repository(classification, path) {
      return `${colors.cyan(icons.item)} ${colors.bold(classification)}\n  ${colors.dim(path)}`;
    },
    workspace(name, path, memberCount) {
      return `${colors.magenta(icons.item)} ${colors.bold(name)} ${colors.dim(`(${String(memberCount)} members)`)}\n  ${colors.dim(path)}`;
    },
    check(ok, name, detail) {
      const icon = ok ? colors.green(icons.pass) : colors.red(icons.fail);
      return `${icon} ${colors.bold(name)}\n  ${colors.dim(detail)}`;
    },
    move(name, source, target) {
      const arrow = options.unicode ? "→" : "->";
      return `${colors.cyan(colors.bold("MOVE"))}  ${colors.bold(name)}\n      ${colors.dim(source)}\n   ${colors.cyan(arrow)} ${colors.bold(target)}`;
    },
    summary(parts) {
      return parts.map((part) => colors.bold(part)).join(colors.dim(" · "));
    },
  };
}

export function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

export function renderRepositoryCollection(
  theme: TerminalTheme,
  records: RepositoryRecord[],
  title: string,
  emptyMessage: string,
): string {
  const body =
    records.length === 0
      ? theme.empty(emptyMessage)
      : records
          .map((record) => theme.repository(record.classificationPath, record.absolutePath))
          .join("\n\n");
  return [
    theme.header(title),
    "",
    body,
    "",
    theme.summary([formatCount(records.length, "repository found", "repositories found")]),
  ].join("\n");
}

export function renderWorkspaceCollection(
  theme: TerminalTheme,
  workspaces: WorkspaceRecord[],
  title: string,
): string {
  const body =
    workspaces.length === 0
      ? theme.empty("No workspaces found.")
      : workspaces
          .map((workspace) =>
            theme.workspace(workspace.name, workspace.absolutePath, workspace.members.length),
          )
          .join("\n\n");
  return [
    theme.header(title),
    "",
    body,
    "",
    theme.summary([formatCount(workspaces.length, "workspace")]),
  ].join("\n");
}

function targetClassification(target: string, rootDir: string): string {
  const candidate = relative(rootDir, target);
  if (candidate === "" || candidate === ".." || candidate.startsWith(`..${sep}`)) return target;
  return candidate.split(sep).join("/");
}

export function renderOrganizePlan(
  theme: TerminalTheme,
  items: OrganizeDisplayItem[],
  rootDir: string,
  dryRun: boolean,
): { output: string; warnings: Array<{ name: string; message: string }> } {
  const warnings = items.flatMap(({ record, plan }) =>
    plan.warnings.map((message) => ({ name: record.name, message })),
  );
  const body =
    items.length === 0
      ? theme.empty("No repositories need organizing.")
      : items
          .map(({ record, plan }) =>
            theme.move(
              record.name,
              record.classificationPath,
              targetClassification(plan.target, rootDir),
            ),
          )
          .join("\n\n");
  const summary = [
    formatCount(items.length, "move"),
    ...(warnings.length > 0 ? [formatCount(warnings.length, "warning")] : []),
    ...(dryRun ? ["no files changed"] : []),
  ];
  return {
    output: [theme.header("organize plan"), "", body, "", theme.summary(summary)].join("\n"),
    warnings,
  };
}

export async function selectRepository(
  message: string,
  repositories: RepositoryRecord[],
): Promise<RepositoryRecord | undefined> {
  const result = await autocomplete<RepositoryRecord>({
    message,
    placeholder: "Type to filter repositories...",
    maxItems: 10,
    options: repositories.map((repository) => ({
      value: repository,
      label: `Repository  ${repository.classificationPath}`,
      hint: repository.absolutePath,
    })),
    output: process.stderr,
  });
  return isCancel(result) ? undefined : result;
}

export async function selectWorkspace(
  message: string,
  workspaces: WorkspaceRecord[],
): Promise<WorkspaceRecord | undefined> {
  const result = await autocomplete({
    message,
    placeholder: "Type to filter workspaces...",
    maxItems: 10,
    options: workspaces.map((workspace) => ({
      value: workspace,
      label: `Workspace   ${workspace.name}`,
      hint: `${workspace.absolutePath} · ${String(workspace.members.length)} members`,
    })),
    output: process.stderr,
  });
  return isCancel(result) ? undefined : result;
}

export async function selectNavigationTarget(
  message: string,
  targets: NavigationTarget[],
): Promise<NavigationTarget | undefined> {
  const result = await autocomplete<NavigationTarget>({
    message,
    placeholder: "Type to filter repositories and workspaces...",
    maxItems: 12,
    options: targets.map((target) =>
      target.kind === "repository"
        ? {
            value: target,
            label: `Repository  ${[target.repository.classificationPath, ...(target.aliases ?? [])].join(" · ")}`,
            hint: target.repository.absolutePath,
          }
        : {
            value: target,
            label: `Workspace   ${target.workspace.name}`,
            hint: `${target.workspace.absolutePath} · ${String(target.workspace.members.length)} members`,
          },
    ),
    output: process.stderr,
  });
  return isCancel(result) ? undefined : result;
}

export async function confirmAction(message: string): Promise<boolean | undefined> {
  const result = await confirm({ message, initialValue: false, output: process.stderr });
  return isCancel(result) ? undefined : result;
}

export async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const options: SpinnerOptions = { output: process.stderr };
  const indicator = spinner(options);
  indicator.start(message);
  try {
    const result = await task();
    indicator.stop(message);
    return result;
  } catch (error) {
    indicator.error(message);
    throw error;
  }
}
