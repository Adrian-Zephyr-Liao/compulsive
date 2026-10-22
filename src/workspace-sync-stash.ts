import { randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { CompulsiveError } from "./errors.js";
import { runGit } from "./git.js";
import { assertCleanWorktree } from "./workspace-worktrees.js";
import type { WorkspaceBranchSyncItem } from "./types.js";

const activeWorktrees = new Set<string>();

export async function withWorkspaceSyncLock<T>(path: string, task: () => Promise<T>): Promise<T> {
  const key = await realpath(path);
  if (activeWorktrees.has(key))
    throw new CompulsiveError("CONFLICT", "该仓库正在同步，请等待当前操作完成。");
  activeWorktrees.add(key);
  try {
    return await task();
  } finally {
    activeWorktrees.delete(key);
  }
}

export async function hasUnfinishedGitOperation(path: string): Promise<boolean> {
  const [conflicts, directory] = await Promise.all([
    runGit(["ls-files", "--unmerged", "-z"], { cwd: path }),
    runGit(["rev-parse", "--absolute-git-dir"], { cwd: path }),
  ]);
  if (conflicts.stdout) return true;
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ]) {
    try {
      await lstat(join(directory.stdout, marker));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return false;
}

export async function stashWorkspaceChanges(
  path: string,
  item: WorkspaceBranchSyncItem,
): Promise<void> {
  const status = await runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: path,
  });
  if (!status.stdout) return;
  item.phase = "stash";
  const message = `cpl-sync-${randomUUID()}`;
  const result = await runGit(["stash", "push", "--include-untracked", "--message", message], {
    cwd: path,
    allowFailure: true,
  });
  // The stash ref is shared by every worktree; never assume our backup is stash@{0}.
  const reflog = await runGit(["reflog", "show", "--format=%H%x00%gs", "refs/stash"], {
    cwd: path,
    allowFailure: true,
  });
  const entry = reflog.stdout
    .split("\n")
    .map((line) => line.split("\0"))
    .find(([, subject]) => subject?.endsWith(`: ${message}`));
  const oid = entry?.[0];
  if (!oid || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(oid)) {
    throw new CompulsiveError(
      "CONFLICT",
      `自动暂存备份未能验证，已停止同步。请在 git stash list 中查找 ${message}。${result.stderr}`,
    );
  }
  item.backup = { oid, restored: false };
  if (result.exitCode !== 0)
    throw new CompulsiveError("GIT_FAILED", `自动暂存未完成。${result.stderr}`);
  await assertCleanWorktree(path);
}

export async function assertNoIgnoredRebaseCollisions(path: string, target: string): Promise<void> {
  const [baseChanges, replayedChanges, index] = await Promise.all([
    runGit(
      ["diff", "--name-status", "--no-renames", "--diff-filter=A", "-z", "HEAD", target, "--"],
      {
        cwd: path,
      },
    ),
    runGit(
      [
        "log",
        "--format=",
        "--name-status",
        "--no-renames",
        "--diff-filter=A",
        "-m",
        "-z",
        `${target}..HEAD`,
        "--",
      ],
      { cwd: path },
    ),
    runGit(["ls-files", "--stage", "-z"], { cwd: path }),
  ]);
  const tracked = new Set(
    index.stdout
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(entry.indexOf("\t") + 1)),
  );
  const candidates = new Set<string>();
  for (const output of [baseChanges.stdout, replayedChanges.stdout]) {
    const fields = output.split("\0");
    for (let index = 0; index + 1 < fields.length; index += 2) {
      if (fields[index]?.trim() !== "A" || !fields[index + 1])
        throw new CompulsiveError("CONFLICT", "无法安全检查 Rebase 路径，已停止同步。");
      const candidate = fields[index + 1]!;
      if (!tracked.has(candidate)) candidates.add(candidate);
    }
  }
  // Git rebase may silently overwrite ignored files; inspect only paths it can introduce.
  for (const candidate of candidates) {
    let location = path;
    const parts = candidate.split("/");
    for (const [index, part] of parts.entries()) {
      location = join(location, part);
      let entry;
      try {
        entry = await lstat(location);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
        throw error;
      }
      if (index === parts.length - 1 || !entry.isDirectory() || entry.isSymbolicLink())
        throw new CompulsiveError(
          "CONFLICT",
          `Rebase 会覆盖本地未跟踪或忽略的路径 ${candidate}，已停止同步；请先备份或移动该文件。`,
        );
    }
  }
}

export async function restoreWorkspaceChanges(
  path: string,
  item: WorkspaceBranchSyncItem,
  verify: () => Promise<unknown>,
): Promise<void> {
  if (!item.backup || item.backup.restored) return;
  const previousPhase = item.phase;
  item.phase = "restore";
  await verify();
  if (await hasUnfinishedGitOperation(path))
    throw new CompulsiveError("CONFLICT", "Git 操作尚未完成，未回放原有本地改动。");
  // Do not overlay a developer's edits made while fetch/rebase/push was running.
  await assertCleanWorktree(path);
  const result = await runGit(["stash", "apply", "--index", item.backup.oid], {
    cwd: path,
    allowFailure: true,
  });
  if (result.exitCode !== 0)
    throw new CompulsiveError("CONFLICT", `回放原有本地改动时产生冲突。${result.stderr}`);
  item.backup.restored = true;
  if (previousPhase) item.phase = previousPhase;
}

export function appendWorkspaceBackupMessage(item: WorkspaceBranchSyncItem): void {
  if (!item.backup) return;
  item.message += item.backup.restored
    ? ` 原有本地改动与暂存状态已恢复；备份 ${item.backup.oid} 仍保留在 Git stash。`
    : item.phase === "restore"
      ? ` 备份 ${item.backup.oid} 仍保留在 Git stash；本地改动可能已部分恢复，请先检查 git status 并人工处理，不要重复执行 stash apply。`
      : ` 原有本地改动保留在备份 ${item.backup.oid}；处理完当前 Git 状态后，可用 git stash apply --index ${item.backup.oid} 恢复。`;
}
