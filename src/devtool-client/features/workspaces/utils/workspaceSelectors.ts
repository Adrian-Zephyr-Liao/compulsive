import type {
  RepositoryRecord,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceStatusResult,
} from "../../../../types.js";

export function repositoryFor(
  repositories: RepositoryRecord[],
  member: WorkspaceMember,
): RepositoryRecord | undefined {
  return repositories.find((repository) => repository.id === member.repositoryId);
}

export function statusFor(
  status: WorkspaceStatusResult | undefined,
  member: WorkspaceMember,
): WorkspaceMemberStatus | undefined {
  return status?.members.find((item) => item.repositoryId === member.repositoryId);
}

export function isTaskComplete(status: WorkspaceMemberStatus | undefined): boolean {
  return Boolean(
    status?.mergedIntoDefault &&
    !status.unpushed &&
    !status.changes.length &&
    !status.conflicts.length,
  );
}

export function isNonDefaultBranch(
  member: WorkspaceMember,
  status: WorkspaceMemberStatus | undefined,
): boolean {
  if (member.mode !== "worktree" || member.detached) return false;
  const activeBranch = status?.branch ?? member.branch;
  const defaultBranch = status?.defaultBranch?.replace(/^origin\//, "");
  return defaultBranch
    ? activeBranch !== defaultBranch
    : activeBranch !== "main" && activeBranch !== "master";
}

export function canRebase(
  member: WorkspaceMember,
  status: WorkspaceMemberStatus | undefined,
  fresh: boolean,
): boolean {
  if (member.mode === "worktree" && member.detached) return true;
  return Boolean(
    fresh &&
    member.mode === "worktree" &&
    status &&
    !status.comparisonError &&
    !isTaskComplete(status) &&
    status.behind &&
    !status.changes.length &&
    !status.conflicts.length,
  );
}

export function canPush(
  member: WorkspaceMember,
  status: WorkspaceMemberStatus | undefined,
  fresh: boolean,
): boolean {
  return Boolean(
    fresh &&
    member.mode === "worktree" &&
    !member.detached &&
    status?.unpushed &&
    !status.changes.length &&
    !status.conflicts.length,
  );
}
