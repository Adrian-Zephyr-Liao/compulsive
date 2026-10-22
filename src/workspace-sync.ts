import {
  type StoragePaths,
  readWorkspaceRegistry,
  readRegistry,
  writeJsonAtomic,
  readWorkspaceStatusRegistry,
} from "./storage.js";
import {
  type WorkspaceGitActionInput,
  type RepositoryRecord,
  type WorkspaceId,
  type WorkspacePushInput,
  type WorkspaceBranchSyncResult,
  type WorkspaceBranchSyncItem,
  type WorkspaceStatusResult,
} from "./types.js";
import { findWorkspace, findRepository } from "./workspace-registry.js";
import { CompulsiveError } from "./errors.js";
import { verifyWorkspaceWorktree, assertCleanWorktree } from "./workspace-worktrees.js";
import { originBranch, fetchOriginDefaultBranch } from "./workspace-branches.js";
import { runGit } from "./git.js";
import {
  appendWorkspaceBackupMessage,
  assertNoIgnoredRebaseCollisions,
  hasUnfinishedGitOperation,
  restoreWorkspaceChanges,
  stashWorkspaceChanges,
  withWorkspaceSyncLock,
} from "./workspace-sync-stash.js";

function rebaseArguments(target: string): string[] {
  return ["-c", "rebase.autoStash=false", "-c", "rebase.updateRefs=false", "rebase", target];
}

async function getWorkspaceWorktree(paths: StoragePaths, input: WorkspaceGitActionInput) {
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
  return { workspace, member, repository };
}

async function getCleanWorkspaceWorktree(paths: StoragePaths, input: WorkspaceGitActionInput) {
  const state = await getWorkspaceWorktree(paths, input);
  await assertCleanWorktree(state.member.worktreePath);
  return state;
}

let forcePushWrites = Promise.resolve();

function setForcePushBase(
  paths: StoragePaths,
  workspaceId: WorkspaceId,
  repositoryId: RepositoryRecord["id"],
  forcePushBase?: string,
): Promise<void> {
  const update = forcePushWrites.then(async () => {
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
  });
  forcePushWrites = update.catch(() => undefined);
  return update;
}

export async function rebaseWorkspaceMember(
  paths: StoragePaths,
  input: WorkspaceGitActionInput,
): Promise<void> {
  const { member } = await getWorkspaceWorktree(paths, input);
  return withWorkspaceSyncLock(member.worktreePath, () =>
    rebaseWorkspaceMemberUnlocked(paths, input),
  );
}

