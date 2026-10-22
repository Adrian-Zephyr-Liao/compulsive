import { describe, expect, it } from "vitest";
import type {
  RepositoryRecord,
  WorkspaceId,
  WorkspaceMember,
  WorkspaceStatusResult,
} from "../src/types.js";
import {
  countWorkspaceStatuses,
  filterWorkspaceMembers,
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
});
