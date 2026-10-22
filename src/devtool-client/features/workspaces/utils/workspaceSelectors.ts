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

function needsAttention(status: WorkspaceMemberStatus | undefined): boolean {
  return Boolean(
    status?.changes.length ||
    status?.conflicts.length ||
    status?.behind ||
    status?.unpushed ||
    status?.forcePushRequired ||
    status?.comparisonError,
  );
}

export function filterWorkspaceMembers(
  members: WorkspaceMember[],
  repositories: RepositoryRecord[],
  status: WorkspaceStatusResult | undefined,
  filters: { query: string; mode: string; state: string },
): WorkspaceMember[] {
  const query = filters.query.trim().toLowerCase();
  return members.filter((member) => {
    const observation = statusFor(status, member);
    const mode = member.mode === "worktree" && member.detached ? "reference" : member.mode;
    const stateMatches =
      filters.state === "all" ||
      (filters.state === "attention" && needsAttention(observation)) ||
      (filters.state === "unpushed" &&
        Boolean(observation?.unpushed || observation?.forcePushRequired)) ||
      (filters.state === "conflicts" && Boolean(observation?.conflicts.length));
    return (
      (filters.mode === "all" || mode === filters.mode) &&
      stateMatches &&
      [
        member.alias,
        repositoryFor(repositories, member)?.classificationPath ?? "",
        observation?.branch ?? "",
      ].some((value) => value.toLowerCase().includes(query))
    );
  });
}

export function countWorkspaceStatuses(
  members: WorkspaceMember[],
  status: WorkspaceStatusResult | undefined,
) {
  const ids = new Set(members.map((member) => member.repositoryId));
  const observations = (status?.members ?? []).filter((observation) =>
    ids.has(observation.repositoryId),
  );
  return {
    all: members.length,
    attention: observations.filter(needsAttention).length,
    unpushed: observations.filter(
      (observation) => observation.unpushed || observation.forcePushRequired,
    ).length,
    conflicts: observations.filter((observation) => observation.conflicts.length).length,
  };
}

export function isTaskComplete(status: WorkspaceMemberStatus | undefined): boolean {
  return Boolean(
    status?.mergedIntoDefault &&
    !status.unpushed &&
    !status.forcePushRequired &&
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
    status &&
    (status.forcePushRequired || (status.unpushed && !status.changes.length)) &&
    !status.conflicts.length,
  );
}