async function rebaseWorkspaceMemberUnlocked(
  paths: StoragePaths,
  input: WorkspaceGitActionInput,
): Promise<void> {
  const { member, repository } = await getCleanWorkspaceWorktree(paths, input);
  const pushBranch = member.detached
    ? undefined
    : await originBranch(repository.absolutePath, member.branch, true);
  // Keep the lease captured before the first rewrite; a later fetch is not consent to replace remote work.
  const alreadyRewritten =
    member.forcePushBase &&
    (
      await runGit(["merge-base", "--is-ancestor", member.forcePushBase, "HEAD"], {
        cwd: member.worktreePath,
        allowFailure: true,
      })
    ).exitCode !== 0;
  const pushTip = alreadyRewritten
    ? member.forcePushBase
    : pushBranch
      ? (await runGit(["rev-parse", `${pushBranch}^{commit}`], { cwd: member.worktreePath })).stdout
      : undefined;
  const remoteBranch = await fetchOriginDefaultBranch(repository.absolutePath);
  if (pushTip) {
    if (
      !alreadyRewritten &&
      (
        await runGit(["merge-base", "--is-ancestor", pushTip, "HEAD"], {
          cwd: member.worktreePath,
          allowFailure: true,
        })
      ).exitCode !== 0 &&
      (
        await runGit(["merge-base", "--is-ancestor", pushTip, remoteBranch], {
          cwd: member.worktreePath,
          allowFailure: true,
        })
      ).exitCode !== 0
    )
      throw new CompulsiveError(
        "CONFLICT",
        "The same-name origin branch has commits not present locally. Synchronize that branch before rebasing onto the default branch.",
      );
  }
  if (!member.detached) await assertNoIgnoredRebaseCollisions(member.worktreePath, remoteBranch);
  // Guard first, then persist the lease before rewriting any published history.
  if (pushTip || member.forcePushBase)
    await setForcePushBase(paths, input.workspaceId, input.repositoryId, pushTip);
  await runGit(
    member.detached
      ? ["switch", "--no-overwrite-ignore", "--detach", remoteBranch]
      : rebaseArguments(remoteBranch),
    { cwd: member.worktreePath },
  );
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
  const { member } = await getWorkspaceWorktree(paths, input);
  return withWorkspaceSyncLock(member.worktreePath, async () => {
    const state = await getWorkspaceWorktree(paths, input);
    if (!input.force || !state.member.forcePushBase)
      return pushWorkspaceMemberUnlocked(paths, input);
    const cwd = state.member.worktreePath;
    const item: WorkspaceBranchSyncItem = {
      repositoryId: input.repositoryId,
      alias: state.member.alias,
      outcome: "failed",
      phase: "preflight",
      message: "",
    };
    const verify = () =>
      verifyWorkspaceWorktree(state.workspace, state.member, state.repository.absolutePath);
    let pushed = false;
    try {
      if (await hasUnfinishedGitOperation(cwd))
        throw new CompulsiveError("CONFLICT", "存在未完成的 Git 操作或冲突，请先处理后再推送。");
      await stashWorkspaceChanges(cwd, item);
      item.phase = "push";
      await pushWorkspaceMemberUnlocked(paths, input);
      pushed = true;
      await restoreWorkspaceChanges(cwd, item, verify);
    } catch (error) {
      const unfinished = await hasUnfinishedGitOperation(cwd).catch(() => true);
      item.message = error instanceof Error ? error.message : String(error);
      if (pushed) item.message = `推送已完成，但${item.message}`;
      if (item.backup && !item.backup.restored && !unfinished && item.phase !== "restore") {
        try {
          await restoreWorkspaceChanges(cwd, item, verify);
        } catch (restoreError) {
          item.message += ` ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`;
        }
      }
      appendWorkspaceBackupMessage(item);
      throw new CompulsiveError(
        error instanceof CompulsiveError ? error.code : "GIT_FAILED",
        item.message,
      );
    }
  });
}

async function pushWorkspaceMemberUnlocked(
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
  if (remoteBranch) {
    await assertNoIgnoredRebaseCollisions(member.worktreePath, remoteBranch);
    await runGit(rebaseArguments(remoteBranch), { cwd: member.worktreePath });
  }
  await runGit(["push", "-u", "origin", `HEAD:refs/heads/${member.branch}`], {
    cwd: member.worktreePath,
  });
}

