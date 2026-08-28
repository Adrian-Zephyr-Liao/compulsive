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
import { runGit } from "./git.js";
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

async function gitCommonDirectory(path: string): Promise<string> {
  const result = await runGit(["rev-parse", "--git-common-dir"], { cwd: path });
  return realpath(isAbsolute(result.stdout) ? result.stdout : resolve(path, result.stdout));
}

async function verifyManagedWorktree(
  memberPath: string,
  repositoryPath: string,
  branch: string,
): Promise<void> {
  if (!(await pathEntryExists(memberPath))) {
    throw new CompulsiveError("CONFLICT", `Managed Git worktree is missing: ${memberPath}`);
  }
  const entry = await lstat(memberPath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new CompulsiveError("CONFLICT", `Workspace member is not a Git worktree: ${memberPath}`);
  }
  try {
    const [memberRoot, memberCommon, repositoryCommon, currentBranch] = await Promise.all([
      runGit(["rev-parse", "--show-toplevel"], { cwd: memberPath }),
      gitCommonDirectory(memberPath),
      gitCommonDirectory(repositoryPath),
      runGit(["branch", "--show-current"], { cwd: memberPath }),
    ]);
    if (
      (await realpath(memberRoot.stdout)) !== (await realpath(memberPath)) ||
      memberCommon !== repositoryCommon ||
      currentBranch.stdout !== branch
    ) {
      throw new CompulsiveError(
        "CONFLICT",
        `Workspace worktree identity is unexpected: ${memberPath}`,
      );
    }
  } catch (error) {
    if (error instanceof CompulsiveError && error.code === "CONFLICT") throw error;
    throw new CompulsiveError(
      "CONFLICT",
      `Workspace member is not the expected worktree: ${memberPath}`,
      {
        cause: error,
      },
    );
  }
}

async function assertCleanWorktree(memberPath: string): Promise<void> {
  const status = await runGit(["status", "--porcelain"], { cwd: memberPath });
  if (status.stdout) {
    throw new CompulsiveError("CONFLICT", `Git worktree has uncommitted changes: ${memberPath}`);
  }
}

async function addGitWorktree(
  repositoryPath: string,
  memberPath: string,
  branch: string,
  createBranch: boolean,
): Promise<void> {
  const arguments_ = ["-C", repositoryPath, "worktree", "add"];
  if (createBranch) arguments_.push("-b", branch, "--", memberPath);
  else arguments_.push("--", memberPath, branch);
  try {
    await runGit(arguments_);
  } catch (error) {
    if (error instanceof CompulsiveError && error.code === "GIT_FAILED") {
      throw new CompulsiveError("CONFLICT", error.message, error.details);
    }
    throw error;
  }
}

async function removeGitWorktree(repositoryPath: string, memberPath: string): Promise<void> {
  await runGit(["-C", repositoryPath, "worktree", "remove", "--", memberPath]);
}

export async function addWorkspaceMember(
  paths: StoragePaths,
  input: AddWorkspaceMemberInput,
): Promise<WorkspaceRecord> {
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

  let member: WorkspaceMember;
  if (input.mode === "worktree") {
    const branch = input.branch.trim();
    if (!branch) throw new CompulsiveError("INVALID_INPUT", "Worktree branch is required.");
    await addGitWorktree(repository.absolutePath, memberPath, branch, input.createBranch === true);
    try {
      await verifyManagedWorktree(memberPath, repository.absolutePath, branch);
    } catch (error) {
      await removeGitWorktree(repository.absolutePath, memberPath).catch(() => undefined);
      throw error;
    }
    member = {
      repositoryId: repository.id,
      alias,
      mode: "worktree",
      branch,
      worktreePath: await realpath(memberPath),
    };
  } else {
    await createVerifiedLink(memberPath, repository.absolutePath);
    member = { repositoryId: repository.id, alias, mode: "link" };
  }
  const updated: WorkspaceRecord = {
    ...workspace,
    members: [...workspace.members, member],
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      if (member.mode === "worktree") {
        await assertCleanWorktree(memberPath);
        await removeGitWorktree(repository.absolutePath, memberPath);
      } else {
        await unlink(memberPath);
      }
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the new member could not be rolled back.",
        { cause: error, rollbackError },
      );
    }
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
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  const memberPath = join(workspace.absolutePath, member.alias);
  let linkTarget: string | undefined;
  if (member.mode === "worktree") {
    await verifyManagedWorktree(memberPath, repository.absolutePath, member.branch);
    await assertCleanWorktree(memberPath);
    await removeGitWorktree(repository.absolutePath, memberPath);
  } else {
    linkTarget = await verifyManagedLink(memberPath, repository.absolutePath);
    await unlink(memberPath);
  }
  const updated: WorkspaceRecord = {
    ...workspace,
    members: workspace.members.filter((_, candidateIndex) => candidateIndex !== memberIndex),
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      if (member.mode === "worktree") {
        await addGitWorktree(repository.absolutePath, memberPath, member.branch, false);
      } else {
        await symlink(linkTarget!, memberPath);
      }
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the removed member could not be restored.",
        { cause: error, rollbackError },
      );
    }
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
    if (member.mode === "worktree") {
      try {
        await verifyManagedWorktree(member.worktreePath, repository.absolutePath, member.branch);
      } catch (error) {
        issues.push({
          repositoryId: member.repositoryId,
          alias: member.alias,
          code: "CONFLICT",
          message: error instanceof Error ? error.message : "Git worktree verification failed.",
        });
      }
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
  const worktrees: Array<{ path: string; branch: string; repositoryPath: string }> = [];
  for (const member of workspace.members) {
    if (member.mode === "worktree") {
      const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
      await verifyManagedWorktree(member.worktreePath, repository.absolutePath, member.branch);
      await assertCleanWorktree(member.worktreePath);
      worktrees.push({
        path: member.worktreePath,
        branch: member.branch,
        repositoryPath: repository.absolutePath,
      });
      continue;
    }
    const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
    const path = join(workspace.absolutePath, member.alias);
    links.push({ path, target: await verifyManagedLink(path, repository.absolutePath) });
  }

  const removed: Array<{ path: string; target: string }> = [];
  const removedWorktrees: Array<{ path: string; branch: string; repositoryPath: string }> = [];
  try {
    for (const link of links) {
      await unlink(link.path);
      removed.push(link);
    }
    for (const worktree of worktrees) {
      await removeGitWorktree(worktree.repositoryPath, worktree.path);
      removedWorktrees.push(worktree);
    }
    workspaceRegistry.workspaces.splice(index, 1);
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    for (const worktree of removedWorktrees.reverse()) {
      await addGitWorktree(worktree.repositoryPath, worktree.path, worktree.branch, false).catch(
        () => undefined,
      );
    }
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
