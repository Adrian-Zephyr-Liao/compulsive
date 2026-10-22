import { beforeEach, describe, expect, it, vi } from "vitest";

import { runGit } from "../src/git.js";
import type { RepositoryRecord, WorkspaceMember } from "../src/types.js";
import {
  cachedOriginDefaultBranch,
  currentUpstream,
  fetchOriginDefaultBranch,
  originBranch,
} from "../src/workspace-branches.js";
import { readWorkspaceMemberStatus } from "../src/workspace-status.js";

vi.mock("../src/git.js", () => ({ runGit: vi.fn() }));
vi.mock("../src/workspace-branches.js", () => ({
  cachedOriginDefaultBranch: vi.fn(),
  currentUpstream: vi.fn(),
  fetchOriginDefaultBranch: vi.fn(),
  originBranch: vi.fn(),
}));

const repository: RepositoryRecord = {
  id: "local:example" as RepositoryRecord["id"],
  kind: "local",
  name: "example",
  classificationPath: "local/example",
  absolutePath: "/example/repository",
  isManaged: true,
  registeredAt: "2026-10-21T00:00:00Z",
  lastSeenAt: "2026-10-21T00:00:00Z",
};
const member: Extract<WorkspaceMember, { mode: "worktree" }> = {
  repositoryId: repository.id,
  alias: "example",
  mode: "worktree",
  branch: "feat/task",
  worktreePath: "/example/repository/.worktrees/task",
};

describe("workspace member observations", () => {
  let responses: Map<string, string>;
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cachedOriginDefaultBranch).mockResolvedValue("origin/master");
    vi.mocked(fetchOriginDefaultBranch).mockResolvedValue("origin/master");
    vi.mocked(originBranch).mockResolvedValue("origin/feat/task");
    responses = new Map([
      ["branch --show-current", "feat/task"],
      ["status --porcelain=v1 --untracked-files=all", " M tracked.txt\n?? new.txt"],
      ["diff --name-only --diff-filter=U --", "conflicted.txt"],
      ["rev-list --left-right --count HEAD...origin/master", "3\t2"],
      ["rev-list --count origin/feat/task..HEAD", "4"],
      ["rev-list --count origin/master..origin/feat/task", "0"],
      ["rev-parse origin/feat/task^{commit}", "observed-tip"],
      ["merge-base --is-ancestor observed-tip origin/master", ""],
    ]);
    vi.mocked(runGit).mockImplementation(async (args) => {
      const stdout = responses.get(args.join(" "));
      if (stdout === undefined) throw new Error(`Unexpected Git command: ${args.join(" ")}`);
      const notMerged =
        args[0] === "merge-base" &&
        responses.get("rev-list --count origin/master..origin/feat/task") !== "0";
      return { stdout, stderr: "", exitCode: notMerged ? 1 : 0 };
    });
  });

  it("separates default-branch comparison from pending pushes without fetching", async () => {
    const status = await readWorkspaceMemberStatus(member, repository, undefined, false);
    expect(status).toMatchObject({
      branch: "feat/task",
      defaultBranch: "origin/master",
      ahead: 3,
      behind: 2,
      upstream: "origin/feat/task",
      unpushed: 4,
      changes: [" M tracked.txt", "?? new.txt"],
      conflicts: ["conflicted.txt"],
      mergedIntoDefault: false,
    });
    expect(fetchOriginDefaultBranch).not.toHaveBeenCalled();
    expect(originBranch).toHaveBeenCalledWith(repository.absolutePath, member.branch, false);
    expect(currentUpstream).not.toHaveBeenCalled();
    expect(runGit).toHaveBeenCalledWith(["branch", "--show-current"], { cwd: member.worktreePath });
  });

  it("does not call an identical new branch merged without a previously observed development tip", async () => {
    const status = await readWorkspaceMemberStatus(member, repository, undefined, false);
    expect(status.mergedIntoDefault).toBe(false);
    expect(status.developmentTip).toBeUndefined();
    expect(vi.mocked(runGit).mock.calls.some(([args]) => args[0] === "merge-base")).toBe(false);
  });

  it("retains the observed tip when checking whether a development branch was merged", async () => {
    const status = await readWorkspaceMemberStatus(
      member,
      repository,
      {
        repositoryId: repository.id,
        branch: member.branch,
        detached: false,
        developmentTip: "observed-tip",
        changes: [],
        conflicts: [],
      },
      false,
    );
    expect(status.developmentTip).toBe("observed-tip");
    expect(status.mergedIntoDefault).toBe(true);
  });

  it("records a remote development tip only while it contains unique commits", async () => {
    responses.set("rev-list --count origin/master..origin/feat/task", "1");
    expect(await readWorkspaceMemberStatus(member, repository, undefined, true)).toMatchObject({
      developmentTip: "observed-tip",
      mergedIntoDefault: false,
    });
    expect(fetchOriginDefaultBranch).toHaveBeenCalledWith(repository.absolutePath);
    expect(cachedOriginDefaultBranch).not.toHaveBeenCalled();
  });

  it("keeps Git failures bounded to the affected member observation", async () => {
    vi.mocked(runGit).mockRejectedValue(new Error("Git unavailable"));
    expect(await readWorkspaceMemberStatus(member, repository, undefined, false)).toEqual({
      repositoryId: repository.id,
      branch: member.branch,
      detached: false,
      changes: [],
      conflicts: [],
      comparisonError: "Git unavailable",
    });
  });
});
