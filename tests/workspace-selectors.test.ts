import { describe, expect, it } from "vitest";
import type {
  RepositoryRecord,
  WorkspaceId,
  WorkspaceMember,
  WorkspaceStatusResult,
} from "../src/types.js";
import {
  countWorkspaceStatuses,
  canPush,
  filterWorkspaceMembers,
  isTaskComplete,
} from "../src/devtool-client/features/workspaces/utils/workspaceSelectors.js";

const repository: RepositoryRecord = {
  id: "local:example" as RepositoryRecord["id"],
  kind: "local",
  name: "example",
  classificationPath: "local/example",
  absolutePath: "/example",
  isManaged: true,
  registeredAt: "2026-10-21",
  lastSeenAt: "2026-10-21",
};
const development: WorkspaceMember = {
  repositoryId: repository.id,
  alias: "Application",
  mode: "worktree",
  branch: "feat/task",
  worktreePath: "/example/.worktrees/task",
};
const reference: WorkspaceMember = {
  repositoryId: "local:reference" as RepositoryRecord["id"],
  alias: "Reference",
  mode: "worktree",
  branch: "origin/main",
  worktreePath: "/reference/.worktrees/task",
  detached: true,
};
const members = [development, reference];
const status: WorkspaceStatusResult = {
  workspaceId: "workspace:test" as WorkspaceId,
  checkedAt: "2026-10-21",
  members: [
    {
      repositoryId: development.repositoryId,
      branch: "feat/task",
      detached: false,
      changes: [" M file"],
      conflicts: ["file"],
      unpushed: 2,
    },
    {
      repositoryId: reference.repositoryId,
      branch: "origin/main",
      detached: true,
      changes: [],
      conflicts: [],
    },
    {
      repositoryId: "local:removed" as RepositoryRecord["id"],
      branch: "feat/removed",
      detached: false,
      changes: ["?? orphan"],
      conflicts: ["orphan"],
      unpushed: 10,
    },
  ],
};

describe("workspace view selectors", () => {
  it("filters development and detached references without changing member order", () => {
    expect(
      filterWorkspaceMembers(members, [repository], status, {
        query: "",
        mode: "reference",
        state: "all",
      }),
    ).toEqual([reference]);
    expect(
      filterWorkspaceMembers(members, [repository], status, {
        query: "",
        mode: "worktree",
        state: "all",
      }),
    ).toEqual([development]);
    expect(
      filterWorkspaceMembers(members, [repository], status, {
        query: "",
        mode: "all",
        state: "all",
      }),
    ).toEqual(members);
  });
  it("searches aliases, classification paths and observed branches case-insensitively", () => {
    for (const query of [" Application ", "LOCAL/EXAMPLE", "FEAT/TASK"]) {
      expect(
        filterWorkspaceMembers(members, [repository], status, {
          query,
          mode: "all",
          state: "attention",
        }),
      ).toEqual([development]);
    }
    for (const state of ["conflicts", "unpushed"])
      expect(
        filterWorkspaceMembers(members, [repository], status, { query: "", mode: "all", state }),
      ).toEqual([development]);
  });
  it("excludes orphaned cached observations from the counts", () => {
    expect(countWorkspaceStatuses(members, status)).toEqual({
      all: 2,
      attention: 1,
      unpushed: 1,
      conflicts: 1,
    });
    expect(countWorkspaceStatuses(members, undefined)).toEqual({
      all: 2,
      attention: 0,
      unpushed: 0,
      conflicts: 0,
    });
    expect(
      filterWorkspaceMembers(members, [], undefined, {
        query: "",
        mode: "all",
        state: "attention",
      }),
    ).toEqual([]);
  });

  it("allows confirmed safe force push with restored WIP but retains ordinary push and conflict guards", () => {
    const forceStatus = {
      ...status.members[0]!,
      conflicts: [],
      unpushed: 0,
      forcePushRequired: true,
    };
    expect(canPush(development, forceStatus, true)).toBe(true);
    expect(canPush(development, forceStatus, false)).toBe(false);
    expect(canPush(development, { ...forceStatus, conflicts: ["file"] }, true)).toBe(false);
    expect(canPush(reference, forceStatus, true)).toBe(false);
    expect(canPush({ ...development, mode: "link" }, forceStatus, true)).toBe(false);
    expect(canPush(development, undefined, true)).toBe(false);
    expect(
      canPush(development, { ...forceStatus, forcePushRequired: false, unpushed: 2 }, true),
    ).toBe(false);
    expect(
      canPush(
        development,
        { ...forceStatus, forcePushRequired: false, unpushed: 2, changes: [] },
        true,
      ),
    ).toBe(true);
    expect(isTaskComplete({ ...forceStatus, changes: [], mergedIntoDefault: true })).toBe(false);
  });

  it("counts a force-push requirement as pending even without ordinary unpushed commits", () => {
    const forceStatus: WorkspaceStatusResult = {
      ...status,
      members: [
        { ...status.members[0]!, conflicts: [], changes: [], unpushed: 0, forcePushRequired: true },
      ],
    };
    expect(countWorkspaceStatuses(members, forceStatus)).toEqual({
      all: 2,
      attention: 1,
      unpushed: 1,
      conflicts: 0,
    });
    for (const state of ["attention", "unpushed"]) {
      expect(
        filterWorkspaceMembers(members, [repository], forceStatus, {
          query: "",
          mode: "all",
          state,
        }),
      ).toEqual([development]);
    }
  });
});
