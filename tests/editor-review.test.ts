import { describe, expect, it } from "vitest";
import {
  editorViewMode,
  groupGitChanges,
  reviewEntries,
} from "../src/devtool-client/features/editor/utils/gitChanges.js";
import type { ProjectGitChange, ProjectGitStatus } from "../src/project/git.js";

const change = (path: string, index = " ", worktree = "M"): ProjectGitChange => ({
  path,
  original: path,
  index,
  worktree,
  conflict: false,
  ignored: false,
});
const status = (changes: ProjectGitChange[]): ProjectGitStatus => ({
  changes,
  branch: "feat/task",
  head: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  fingerprint: "current",
  excludedChanges: false,
  forcePushRequired: false,
});

describe("diff-first project review", () => {
  it.each([
    ["", "changes"],
    ["file=src%2Findex.ts", "files"],
    ["view=files", "files"],
    ["view=changes&file=src%2Findex.ts", "changes"],
  ] as const)("resolves the view for %s", (query, expected) => {
    expect(editorViewMode(new URLSearchParams(query))).toBe(expected);
  });

  it("keeps staged and working changes distinct, excludes ignored files and groups conflicts once", () => {
    const snapshot = status([
      change("src/both.ts", "M", "M"),
      change("new.ts", "?", "?"),
      change("deleted.ts", "D", " "),
      { ...change("renamed.ts", "R", " "), original: "old.ts" },
      { ...change("conflict.ts", "U", "U"), conflict: true },
      { ...change("dist", "!", "!"), ignored: true },
    ]);
    const groups = groupGitChanges(snapshot);
    expect(groups.map((group) => [group.key, group.items.length])).toEqual([
      ["conflicts", 1],
      ["staged", 3],
      ["changes", 1],
      ["untracked", 1],
    ]);
    const entries = reviewEntries(snapshot);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length);
    expect(
      entries.filter((entry) => entry.change.path === "src/both.ts").map((entry) => entry.staged),
    ).toEqual([true, false]);
    expect(entries.find((entry) => entry.change.path === "renamed.ts")?.change.original).toBe(
      "old.ts",
    );
    expect(reviewEntries(undefined)).toEqual([]);
    expect(reviewEntries(status([]))).toEqual([]);
  });
});
