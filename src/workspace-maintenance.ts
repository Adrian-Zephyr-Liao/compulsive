import {
  type StoragePaths,
  readWorkspaceRegistry,
  readRegistry,
  writeJsonAtomic,
} from "./storage.js";
import {
  type WorkspaceId,
  type WorkspaceSyncResult,
  type RepositoryRecord,
  type WorkspaceSyncIssue,
  type WorkspaceMigrationResult,
  type WorkspaceMember,
} from "./types.js";
import { findWorkspace, findRepository } from "./workspace-registry.js";
import {
  pathEntryExists,
  isLegacyWorktree,
  managedWorktreePath,
  workspaceMemberPath,
  createVerifiedLink,
  unlinkExpectedLink,
  verifyExpectedLink,
  runRollbacks,
  pathContains,
  ensureManagedWorktreeRoot,
} from "./workspace-paths.js";
import { lstat, mkdir, rmdir, realpath, readlink, symlink } from "node:fs/promises";
import { CompulsiveError } from "./errors.js";
import { verifyManagedWorktree, moveGitWorktree } from "./workspace-worktrees.js";
import { resolve, join, isAbsolute } from "node:path";
import { currentUpstream } from "./workspace-branches.js";
import { runGit } from "./git.js";

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
  if (await pathEntryExists(workspace.absolutePath)) {
    const entry = await lstat(workspace.absolutePath);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new CompulsiveError(
        "CONFLICT",
        `Workspace path is not a directory: ${workspace.absolutePath}`,
      );
    }
  } else {
    await mkdir(workspace.absolutePath, { recursive: true });
    rollbacks.push(() => rmdir(workspace.absolutePath));
  }

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
        if (isLegacyWorktree(workspace, member)) {
          await verifyManagedWorktree(
            member.worktreePath,
            repository.absolutePath,
            member.branch,
            member.detached,
          );
          continue;
        }
        const expectedWorktreePath = managedWorktreePath(repository.absolutePath, workspace);
        if (resolve(member.worktreePath) !== resolve(expectedWorktreePath)) {
          throw new CompulsiveError(
            "CONFLICT",
            `Managed worktree path is unexpected: ${member.worktreePath}`,
          );
        }
        await verifyManagedWorktree(
          member.worktreePath,
          repository.absolutePath,
          member.branch,
          member.detached,
        );
        const memberPath = workspaceMemberPath(workspace, member);
        if (!(await pathEntryExists(memberPath))) {
          await createVerifiedLink(memberPath, member.worktreePath);
          rollbacks.push(() => unlinkExpectedLink(memberPath, member.worktreePath));
          repaired.push(member.repositoryId);
          continue;
        }
        await verifyExpectedLink(memberPath, member.worktreePath);
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
      rollbacks.push(() => unlinkExpectedLink(memberPath, expectedTarget));
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
    await unlinkExpectedLink(memberPath, previousTarget);
    await createVerifiedLink(memberPath, expectedTarget);
    rollbacks.push(async () => {
      await unlinkExpectedLink(memberPath, expectedTarget);
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
      const rollbackErrors = await runRollbacks(rollbacks);
      if (rollbackErrors.length > 0) {
        throw new CompulsiveError(
          "FILESYSTEM_FAILED",
          "Workspace sync failed and one or more repaired links could not be restored.",
          { cause: error, rollbackErrors },
        );
      }
      throw error;
    }
  }
  return { workspace: resultWorkspace, repaired, issues };
}

