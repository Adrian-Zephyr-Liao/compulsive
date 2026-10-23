import {
  type StoragePaths,
  readConfig,
  readWorkspaceRegistry,
  readRegistry,
  writeJsonAtomic,
} from "./storage.js";
import {
  type AddWorkspaceMemberInput,
  type WorkspaceRecord,
  type WorkspaceMember,
  type RemoveWorkspaceMemberInput,
  type PromoteWorkspaceReferenceInput,
  type ConvertWorkspaceToReferenceInput,
} from "./types.js";
import { findWorkspace, findRepository } from "./workspace-registry.js";
import {
  assertSafeWorkspaceSegment,
  pathEntryExists,
  managedWorktreePath,
  ensureManagedWorktreeRoot,
  createVerifiedLink,
  unlinkExpectedLink,
  verifyManagedLink,
} from "./workspace-paths.js";
import { CompulsiveError } from "./errors.js";
import { join } from "node:path";
import { runGit } from "./git.js";
import {
  localBranchExists,
  fetchConfiguredOriginBranch,
  fetchOriginDefaultBranch,
} from "./workspace-branches.js";
import {
  addGitWorktree,
  verifyManagedWorktree,
  removeGitWorktree,
  assertCleanWorktree,
  verifyWorkspaceWorktree,
} from "./workspace-worktrees.js";
import { realpath, symlink } from "node:fs/promises";

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
  let createdBranch: string | undefined;
  if (input.mode === "worktree") {
    if (
      input.useDefaultBranch &&
      (input.branch !== undefined || input.startPoint !== undefined || input.detached)
    ) {
      throw new CompulsiveError(
        "INVALID_INPUT",
        "Default-branch development cannot specify a branch, start point or detached checkout.",
      );
    }
    const defaultBranch = input.useDefaultBranch
      ? await fetchOriginDefaultBranch(repository.absolutePath)
      : undefined;
    const explicitBranch = defaultBranch?.slice("origin/".length) ?? input.branch?.trim();
    if (input.branch !== undefined && !explicitBranch) {
      throw new CompulsiveError("INVALID_INPUT", "Worktree branch is required.");
    }
    const startPoint = defaultBranch ?? input.startPoint?.trim();
    if (input.startPoint !== undefined && !startPoint) {
      throw new CompulsiveError("INVALID_INPUT", "Worktree start point is required.");
    }
    const detached = input.detached === true;
    if (detached && !startPoint) {
      throw new CompulsiveError("INVALID_INPUT", "Detached worktree start point is required.");
    }
    if (detached && explicitBranch) {
      throw new CompulsiveError("INVALID_INPUT", "Detached worktree cannot use a local branch.");
    }
    const readableBranch = `workspace/${workspace.name}/${alias}`;
    const validReadableBranch = explicitBranch
      ? undefined
      : await runGit(["check-ref-format", "--branch", readableBranch], {
          cwd: repository.absolutePath,
          allowFailure: true,
        });
    const branch = detached
      ? startPoint!
      : (explicitBranch ??
        (validReadableBranch?.exitCode === 0
          ? readableBranch
          : `workspace/${workspace.id.split(":").at(-1)!}/${repository.id.split(":").at(-1)!}`));
    const worktreePath = managedWorktreePath(repository.absolutePath, workspace);
    if (await pathEntryExists(worktreePath)) {
      throw new CompulsiveError(
        "CONFLICT",
        `Managed worktree path already exists: ${worktreePath}`,
      );
    }
    await ensureManagedWorktreeRoot(repository.absolutePath);
    const existingBranch = !detached && (await localBranchExists(repository.absolutePath, branch));
    const createBranch =
      !detached &&
      !existingBranch &&
      (input.useDefaultBranch === true ||
        explicitBranch === undefined ||
        input.createBranch === true);
    const remoteBranch = createBranch
      ? (defaultBranch ?? (await fetchConfiguredOriginBranch(repository.absolutePath, branch)))
      : undefined;
    if (createBranch) createdBranch = branch;
    await addGitWorktree(
      repository.absolutePath,
      worktreePath,
      branch,
      createBranch,
      remoteBranch ?? startPoint,
      detached,
      remoteBranch !== undefined,
    );
    try {
      await verifyManagedWorktree(worktreePath, repository.absolutePath, branch, detached);
      await createVerifiedLink(memberPath, worktreePath);
    } catch (error) {
      await unlinkExpectedLink(memberPath, await realpath(worktreePath)).catch(() => undefined);
      await removeGitWorktree(repository.absolutePath, worktreePath).catch(() => undefined);
      if (createBranch) {
        await runGit(["branch", "-D", "--", branch], {
          cwd: repository.absolutePath,
          allowFailure: true,
        });
      }
      throw error;
    }
    member = {
      repositoryId: repository.id,
      alias,
      mode: "worktree",
      branch,
      worktreePath: await realpath(worktreePath),
      ...(detached ? { detached: true as const } : {}),
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
        await unlinkExpectedLink(memberPath, member.worktreePath);
        await assertCleanWorktree(member.worktreePath);
        await removeGitWorktree(repository.absolutePath, member.worktreePath);
        if (createdBranch) {
          await runGit(["branch", "-D", "--", createdBranch], {
            cwd: repository.absolutePath,
            allowFailure: true,
          });
        }
      } else {
        await unlinkExpectedLink(memberPath, await realpath(repository.absolutePath));
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
  let worktreeState: { memberPath: string; worktreePath: string; linked: boolean } | undefined;
  let originalHead: string | undefined;
  if (member.mode === "worktree") {
    worktreeState = await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
    await assertCleanWorktree(worktreeState.worktreePath);
    originalHead = (await runGit(["rev-parse", "HEAD"], { cwd: member.worktreePath })).stdout;
    if (worktreeState.linked) {
      await unlinkExpectedLink(worktreeState.memberPath, worktreeState.worktreePath);
    }
    try {
      await removeGitWorktree(repository.absolutePath, worktreeState.worktreePath);
    } catch (error) {
      if (worktreeState.linked) {
        await createVerifiedLink(worktreeState.memberPath, worktreeState.worktreePath);
      }
      throw error;
    }
  } else {
    linkTarget = await verifyManagedLink(memberPath, repository.absolutePath);
    await unlinkExpectedLink(memberPath, linkTarget);
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
        await addGitWorktree(
          repository.absolutePath,
          member.worktreePath,
          member.branch,
          false,
          originalHead,
          member.detached,
        );
        if (worktreeState?.linked) {
          await createVerifiedLink(worktreeState.memberPath, member.worktreePath);
        }
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

export async function promoteWorkspaceReference(
  paths: StoragePaths,
  input: PromoteWorkspaceReferenceInput,
): Promise<WorkspaceRecord> {
  const branch = input.branch.trim();
  if (!branch) throw new CompulsiveError("INVALID_INPUT", "Development branch is required.");
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
  if (member.mode !== "worktree") {
    throw new CompulsiveError("CONFLICT", "Workspace member is not a managed worktree.");
  }
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
  if (!member.detached) await assertCleanWorktree(member.worktreePath);
  if (!member.detached && member.branch === branch) return workspace;
  const validBranch = await runGit(["check-ref-format", "--branch", branch], {
    cwd: repository.absolutePath,
    allowFailure: true,
  });
  if (validBranch.exitCode !== 0) {
    throw new CompulsiveError("INVALID_INPUT", `Invalid development branch: ${branch}`);
  }
  const existingBranch = await runGit(["show-ref", "--verify", `refs/heads/${branch}`], {
    cwd: repository.absolutePath,
    allowFailure: true,
  });
  const createdBranch = existingBranch.exitCode !== 0;
  const remoteBranch = createdBranch
    ? await fetchConfiguredOriginBranch(repository.absolutePath, branch)
    : undefined;
  const originalCommit = (await runGit(["rev-parse", "HEAD"], { cwd: member.worktreePath })).stdout;
  const rollback = async () => {
    await runGit(
      member.detached
        ? ["switch", "--detach", originalCommit]
        : ["switch", "--ignore-other-worktrees", member.branch],
      { cwd: member.worktreePath },
    );
    if (createdBranch) {
      await runGit(["branch", "-D", "--", branch], { cwd: repository.absolutePath });
    }
  };
  try {
    await runGit(
      createdBranch
        ? remoteBranch
          ? ["switch", "--track", "-c", branch, remoteBranch]
          : ["switch", "-c", branch]
        : ["switch", "--ignore-other-worktrees", branch],
      { cwd: member.worktreePath },
    );
    await verifyManagedWorktree(member.worktreePath, repository.absolutePath, branch);
  } catch (error) {
    await rollback().catch(() => undefined);
    throw error;
  }

  const updatedMember: WorkspaceMember = {
    repositoryId: member.repositoryId,
    alias: member.alias,
    mode: "worktree",
    branch,
    worktreePath: member.worktreePath,
  };
  const updated: WorkspaceRecord = {
    ...workspace,
    members: workspace.members.map((candidate, candidateIndex) =>
      candidateIndex === memberIndex ? updatedMember : candidate,
    ),
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the reference could not be restored.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
  return updated;
}

export async function convertWorkspaceToReference(
  paths: StoragePaths,
  input: ConvertWorkspaceToReferenceInput,
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
  if (member.mode !== "worktree" || member.detached) {
    throw new CompulsiveError("CONFLICT", "Workspace member is not a development worktree.");
  }
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  const state = await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
  await assertCleanWorktree(state.worktreePath);
  const remoteBranch = await fetchOriginDefaultBranch(repository.absolutePath);
  await runGit(["switch", "--detach", remoteBranch], { cwd: state.worktreePath });
  try {
    await verifyManagedWorktree(state.worktreePath, repository.absolutePath, remoteBranch, true);
  } catch (error) {
    await runGit(["switch", member.branch], { cwd: state.worktreePath }).catch(() => undefined);
    throw error;
  }

  const referenceMember: WorkspaceMember = {
    repositoryId: member.repositoryId,
    alias: member.alias,
    mode: "worktree",
    branch: remoteBranch,
    worktreePath: member.worktreePath,
    detached: true,
  };
  const updated: WorkspaceRecord = {
    ...workspace,
    members: workspace.members.map((candidate, candidateIndex) =>
      candidateIndex === memberIndex ? referenceMember : candidate,
    ),
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      await runGit(["switch", member.branch], { cwd: state.worktreePath });
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the development branch could not be restored.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
  return updated;
}
