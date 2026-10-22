import {
  type StoragePaths,
  readConfig,
  readWorkspaceRegistry,
  readRegistry,
  writeJsonAtomic,
  readWorkspaceStatusRegistry,
} from "./storage.js";
import { type WorkspaceId } from "./types.js";
import { findWorkspace, findRepository } from "./workspace-registry.js";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { CompulsiveError } from "./errors.js";
import { runGit } from "./git.js";
import {
  pathContains,
  canonicalPath,
  verifyManagedLink,
  unlinkExpectedLink,
  createVerifiedLink,
  runRollbacks,
} from "./workspace-paths.js";
import {
  verifyWorkspaceWorktree,
  assertCleanWorktree,
  removeGitWorktree,
  addGitWorktree,
} from "./workspace-worktrees.js";
import { randomUUID } from "node:crypto";
import { rename, symlink, rm } from "node:fs/promises";

export async function deleteWorkspace(paths: StoragePaths, id: WorkspaceId): Promise<void> {
  const [config, workspaceRegistry, repositoryRegistry] = await Promise.all([
    readConfig(paths.config),
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, id);
  const workspacePath = resolve(workspace.absolutePath);
  const protectedRoots = await Promise.all(
    [homedir(), config.rootDir, config.workspaceRoot].map(canonicalPath),
  );
  if (
    workspacePath === dirname(workspacePath) ||
    protectedRoots.some((protectedPath) => pathContains(workspacePath, protectedPath))
  ) {
    throw new CompulsiveError(
      "CONFLICT",
      `Refusing to delete a protected Workspace path: ${workspacePath}`,
    );
  }
  const nestedWorkspace = workspaceRegistry.workspaces.find(
    (candidate) =>
      candidate.id !== workspace.id && pathContains(workspacePath, candidate.absolutePath),
  );
  if (nestedWorkspace) {
    throw new CompulsiveError(
      "CONFLICT",
      `Workspace contains another registered Workspace: ${nestedWorkspace.name}`,
    );
  }
  const nestedRepository = repositoryRegistry.repositories.find((repository) =>
    pathContains(workspacePath, repository.absolutePath),
  );
  if (nestedRepository)
    throw new CompulsiveError(
      "CONFLICT",
      `Workspace contains a canonical repository: ${nestedRepository.absolutePath}`,
    );
  const links: Array<{ path: string; target: string }> = [];
  const worktrees: Array<{
    memberPath: string;
    path: string;
    branch: string;
    head: string;
    detached?: true;
    repositoryPath: string;
    linked: boolean;
  }> = [];
  for (const member of workspace.members) {
    if (member.mode === "worktree") {
      const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
      const state = await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
      await assertCleanWorktree(state.worktreePath);
      worktrees.push({
        memberPath: state.memberPath,
        path: state.worktreePath,
        branch: member.branch,
        head: (await runGit(["rev-parse", "HEAD"], { cwd: state.worktreePath })).stdout,
        ...(member.detached ? { detached: true as const } : {}),
        repositoryPath: repository.absolutePath,
        linked: state.linked,
      });
      continue;
    }
    const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
    const path = join(workspace.absolutePath, member.alias);
    links.push({ path, target: await verifyManagedLink(path, repository.absolutePath) });
  }

  const removed: Array<{ path: string; target: string }> = [];
  const removedWorktrees: typeof worktrees = [];
  const deletionPath = `${workspacePath}.cpl-deleting-${randomUUID()}`;
  let moved = false;
  try {
    for (const link of links) {
      await unlinkExpectedLink(link.path, link.target);
      removed.push(link);
    }
    for (const worktree of worktrees) {
      if (worktree.linked) await unlinkExpectedLink(worktree.memberPath, worktree.path);
      try {
        await removeGitWorktree(worktree.repositoryPath, worktree.path);
      } catch (error) {
        if (worktree.linked) await createVerifiedLink(worktree.memberPath, worktree.path);
        throw error;
      }
      removedWorktrees.push(worktree);
    }
    await rename(workspacePath, deletionPath);
    moved = true;
    workspaceRegistry.workspaces.splice(index, 1);
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    const rollbackErrors = await runRollbacks([
      ...removed.map((link) => () => symlink(link.target, link.path)),
      ...removedWorktrees.map((worktree) => async () => {
        await addGitWorktree(
          worktree.repositoryPath,
          worktree.path,
          worktree.branch,
          false,
          worktree.head,
          worktree.detached,
        );
        if (worktree.linked) await createVerifiedLink(worktree.memberPath, worktree.path);
      }),
      ...(moved ? [() => rename(deletionPath, workspacePath)] : []),
    ]);
    if (rollbackErrors.length > 0) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace deletion failed and one or more members could not be restored.",
        { cause: error, rollbackErrors },
      );
    }
    throw error;
  }
  try {
    await rm(deletionPath, { recursive: true });
  } catch (error) {
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      `Workspace was unregistered but its directory could not be deleted: ${deletionPath}`,
      { cause: error },
    );
  }
  try {
    const statusRegistry = await readWorkspaceStatusRegistry(paths.workspaceStatuses);
    statusRegistry.statuses = statusRegistry.statuses.filter(
      ({ workspaceId }) => workspaceId !== workspace.id,
    );
    await writeJsonAtomic(paths.workspaceStatuses, statusRegistry);
  } catch {
    // Cache cleanup must not turn a completed workspace deletion into a failure.
  }
}