export async function migrateWorkspaces(
  paths: StoragePaths,
  ids?: WorkspaceId[],
): Promise<WorkspaceMigrationResult> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const selectedIds = ids ? new Set(ids) : undefined;
  if (selectedIds) {
    for (const id of selectedIds) findWorkspace(workspaceRegistry, id);
  }
  const selected = workspaceRegistry.workspaces.filter(
    (workspace) => !selectedIds || selectedIds.has(workspace.id),
  );
  const candidates = selected.flatMap((workspace) =>
    workspace.members.flatMap((member, memberIndex) => {
      if (member.mode !== "worktree" || !isLegacyWorktree(workspace, member)) return [];
      const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
      return [
        {
          workspace,
          workspaceIndex: workspaceRegistry.workspaces.indexOf(workspace),
          member,
          memberIndex,
          repositoryPath: repository.absolutePath,
          source: workspaceMemberPath(workspace, member),
          target: managedWorktreePath(repository.absolutePath, workspace),
        },
      ];
    }),
  );

  const legacyPaths = workspaceRegistry.workspaces.flatMap((workspace) =>
    workspace.members
      .filter(
        (member): member is Extract<WorkspaceMember, { mode: "worktree" }> =>
          member.mode === "worktree" && isLegacyWorktree(workspace, member),
      )
      .map((member) => workspaceMemberPath(workspace, member)),
  );
  const targets = new Set<string>();
  const inheritedUpstreams = new Map<string, string>();
  for (const candidate of candidates) {
    await verifyManagedWorktree(
      candidate.source,
      candidate.repositoryPath,
      candidate.member.branch,
      candidate.member.detached,
    );
    if (await pathEntryExists(candidate.target)) {
      throw new CompulsiveError(
        "CONFLICT",
        `Managed worktree path already exists: ${candidate.target}`,
      );
    }
    const normalizedTarget = resolve(candidate.target);
    if (targets.has(normalizedTarget)) {
      throw new CompulsiveError(
        "CONFLICT",
        `Managed worktree target is duplicated: ${candidate.target}`,
      );
    }
    targets.add(normalizedTarget);
    const [worktreeUpstream, repositoryUpstream] = await Promise.all([
      currentUpstream(candidate.source),
      currentUpstream(candidate.repositoryPath),
    ]);
    if (!worktreeUpstream && repositoryUpstream) {
      inheritedUpstreams.set(candidate.source, repositoryUpstream);
    }
    const overlappingPath = legacyPaths.find(
      (path) =>
        resolve(path) !== resolve(candidate.source) &&
        (pathContains(candidate.source, path) || pathContains(path, candidate.source)),
    );
    if (overlappingPath) {
      throw new CompulsiveError(
        "CONFLICT",
        `Nested legacy worktrees must be relocated before migration: ${candidate.source} and ${overlappingPath}`,
      );
    }
  }

  candidates.sort((left, right) => right.source.length - left.source.length);
  const rollbacks: Array<() => Promise<void>> = [];
  const changedWorkspaces = new Set<number>();
  try {
    for (const candidate of candidates) {
      await ensureManagedWorktreeRoot(candidate.repositoryPath);
      await moveGitWorktree(candidate.repositoryPath, candidate.source, candidate.target);
      let trackingSet = false;
      rollbacks.push(async () => {
        if (await pathEntryExists(candidate.source)) {
          await unlinkExpectedLink(candidate.source, await realpath(candidate.target));
        }
        if (trackingSet) {
          await runGit(["branch", "--unset-upstream", candidate.member.branch], {
            cwd: candidate.target,
          });
        }
        await moveGitWorktree(candidate.repositoryPath, candidate.target, candidate.source);
      });
      await createVerifiedLink(candidate.source, candidate.target);
      const upstream = inheritedUpstreams.get(candidate.source);
      if (upstream) {
        await runGit(["branch", "--set-upstream-to", upstream, candidate.member.branch], {
          cwd: candidate.target,
        });
        trackingSet = true;
      }
      const workspace = workspaceRegistry.workspaces[candidate.workspaceIndex]!;
      workspace.members[candidate.memberIndex] = {
        ...candidate.member,
        worktreePath: await realpath(candidate.target),
      };
      changedWorkspaces.add(candidate.workspaceIndex);
    }
    const now = new Date().toISOString();
    for (const index of changedWorkspaces) {
      workspaceRegistry.workspaces[index] = {
        ...workspaceRegistry.workspaces[index]!,
        updatedAt: now,
      };
    }
    if (candidates.length > 0) await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    const rollbackErrors = await runRollbacks(rollbacks);
    if (rollbackErrors.length > 0) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace migration failed and one or more worktrees could not be restored.",
        { cause: error, rollbackErrors },
      );
    }
    throw error;
  }

  return {
    workspaces: workspaceRegistry.workspaces.filter(
      (workspace) => !selectedIds || selectedIds.has(workspace.id),
    ),
    migrated: candidates.length,
  };
}