async function syncWorkspaceBranch(
  paths: StoragePaths,
  workspaceId: WorkspaceId,
  item: WorkspaceBranchSyncItem,
  previousStatus?: WorkspaceStatusResult,
): Promise<void> {
  const { workspace, member, repository } = await getWorkspaceWorktree(paths, {
    workspaceId,
    repositoryId: item.repositoryId,
  });
  const cwd = member.worktreePath;
  const verify = () => verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
  try {
    if (await hasUnfinishedGitOperation(cwd))
      throw new CompulsiveError("CONFLICT", "存在未完成的 Git 操作或冲突，请先处理后再同步。");
    await stashWorkspaceChanges(cwd, item);
    item.phase = "fetch";
    const defaultBranch = await fetchOriginDefaultBranch(repository.absolutePath);
    await verify();
    await assertCleanWorktree(cwd);
    if (member.detached) {
      item.phase = "rebase";
      await runGit(["switch", "--no-overwrite-ignore", "--detach", defaultBranch], { cwd });
      item.outcome = "synced";
      item.message = `参考代码已更新到 ${defaultBranch}。`;
    } else {
      const remoteBranch = await originBranch(repository.absolutePath, member.branch, true);
      const developmentTip = previousStatus?.members.find(
        (status) => status.repositoryId === member.repositoryId && status.branch === member.branch,
      )?.developmentTip;
      let merged = false;
      if (remoteBranch && remoteBranch !== defaultBranch && developmentTip) {
        const [contained, unpushed] = await Promise.all([
          runGit(["merge-base", "--is-ancestor", developmentTip, defaultBranch], {
            cwd,
            allowFailure: true,
          }),
          runGit(["rev-list", "--count", `${remoteBranch}..HEAD`], { cwd }),
        ]);
        merged = contained.exitCode === 0 && Number(unpushed.stdout) === 0;
      }
      if (merged && !member.forcePushBase) {
        item.outcome = "skipped";
        item.message = "远端开发分支已合入主分支。";
      } else {
        const alreadyRewritten =
          member.forcePushBase &&
          (
            await runGit(["merge-base", "--is-ancestor", member.forcePushBase, "HEAD"], {
              cwd,
              allowFailure: true,
            })
          ).exitCode !== 0;
        const pushTip = alreadyRewritten
          ? member.forcePushBase
          : remoteBranch
            ? (await runGit(["rev-parse", `${remoteBranch}^{commit}`], { cwd })).stdout
            : undefined;
        await verify();
        await assertCleanWorktree(cwd);
        if (await hasUnfinishedGitOperation(cwd))
          throw new CompulsiveError("CONFLICT", "Git 状态已变化，请先处理当前操作。");
        item.phase = "rebase";
        // Do not replay the old published history into a branch already rewritten by rebase.
        if (remoteBranch && !alreadyRewritten) {
          await assertNoIgnoredRebaseCollisions(cwd, remoteBranch);
          await runGit(rebaseArguments(remoteBranch), { cwd });
        }
        if (defaultBranch !== remoteBranch || alreadyRewritten) {
          await assertNoIgnoredRebaseCollisions(cwd, defaultBranch);
          // A lease is valid only after the same-name remote commits have been integrated.
          if (pushTip || member.forcePushBase)
            await setForcePushBase(paths, workspaceId, member.repositoryId, pushTip);
          await runGit(rebaseArguments(defaultBranch), { cwd });
        }
        await verify();
        await assertCleanWorktree(cwd);
        const needsForce =
          pushTip &&
          (
            await runGit(["merge-base", "--is-ancestor", pushTip, "HEAD"], {
              cwd,
              allowFailure: true,
            })
          ).exitCode !== 0;
        item.phase = "push";
        if (needsForce) {
          item.outcome = "push-required";
          item.message = `已 Rebase ${defaultBranch}，本地提交历史已重写；请确认后使用安全强制推送，不会自动强推。`;
        } else {
          if (pushTip) await setForcePushBase(paths, workspaceId, member.repositoryId);
          await runGit(["push", "-u", "origin", `HEAD:refs/heads/${member.branch}`], { cwd });
          item.outcome = "synced";
          item.message = `已 Rebase ${defaultBranch} 并推送 ${member.branch}。`;
        }
      }
    }
    await restoreWorkspaceChanges(cwd, item, verify);
  } catch (error) {
    const phase = item.phase ?? "preflight";
    const unfinished = await hasUnfinishedGitOperation(cwd).catch(() => true);
    const completed = phase === "restore" && item.outcome !== "failed" ? item.message : "";
    item.outcome = unfinished || phase === "restore" ? "conflict" : "failed";
    item.message = `${completed}${completed ? " 但" : ""}${error instanceof Error ? error.message : String(error)}`;
    if (item.backup && !item.backup.restored && !unfinished && phase !== "restore") {
      try {
        await restoreWorkspaceChanges(cwd, item, verify);
        item.phase = phase;
      } catch (restoreError) {
        item.outcome = "conflict";
        item.message += ` ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`;
      }
    }
  }
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
    const item: WorkspaceBranchSyncItem = {
      repositoryId: member.repositoryId,
      alias: member.alias,
      outcome: "failed",
      phase: "preflight",
      message: "",
    };
    if (member.mode === "link") {
      item.outcome = "skipped";
      item.message = "目录链接不参与分支同步。";
    } else {
      try {
        await withWorkspaceSyncLock(member.worktreePath, () =>
          syncWorkspaceBranch(paths, workspace.id, item, previousStatus),
        );
      } catch (error) {
        item.message = error instanceof Error ? error.message : String(error);
      }
    }
    if (item.backup && !item.backup.restored) appendWorkspaceBackupMessage(item);
    items.push(item);
  }
  return { workspaceId: workspace.id, items };
}
