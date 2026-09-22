import { constants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { CompulsiveError } from "./errors.js";
import type {
  ManagerConfig,
  RepositoryRegistry,
  WorkspaceRegistry,
  WorkspaceStatusRegistry,
} from "./types.js";

export interface StoragePaths {
  config: string;
  registry: string;
  workspaces: string;
  workspaceStatuses: string;
}

export function createStoragePaths(dataDir: string): StoragePaths {
  return {
    config: join(dataDir, "config.json"),
    registry: join(dataDir, "repositories.json"),
    workspaces: join(dataDir, "workspaces.json"),
    workspaceStatuses: join(dataDir, "workspace-statuses.json"),
  };
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeTextAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to write ${path}.`, { cause: error });
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await writeTextAtomic(path, `${JSON.stringify(value, undefined, 2)}\n`);
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to read ${path}.`, { cause: error });
  }
}

export async function readConfig(path: string): Promise<ManagerConfig> {
  if (!(await fileExists(path))) {
    throw new CompulsiveError("NOT_INITIALIZED", "Run `cpl init` before using this command.");
  }
  const value = await readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("rootDir" in value) ||
    typeof value.rootDir !== "string" ||
    !isAbsolute(value.rootDir) ||
    !("scanRoots" in value) ||
    !Array.isArray(value.scanRoots) ||
    !value.scanRoots.every((item) => typeof item === "string" && isAbsolute(item)) ||
    ("workspaceRoot" in value &&
      (typeof value.workspaceRoot !== "string" || !isAbsolute(value.workspaceRoot)))
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Configuration has an unsupported format.");
  }
  const config = value as Omit<ManagerConfig, "workspaceRoot"> & { workspaceRoot?: string };
  return {
    ...config,
    workspaceRoot: config.workspaceRoot ?? join(dirname(config.rootDir), "Workspaces"),
  };
}

function isSafeClassificationPath(value: unknown): value is string {
  if (typeof value !== "string" || isAbsolute(value)) return false;
  const segments = value.split("/");
  return (
    segments.length >= 2 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function isRepositoryRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    (record.kind === "remote" || record.kind === "local") &&
    typeof record.name === "string" &&
    record.name.length > 0 &&
    isSafeClassificationPath(record.classificationPath) &&
    typeof record.absolutePath === "string" &&
    isAbsolute(record.absolutePath) &&
    typeof record.isManaged === "boolean" &&
    typeof record.registeredAt === "string" &&
    typeof record.lastSeenAt === "string" &&
    (record.canonicalRemote === undefined || typeof record.canonicalRemote === "string") &&
    (record.remoteUrl === undefined ||
      (typeof record.remoteUrl === "string" &&
        !/^[a-z][a-z\d+.-]*:\/\/[^@/]+@/i.test(record.remoteUrl))) &&
    (record.host === undefined || typeof record.host === "string") &&
    (record.ownerPath === undefined ||
      (Array.isArray(record.ownerPath) &&
        record.ownerPath.every((item) => typeof item === "string")))
  );
}

export async function readRegistry(path: string): Promise<RepositoryRegistry> {
  const value = await readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("repositories" in value) ||
    !Array.isArray(value.repositories) ||
    !value.repositories.every(isRepositoryRecord)
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Repository index has an unsupported format.");
  }
  return value as RepositoryRegistry;
}

function isSafePathSegment(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0")
  );
}

function isWorkspaceMember(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const member = value as Record<string, unknown>;
  if (
    typeof member.repositoryId !== "string" ||
    !isSafePathSegment(member.alias) ||
    (member.mode !== "link" && member.mode !== "worktree")
  ) {
    return false;
  }
  if (member.mode === "link") return true;
  return (
    typeof member.branch === "string" &&
    member.branch.length > 0 &&
    (member.detached === undefined || member.detached === true) &&
    typeof member.worktreePath === "string" &&
    isAbsolute(member.worktreePath)
  );
}

function isWorkspaceRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const workspace = value as Record<string, unknown>;
  const workspacePath = workspace.absolutePath;
  if (
    typeof workspace.id !== "string" ||
    !isSafePathSegment(workspace.name) ||
    typeof workspacePath !== "string" ||
    !isAbsolute(workspacePath) ||
    !Array.isArray(workspace.members) ||
    typeof workspace.createdAt !== "string" ||
    typeof workspace.updatedAt !== "string" ||
    !workspace.members.every((member) => isWorkspaceMember(member))
  ) {
    return false;
  }
  const members = workspace.members as Array<Record<string, unknown>>;
  return (
    new Set(members.map((member) => String(member.repositoryId))).size === members.length &&
    new Set(members.map((member) => String(member.alias).toLowerCase())).size === members.length
  );
}

export async function readWorkspaceRegistry(path: string): Promise<WorkspaceRegistry> {
  const value = await readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("workspaces" in value) ||
    !Array.isArray(value.workspaces) ||
    !value.workspaces.every(isWorkspaceRecord)
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Workspace index has an unsupported format.");
  }
  const registry = value as WorkspaceRegistry;
  if (
    new Set(registry.workspaces.map((workspace) => workspace.id)).size !==
      registry.workspaces.length ||
    new Set(registry.workspaces.map((workspace) => workspace.name.toLowerCase())).size !==
      registry.workspaces.length ||
    new Set(registry.workspaces.map((workspace) => resolve(workspace.absolutePath))).size !==
      registry.workspaces.length
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Workspace index contains duplicate entries.");
  }
  return registry;
}

function isWorkspaceMemberStatus(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const status = value as Record<string, unknown>;
  return (
    typeof status.repositoryId === "string" &&
    typeof status.branch === "string" &&
    typeof status.detached === "boolean" &&
    (status.defaultBranch === undefined || typeof status.defaultBranch === "string") &&
    (status.ahead === undefined || typeof status.ahead === "number") &&
    (status.behind === undefined || typeof status.behind === "number") &&
    (status.upstream === undefined || typeof status.upstream === "string") &&
    (status.unpushed === undefined || typeof status.unpushed === "number") &&
    Array.isArray(status.changes) &&
    status.changes.every((change) => typeof change === "string") &&
    Array.isArray(status.conflicts) &&
    status.conflicts.every((conflict) => typeof conflict === "string") &&
    (status.comparisonError === undefined || typeof status.comparisonError === "string")
  );
}

export async function readWorkspaceStatusRegistry(path: string): Promise<WorkspaceStatusRegistry> {
  if (!(await fileExists(path))) return { schemaVersion: 1, statuses: [] };
  const value = await readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("statuses" in value) ||
    !Array.isArray(value.statuses) ||
    !value.statuses.every(
      (status) =>
        typeof status === "object" &&
        status !== null &&
        "workspaceId" in status &&
        typeof status.workspaceId === "string" &&
        "checkedAt" in status &&
        typeof status.checkedAt === "string" &&
        "members" in status &&
        Array.isArray(status.members) &&
        status.members.every(isWorkspaceMemberStatus),
    )
  ) {
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      "Workspace status cache has an unsupported format.",
    );
  }
  return value as WorkspaceStatusRegistry;
}
