import {
  type StoragePaths,
  readWorkspaceRegistry,
  readRegistry,
  writeJsonAtomic,
  readWorkspaceStatusRegistry,
} from "./storage.js";
import {
  type WorkspaceGitActionInput,
  type WorkspaceMember,
  type RepositoryRecord,
  type WorkspaceId,
  type WorkspacePushInput,
  type WorkspaceBranchSyncResult,
  type WorkspaceBranchSyncItem,
} from "./types.js";
import { findWorkspace, findRepository } from "./workspace-registry.js";
import { CompulsiveError } from "./errors.js";
import { verifyWorkspaceWorktree, assertCleanWorktree } from "./workspace-worktrees.js";
import { originBranch, fetchOriginDefaultBranch } from "./workspace-branches.js";
import { runGit } from "./git.js";

async function getCleanWorkspaceWorktree(
  paths: StoragePaths,
  input: WorkspaceGitActionInput,
): Promise<{
  member: Extract<WorkspaceMember, { mode: "worktree" }>;
  repository: RepositoryRecord;
}> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const member = workspace.members.find(({ repositoryId }) => repositoryId === input.repositoryId);
  if (!member)
    throw new CompulsiveError("NOT_FOUND", "Repository is not a member of this workspace.");
  if (member.mode !== "worktree") {
    throw new CompulsiveError("CONFLICT", "Workspace member is not a managed worktree.");
  }
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
  await assertCleanWorktree(member.worktreePath);
  return { member, repository };
}

