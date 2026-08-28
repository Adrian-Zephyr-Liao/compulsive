import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readlink,
  readdir,
  realpath,
  rmdir,
  stat,
  symlink,
  unlink,
} from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { CompulsiveError } from "./errors.js";
import {
  fileExists,
  readConfig,
  readRegistry,
  readWorkspaceRegistry,
  writeJsonAtomic,
  type StoragePaths,
} from "./storage.js";
import type {
  AddWorkspaceMemberInput,
  CreateWorkspaceInput,
  RemoveWorkspaceMemberInput,
  RepositoryRecord,
  SearchWorkspacesInput,
  WorkspaceId,
  WorkspaceMember,
  WorkspaceRecord,
  WorkspaceSyncIssue,
  WorkspaceSyncResult,
} from "./types.js";

export function assertSafeWorkspaceSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new CompulsiveError("INVALID_INPUT", `${label} must be one safe path segment.`);
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function matchRank(workspace: WorkspaceRecord, query: string): number {
  const values = [workspace.id, workspace.name, workspace.absolutePath];
  if (values.some((value) => value.toLowerCase() === query)) return 0;
  if (values.some((value) => value.toLowerCase().startsWith(query))) return 1;
  return 2;
}

export async function createWorkspace(
  paths: StoragePaths,
  input: CreateWorkspaceInput,
): Promise<WorkspaceRecord> {
  const name = input.name.trim();
  assertSafeWorkspaceSegment(name, "Workspace name");
  const config = await readConfig(paths.config);
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const requestedPath = resolve(input.path ?? join(config.workspaceRoot, name));
  const absolutePath = await canonicalPath(requestedPath);

  if (
    registry.workspaces.some((workspace) => workspace.name.toLowerCase() === name.toLowerCase())
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace name already exists: ${name}`);
  }
  if (
    registry.workspaces.some(
      (workspace) => resolve(workspace.absolutePath) === resolve(absolutePath),
    )
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace path is already registered: ${absolutePath}`);
  }

  const existed = await fileExists(requestedPath);
  if (existed && !(await stat(requestedPath)).isDirectory()) {
    throw new CompulsiveError("CONFLICT", `Workspace path is not a directory: ${requestedPath}`);
  }
  await mkdir(requestedPath, { recursive: true });
  const createdPath = await realpath(requestedPath);
  const now = new Date().toISOString();
  const workspace: WorkspaceRecord = {
    id: `workspace:${randomUUID()}` as WorkspaceRecord["id"],
    name,
    absolutePath: createdPath,
    members: [],
    createdAt: now,
    updatedAt: now,
  };
  registry.workspaces.push(workspace);
  try {
    await writeJsonAtomic(paths.workspaces, registry);
  } catch (error) {
    if (!existed) {
      try {
        await rmdir(createdPath);
      } catch {
        // The directory is no longer empty or removable, so preserve it.
      }
    }
    throw error;
  }
  return workspace;
}

export async function searchWorkspaces(
  paths: StoragePaths,
  input: SearchWorkspacesInput = {},
): Promise<WorkspaceRecord[]> {
  await readConfig(paths.config);
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const query = input.query?.trim().toLowerCase() ?? "";
  if (!query) return [...registry.workspaces];
  return registry.workspaces
    .filter((workspace) =>
      [workspace.id, workspace.name, workspace.absolutePath].some((value) =>
        value.toLowerCase().includes(query),
      ),
    )
    .sort((left, right) => matchRank(left, query) - matchRank(right, query));
}

function findWorkspace(
  registry: Awaited<ReturnType<typeof readWorkspaceRegistry>>,
  id: WorkspaceId,
) {
  const index = registry.workspaces.findIndex((workspace) => workspace.id === id);
  if (index === -1) throw new CompulsiveError("NOT_FOUND", "Workspace is not registered.");
  return { index, workspace: registry.workspaces[index]! };
}

function findRepository(repositories: RepositoryRecord[], id: RepositoryRecord["id"]) {
  const repository = repositories.find((record) => record.id === id);
  if (!repository) throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
  return repository;
}

