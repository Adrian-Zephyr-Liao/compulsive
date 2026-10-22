import { runGit } from "./git.js";
import {
  cachedOriginDefaultBranch,
  currentUpstream,
  fetchOriginDefaultBranch,
  originBranch,
} from "./workspace-branches.js";
import type { RepositoryRecord, WorkspaceMember, WorkspaceMemberStatus } from "./types.js";

export async function readWorkspaceMemberStatus(
  member: WorkspaceMember,
  repository: RepositoryRecord,
  previousMemberStatus: WorkspaceMemberStatus | undefined,
  fetchRemote: boolean,
): Promise<WorkspaceMemberStatus> {
  const path = member.mode === "worktree" ? member.worktreePath : repository.absolutePath;
  try {
    const [currentBranch, status, conflicts] = await Promise.all([
      runGit(["branch", "--show-current"], { cwd: path }),
      runGit(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: path }),
      runGit(["diff", "--name-only", "--diff-filter=U", "--"], { cwd: path }),
    ]);
    const defaultBranch = fetchRemote
      ? await fetchOriginDefaultBranch(repository.absolutePath)
      : await cachedOriginDefaultBranch(repository.absolutePath);
    let ahead: number | undefined;
    let behind: number | undefined;
    const pushBranch =
      member.mode === "worktree" && !member.detached
        ? await originBranch(repository.absolutePath, member.branch, fetchRemote)
        : undefined;
    const upstream = pushBranch ?? (await currentUpstream(path));
    let unpushed: number | undefined;
    let forcePushRequired: boolean | undefined;
    let developmentTip: string | undefined;
    let mergedIntoDefault: boolean | undefined;
    let comparisonError: string | undefined;
    if (defaultBranch) {
      const comparison = await runGit(
        ["rev-list", "--left-right", "--count", `HEAD...${defaultBranch}`],
        { cwd: path, allowFailure: true },
      );
      if (comparison.exitCode === 0) {
        [ahead, behind] = comparison.stdout.split(/\s+/).map(Number);
      } else comparisonError = comparison.stderr || "Unable to compare with the default branch.";
    } else comparisonError = "Origin default branch is unavailable.";
    if (upstream) {
      const pendingPush = await runGit(["rev-list", "--count", `${upstream}..HEAD`], {
        cwd: path,
        allowFailure: true,
      });
      if (pendingPush.exitCode === 0) unpushed = Number(pendingPush.stdout);
    }
    if (member.mode === "worktree" && member.forcePushBase) {
      const stillFastForward = await runGit(
        ["merge-base", "--is-ancestor", member.forcePushBase, "HEAD"],
        { cwd: path, allowFailure: true },
      );
      forcePushRequired = stillFastForward.exitCode !== 0;
    }
    if (defaultBranch && pushBranch && pushBranch !== defaultBranch) {
      const uniqueCommits = await runGit(
        ["rev-list", "--count", `${defaultBranch}..${pushBranch}`],
        { cwd: path, allowFailure: true },
      );
      developmentTip = previousMemberStatus?.developmentTip;
      if (uniqueCommits.exitCode === 0 && Number(uniqueCommits.stdout) > 0) {
        const remoteTip = await runGit(["rev-parse", `${pushBranch}^{commit}`], { cwd: path });
        developmentTip = remoteTip.stdout;
      }
      if (developmentTip) {
        const merged = await runGit(
          ["merge-base", "--is-ancestor", developmentTip, defaultBranch],
          { cwd: path, allowFailure: true },
        );
        if (merged.exitCode <= 1) mergedIntoDefault = merged.exitCode === 0;
      } else mergedIntoDefault = false;
    }
    return {
      repositoryId: member.repositoryId,
      branch: currentBranch.stdout || (member.mode === "worktree" ? member.branch : "detached"),
      detached: member.mode === "worktree" && member.detached === true,
      ...(developmentTip ? { developmentTip } : {}),
      ...(defaultBranch ? { defaultBranch } : {}),
      ...(ahead === undefined ? {} : { ahead }),
      ...(behind === undefined ? {} : { behind }),
      ...(upstream ? { upstream } : {}),
      ...(unpushed === undefined ? {} : { unpushed }),
      ...(forcePushRequired === undefined ? {} : { forcePushRequired }),
      ...(mergedIntoDefault === undefined ? {} : { mergedIntoDefault }),
      changes: status.stdout ? status.stdout.split("\n") : [],
      conflicts: conflicts.stdout ? conflicts.stdout.split("\n") : [],
      ...(comparisonError ? { comparisonError } : {}),
    };
  } catch (error) {
    return {
      repositoryId: member.repositoryId,
      branch: member.mode === "worktree" ? member.branch : "unknown",
      detached: member.mode === "worktree" && member.detached === true,
      changes: [],
      conflicts: [],
      comparisonError: error instanceof Error ? error.message : String(error),
    };
  }
}