async function setForcePushBase(
  paths: StoragePaths,
  workspaceId: WorkspaceId,
  repositoryId: RepositoryRecord["id"],
  forcePushBase?: string,
): Promise<void> {
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const { index, workspace } = findWorkspace(registry, workspaceId);
  registry.workspaces[index] = {
    ...workspace,
    members: workspace.members.map((member) => {
      if (member.repositoryId !== repositoryId || member.mode !== "worktree") return member;
      const { forcePushBase: _previous, ...withoutForcePushBase } = member;
      return forcePushBase ? { ...withoutForcePushBase, forcePushBase } : withoutForcePushBase;
    }),
    updatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(paths.workspaces, registry);
}

export async function rebaseWorkspaceMember(
  paths: StoragePaths,
  input: WorkspaceGitActionInput,
): Promise<void> {
  const { member, repository } = await getCleanWorkspaceWorktree(paths, input);
  const pushBranch = member.detached
    ? undefined
    : await originBranch(repository.absolutePath, member.branch, true);
  const pushTip = pushBranch
    ? (await runGit(["rev-parse", `${pushBranch}^{commit}`], { cwd: member.worktreePath })).stdout
    : undefined;
  if (pushTip) {
    // Persist before rewriting so a failed rebase cannot leave an unsafe normal push path.
    await setForcePushBase(paths, input.workspaceId, input.repositoryId, pushTip);
  }
  const remoteBranch = await fetchOriginDefaultBranch(repository.absolutePath);
  await runGit(member.detached ? ["switch", "--detach", remoteBranch] : ["rebase", remoteBranch], {
    cwd: member.worktreePath,
  });
  if (pushTip) {
    const stillFastForward = await runGit(["merge-base", "--is-ancestor", pushTip, "HEAD"], {
      cwd: member.worktreePath,
      allowFailure: true,
    });
    if (stillFastForward.exitCode === 0) {
      await setForcePushBase(paths, input.workspaceId, input.repositoryId);
    }
  }
}

export async function pushWorkspaceMember(
  paths: StoragePaths,
  input: WorkspacePushInput,
): Promise<void> {
  const { member, repository } = await getCleanWorkspaceWorktree(paths, input);
  if (member.detached) {
    throw new CompulsiveError("CONFLICT", "Workspace member is not a development worktree.");
  }
  if (input.force && !member.forcePushBase) {
    throw new CompulsiveError("CONFLICT", "当前分支不需要强制推送，请重新检查状态。");
  }
  if (member.forcePushBase) {
    const stillFastForward = await runGit(
      ["merge-base", "--is-ancestor", member.forcePushBase, "HEAD"],
      { cwd: member.worktreePath, allowFailure: true },
    );
    if (stillFastForward.exitCode !== 0) {
      if (!input.force) {
        throw new CompulsiveError(
          "CONFLICT",
          "Rebase 已改写远端分支历史，需要确认后使用 --force-with-lease 推送。",
        );
      }
      await runGit(
        [
          "push",
          "-u",
          `--force-with-lease=refs/heads/${member.branch}:${member.forcePushBase}`,
          "origin",
          `HEAD:refs/heads/${member.branch}`,
        ],
        { cwd: member.worktreePath },
      );
      await setForcePushBase(paths, input.workspaceId, input.repositoryId);
      return;
    }
    await setForcePushBase(paths, input.workspaceId, input.repositoryId);
  }
  const remoteBranch = await originBranch(repository.absolutePath, member.branch, true);
  if (remoteBranch) await runGit(["rebase", remoteBranch], { cwd: member.worktreePath });
  await runGit(["push", "-u", "origin", `HEAD:refs/heads/${member.branch}`], {
    cwd: member.worktreePath,
  });
}

export async function syncWorkspaceBranches(
  paths: StoragePaths,
  id: WorkspaceId,
): Promise<WorkspaceBranchSyncResult> {
  const [workspaceRegistry, statusRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readWorkspaceStatusRegistry(paths.workspaceStatuses),
  ]);
  const { workspace } = findWorkspace(workspaceRegistry, id);
  const previousStatus = statusRegistry.statuses.find(({ workspaceId }) => workspaceId === id);
  const items: WorkspaceBranchSyncItem[] = [];

  for (const member of workspace.members) {
    if (member.mode !== "worktree") {
      items.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        outcome: "skipped",
        message: "目录链接不参与分支同步。",
      });
      continue;
    }

    try {
      const { member: worktree, repository } = await getCleanWorkspaceWorktree(paths, {
        workspaceId: workspace.id,
        repositoryId: member.repositoryId,
      });
      const defaultBranch = await fetchOriginDefaultBranch(repository.absolutePath);
      if (worktree.detached) {
        await runGit(["switch", "--detach", defaultBranch], { cwd: worktree.worktreePath });
        items.push({
          repositoryId: member.repositoryId,
          alias: member.alias,
          outcome: "synced",
          message: `参考代码已更新到 ${defaultBranch}。`,
        });
        continue;
      }

      const remoteBranch = await originBranch(repository.absolutePath, worktree.branch, true);
      const developmentTip = previousStatus?.members.find(
        (status) =>
          status.repositoryId === member.repositoryId && status.branch === worktree.branch,
      )?.developmentTip;
      if (remoteBranch && remoteBranch !== defaultBranch && developmentTip) {
        const [merged, unpushed] = await Promise.all([
          runGit(["merge-base", "--is-ancestor", developmentTip, defaultBranch], {
            cwd: worktree.worktreePath,
            allowFailure: true,
          }),
          runGit(["rev-list", "--count", `${remoteBranch}..HEAD`], {
            cwd: worktree.worktreePath,
          }),
        ]);
        if (merged.exitCode === 0 && Number(unpushed.stdout) === 0) {
          items.push({
            repositoryId: member.repositoryId,
            alias: member.alias,
            outcome: "skipped",
            message: "远端开发分支已合入主分支。",
          });
          continue;
        }
      }
      if (remoteBranch) {
        await runGit(["merge", "--no-edit", remoteBranch], { cwd: worktree.worktreePath });
      }
      if (defaultBranch !== remoteBranch) {
        await runGit(["merge", "--no-edit", defaultBranch], { cwd: worktree.worktreePath });
      }
      await runGit(["push", "-u", "origin", `HEAD:refs/heads/${worktree.branch}`], {
        cwd: worktree.worktreePath,
      });
      items.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        outcome: "synced",
        message: `已合并 ${defaultBranch} 并推送 ${worktree.branch}。`,
      });
    } catch (error) {
      const conflicts = await runGit(["diff", "--name-only", "--diff-filter=U", "--"], {
        cwd: member.worktreePath,
        allowFailure: true,
      });
      const dirty =
        error instanceof CompulsiveError &&
        error.code === "CONFLICT" &&
        error.message.startsWith("Git worktree has uncommitted changes:");
      items.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        outcome: conflicts.stdout ? "conflict" : dirty ? "skipped" : "failed",
        message: conflicts.stdout
          ? `合并产生冲突：${conflicts.stdout.split("\n").join("、")}`
          : dirty
            ? "存在未提交变更，已跳过。"
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  }

  return { workspaceId: workspace.id, items };
}