async function pathEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to inspect workspace path: ${path}`, {
      cause: error,
    });
  }
}

async function createVerifiedLink(memberPath: string, repositoryPath: string): Promise<void> {
  const target = await realpath(repositoryPath).catch((error: unknown) => {
    throw new CompulsiveError("NOT_FOUND", `Repository path no longer exists: ${repositoryPath}`, {
      cause: error,
    });
  });
  try {
    await symlink(target, memberPath);
  } catch (error) {
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      `Unable to create workspace link: ${memberPath}`,
      {
        cause: error,
      },
    );
  }
  if ((await realpath(memberPath)) !== target || (await readlink(memberPath)) !== target) {
    await unlink(memberPath).catch(() => undefined);
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      `Unable to verify workspace link: ${memberPath}`,
    );
  }
}

async function verifyManagedLink(memberPath: string, repositoryPath: string): Promise<string> {
  const entry = await lstat(memberPath).catch((error: unknown) => {
    throw new CompulsiveError("CONFLICT", `Managed workspace link is missing: ${memberPath}`, {
      cause: error,
    });
  });
  if (!entry.isSymbolicLink()) {
    throw new CompulsiveError("CONFLICT", `Workspace member path is not a link: ${memberPath}`);
  }
  const target = await readlink(memberPath);
  if (!isAbsolute(target)) {
    throw new CompulsiveError("CONFLICT", `Workspace member link is unexpected: ${memberPath}`);
  }
  const [resolvedMember, resolvedRepository] = await Promise.all([
    realpath(memberPath).catch(() => undefined),
    realpath(repositoryPath).catch(() => undefined),
  ]);
  if (!resolvedMember || !resolvedRepository || resolvedMember !== resolvedRepository) {
    throw new CompulsiveError("CONFLICT", `Workspace member link is unexpected: ${memberPath}`);
  }
  return target;
}

export async function addWorkspaceMember(
  paths: StoragePaths,
  input: AddWorkspaceMemberInput,
): Promise<WorkspaceRecord> {
  if (input.mode === "worktree") {
    throw new CompulsiveError("INVALID_INPUT", "Worktree members are not available yet.");
  }
  await readConfig(paths.config);
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const repository = findRepository(repositoryRegistry.repositories, input.repositoryId);
  const alias = (input.alias ?? repository.name).trim();
  assertSafeWorkspaceSegment(alias, "Workspace member alias");
  if (workspace.members.some((member) => member.repositoryId === repository.id)) {
    throw new CompulsiveError("CONFLICT", "Repository is already a member of this workspace.");
  }
  if (workspace.members.some((member) => member.alias.toLowerCase() === alias.toLowerCase())) {
    throw new CompulsiveError("CONFLICT", `Workspace member alias already exists: ${alias}`);
  }
  const memberPath = join(workspace.absolutePath, alias);
  if (await pathEntryExists(memberPath)) {
    throw new CompulsiveError("CONFLICT", `Workspace member path already exists: ${memberPath}`);
  }

  await createVerifiedLink(memberPath, repository.absolutePath);
  const member: WorkspaceMember = { repositoryId: repository.id, alias, mode: "link" };
  const updated: WorkspaceRecord = {
    ...workspace,
    members: [...workspace.members, member],
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    await unlink(memberPath).catch(() => undefined);
    throw error;
  }
  return updated;
}

export async function removeWorkspaceMember(
  paths: StoragePaths,
  input: RemoveWorkspaceMemberInput,
): Promise<WorkspaceRecord> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const memberIndex = workspace.members.findIndex(
    (member) => member.repositoryId === input.repositoryId,
  );
  if (memberIndex === -1) {
    throw new CompulsiveError("NOT_FOUND", "Repository is not a member of this workspace.");
  }
  const member = workspace.members[memberIndex]!;
  if (member.mode === "worktree") {
    throw new CompulsiveError("INVALID_INPUT", "Worktree members are not available yet.");
  }
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  const memberPath = join(workspace.absolutePath, member.alias);
  const target = await verifyManagedLink(memberPath, repository.absolutePath);
  await unlink(memberPath);
  const updated: WorkspaceRecord = {
    ...workspace,
    members: workspace.members.filter((_, candidateIndex) => candidateIndex !== memberIndex),
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    await symlink(target, memberPath).catch(() => undefined);
    throw error;
  }
  return updated;
}

export async function syncWorkspace(
  paths: StoragePaths,
  id: WorkspaceId,
): Promise<WorkspaceSyncResult> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, id);
  const repaired: RepositoryRecord["id"][] = [];
  const issues: WorkspaceSyncIssue[] = [];
  const rollbacks: Array<() => Promise<void>> = [];

  for (const member of workspace.members) {
    if (member.mode !== "link") continue;
    const repository = repositoryRegistry.repositories.find(
      (record) => record.id === member.repositoryId,
    );
    if (!repository) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "MISSING_REPOSITORY",
        message: "Referenced repository is not registered.",
      });
      continue;
    }
    const memberPath = join(workspace.absolutePath, member.alias);
    const expectedTarget = await realpath(repository.absolutePath).catch(() => undefined);
    if (!expectedTarget) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "MISSING_REPOSITORY",
        message: `Repository path no longer exists: ${repository.absolutePath}`,
      });
      continue;
    }
    if (!(await pathEntryExists(memberPath))) {
      await createVerifiedLink(memberPath, expectedTarget);
      rollbacks.push(() => unlink(memberPath));
      repaired.push(member.repositoryId);
      continue;
    }
    const entry = await lstat(memberPath);
    if (!entry.isSymbolicLink()) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "CONFLICT",
        message: `Workspace member path is occupied: ${memberPath}`,
      });
      continue;
    }
    const previousTarget = await readlink(memberPath);
    const resolvedTarget = await realpath(memberPath).catch(() => undefined);
    if (resolvedTarget === expectedTarget) continue;
    if (resolvedTarget || !isAbsolute(previousTarget)) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "CONFLICT",
        message: `Workspace member link points elsewhere: ${memberPath}`,
      });
      continue;
    }
    await unlink(memberPath);
    await createVerifiedLink(memberPath, expectedTarget);
    rollbacks.push(async () => {
      await unlink(memberPath);
      await symlink(previousTarget, memberPath);
    });
    repaired.push(member.repositoryId);
  }

  let resultWorkspace = workspace;
  if (repaired.length > 0) {
    resultWorkspace = { ...workspace, updatedAt: new Date().toISOString() };
    workspaceRegistry.workspaces[index] = resultWorkspace;
    try {
      await writeJsonAtomic(paths.workspaces, workspaceRegistry);
    } catch (error) {
      for (const rollback of rollbacks.reverse()) await rollback().catch(() => undefined);
      throw error;
    }
  }
  return { workspace: resultWorkspace, repaired, issues };
}

export async function deleteWorkspace(paths: StoragePaths, id: WorkspaceId): Promise<void> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, id);
  const links: Array<{ path: string; target: string }> = [];
  for (const member of workspace.members) {
    if (member.mode === "worktree") {
      throw new CompulsiveError("INVALID_INPUT", "Worktree members are not available yet.");
    }
    const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
    const path = join(workspace.absolutePath, member.alias);
    links.push({ path, target: await verifyManagedLink(path, repository.absolutePath) });
  }

  const removed: Array<{ path: string; target: string }> = [];
  try {
    for (const link of links) {
      await unlink(link.path);
      removed.push(link);
    }
    workspaceRegistry.workspaces.splice(index, 1);
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    for (const link of removed.reverse())
      await symlink(link.target, link.path).catch(() => undefined);
    throw error;
  }

  const entries = await readdir(workspace.absolutePath);
  if (entries.length === 1 && entries[0] === ".DS_Store") {
    await unlink(join(workspace.absolutePath, ".DS_Store"));
    await rmdir(workspace.absolutePath);
  } else if (entries.length === 0) {
    await rmdir(workspace.absolutePath);
  }
}
