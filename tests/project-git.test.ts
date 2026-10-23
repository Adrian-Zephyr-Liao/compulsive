import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as diffBlobs from "../src/project/git-diff.js";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectFixture } from "./helpers/project-fixture.js";
import {
  projectGitStatus,
  projectGitAction,
  projectGitDiff,
  projectGitHistory,
  projectGitHunk,
} from "../src/project/git.js";
describe("editor source control", () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  beforeEach(async () => {
    f = await createProjectFixture();
  }, 30000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.dispose();
  }, 20000);
  it("stages literal paths, previews both sides and rejects stale Git state", async () => {
    const scope = f.input();
    await writeFile(join(f.root, "origin.txt"), "new content\n");
    let status = await projectGitStatus(f.manager, scope);
    expect(status.changes[0]).toMatchObject({ path: "origin.txt", worktree: "M" });
    expect(
      await projectGitDiff(f.manager, { ...f.input("origin.txt"), staged: false }),
    ).toMatchObject({ original: "editor remote\n", content: "new content\n" });
    const action = {
      ...scope,
      paths: ["origin.txt"],
      fingerprint: status.fingerprint,
      message: "editor change",
      confirmed: true,
      expectedVersion: "",
    };
    status = await projectGitAction(f.manager, { ...action, operation: "stage" });
    expect(status.changes[0]?.index).toBe("M");
    await expect(
      projectGitAction(f.manager, { ...action, operation: "commit" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("compares a staged rename and its later unstaged edit against the correct names", async () => {
    await f.git(f.root, "mv", "origin.txt", "renamed.txt");
    await writeFile(join(f.root, "renamed.txt"), "editor remote\nlocal edit\n");
    await expect(
      projectGitDiff(f.manager, { ...f.input("renamed.txt"), staged: true }),
    ).resolves.toMatchObject({ original: "editor remote\n", content: "editor remote\n" });
    await expect(
      projectGitDiff(f.manager, { ...f.input("renamed.txt"), staged: false }),
    ).resolves.toMatchObject({
      original: "editor remote\n",
      content: "editor remote\nlocal edit\n",
    });
  });
  it("reviews new and deleted files against empty content on the correct side", async () => {
    await writeFile(join(f.root, "new.txt"), "new file\n");
    await expect(
      projectGitDiff(f.manager, { ...f.input("new.txt"), staged: false }),
    ).resolves.toMatchObject({ original: "", content: "new file\n" });
    await rm(join(f.root, "origin.txt"));
    await expect(
      projectGitDiff(f.manager, { ...f.input("origin.txt"), staged: false }),
    ).resolves.toMatchObject({ original: "editor remote\n", content: "" });
  });
  it("commits staged changes and reports history", async () => {
    await writeFile(join(f.root, "origin.txt"), "new content\n");
    await f.git(f.root, "add", "--", "origin.txt");
    const before = await projectGitStatus(f.manager, f.input());
    const status = await projectGitAction(f.manager, {
      ...f.input(),
      paths: [],
      fingerprint: before.fingerprint,
      message: "editor change",
      confirmed: true,
      expectedVersion: "",
      operation: "commit",
    });
    expect(status.changes).toEqual([]);
    const history = await projectGitHistory(f.manager, { ...f.input(), offset: 0 });
    expect(history.commits[0]?.subject).toBe("editor change");
  });
  it("does not stage an entire directory containing excluded files", async () => {
    await mkdir(join(f.root, "src"));
    await writeFile(join(f.root, "src/visible.ts"), "visible\n");
    await writeFile(join(f.root, "src/.env"), "secret\n");
    const status = await projectGitStatus(f.manager, f.input());
    await expect(
      projectGitAction(f.manager, {
        ...f.input(),
        operation: "stage",
        paths: ["src"],
        fingerprint: status.fingerprint,
        message: "",
        confirmed: true,
        expectedVersion: "",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await f.git(f.root, "diff", "--cached", "--name-only")).stdout).toBe("");
  });
  it("does not commit excluded files staged by another editor", async () => {
    await writeFile(join(f.root, ".env"), "secret\n");
    await writeFile(join(f.root, "origin.txt"), "visible change\n");
    await f.git(f.root, "add", "--", ".env", "origin.txt");
    const status = await projectGitStatus(f.manager, f.input());
    expect(status.excludedChanges).toBe(true);
    expect(status.changes.some((change) => change.path === ".env")).toBe(false);
    const before = (await f.git(f.root, "rev-parse", "HEAD")).stdout;
    await expect(
      projectGitAction(f.manager, {
        ...f.input(),
        operation: "commit",
        paths: [],
        fingerprint: status.fingerprint,
        message: "visible only",
        confirmed: true,
        expectedVersion: "",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await f.git(f.root, "rev-parse", "HEAD")).stdout).toBe(before);
    expect(await readFile(join(f.root, ".env"), "utf8")).toBe("secret\n");
  });
  it("stages and unstages deletion when the parent directory is also gone", async () => {
    await mkdir(join(f.root, "nested"));
    await f.commit(f.root, "nested/file.txt", "keep in index\n");
    await rm(join(f.root, "nested"), { recursive: true });
    let status = await projectGitStatus(f.manager, f.input());
    const input = {
      ...f.input(),
      paths: ["nested/file.txt"],
      message: "",
      confirmed: true,
      expectedVersion: "",
    };
    status = await projectGitAction(f.manager, {
      ...input,
      operation: "stage",
      fingerprint: status.fingerprint,
    });
    expect(status.changes[0]).toMatchObject({ path: "nested/file.txt", index: "D" });
    status = await projectGitAction(f.manager, {
      ...input,
      operation: "unstage",
      fingerprint: status.fingerprint,
    });
    expect(status.changes[0]).toMatchObject({ path: "nested/file.txt", worktree: "D" });
    expect((await f.git(f.root, "show", ":nested/file.txt")).stdout).toBe("keep in index\n");
  });
  it("returns readable line attribution rather than exposing Git porcelain", async () => {
    const history = await projectGitHistory(f.manager, {
      ...f.input(),
      offset: 0,
      path: "origin.txt",
    });
    expect(history.blame[0]).toMatchObject({
      line: 1,
      content: "editor remote",
      summary: "origin.txt",
    });
    expect(history.blame[0]?.id).toMatch(/^[a-f0-9]{40,64}$/);
  });
  it("restores a reviewed deleted file but rejects a stale deletion after the file reappears", async () => {
    await mkdir(join(f.root, "nested"));
    await f.commit(f.root, "nested/file.txt", "restore me\n");
    await rm(join(f.root, "nested"), { recursive: true });
    const deleted = await projectGitStatus(f.manager, f.input());
    const input = {
      ...f.input(),
      paths: ["nested/file.txt"],
      message: "",
      confirmed: true,
      expectedVersion: "",
      operation: "discard" as const,
      fingerprint: deleted.fingerprint,
    };
    await projectGitAction(f.manager, input);
    expect(await readFile(join(f.root, "nested/file.txt"), "utf8")).toBe("restore me\n");
    await writeFile(join(f.root, "nested/file.txt"), "new external content\n");
    await expect(projectGitAction(f.manager, input)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(join(f.root, "nested/file.txt"), "utf8")).toBe("new external content\n");
  });
  it("stages a reviewed server-generated hunk without changing the working file", async () => {
    await writeFile(join(f.root, "origin.txt"), "one reviewed change\n");
    const diff = await projectGitDiff(f.manager, { ...f.input("origin.txt"), staged: false });
    expect(diff.hunks).toHaveLength(1);
    await expect(
      projectGitHunk(f.manager, {
        ...f.input("origin.txt"),
        staged: false,
        hunk: 0,
        fingerprint: "stale",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const status = await projectGitHunk(f.manager, {
      ...f.input("origin.txt"),
      staged: false,
      hunk: 0,
      fingerprint: diff.fingerprint,
    });
    expect(status.changes[0]?.index).toBe("M");
    expect((await f.git(f.root, "show", ":origin.txt")).stdout).toBe("one reviewed change\n");
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("one reviewed change\n");
  });
  async function twoHunks() {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
    await f.commit(f.root, "hunks.txt", lines.join("\n") + "\n");
    const changed = [...lines];
    changed[2] = "first edited region";
    changed[30] = "second edited region";
    await writeFile(join(f.root, "hunks.txt"), changed.join("\n") + "\n");
    return changed.join("\n") + "\n";
  }
  it("targets a reviewed Git hunk and rejects reuse after the index changes", async () => {
    const working = await twoHunks();
    const diff = await projectGitDiff(f.manager, { ...f.input("hunks.txt"), staged: false });
    expect(diff.hunks).toHaveLength(2);
    await projectGitHunk(f.manager, {
      ...f.input("hunks.txt"),
      staged: false,
      hunk: 1,
      fingerprint: diff.fingerprint,
    });
    const index = (await f.git(f.root, "show", ":hunks.txt")).stdout;
    expect(index).toContain("second edited region");
    expect(index).not.toContain("first edited region");
    await expect(
      projectGitHunk(f.manager, {
        ...f.input("hunks.txt"),
        staged: false,
        hunk: 0,
        fingerprint: diff.fingerprint,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(join(f.root, "hunks.txt"), "utf8")).toBe(working);
  });
  it("unstages only the selected Git hunk without changing the working file", async () => {
    const working = await twoHunks();
    await f.git(f.root, "add", "hunks.txt");
    const staged = await projectGitDiff(f.manager, { ...f.input("hunks.txt"), staged: true });
    expect(staged.hunks).toHaveLength(2);
    await projectGitHunk(f.manager, {
      ...f.input("hunks.txt"),
      staged: true,
      hunk: 1,
      fingerprint: staged.fingerprint,
    });
    const index = (await f.git(f.root, "show", ":hunks.txt")).stdout;
    expect(index).toContain("first edited region");
    expect(index).not.toContain("second edited region");
    expect(await readFile(join(f.root, "hunks.txt"), "utf8")).toBe(working);
  });
  it("rejects an external edit during a diff read without changing the file or index", async () => {
    await writeFile(join(f.root, "origin.txt"), "reviewed content\n");
    const readBlob = diffBlobs.readGitDiffBlob;
    const index = (await f.git(f.root, "show", ":origin.txt")).stdout;
    vi.spyOn(diffBlobs, "readGitDiffBlob").mockImplementationOnce(async (...args) => {
      const result = await readBlob(...args);
      await writeFile(join(f.root, "origin.txt"), "external edit during snapshot\n");
      return result;
    });
    await expect(
      projectGitDiff(f.manager, { ...f.input("origin.txt"), staged: false }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe(
      "external edit during snapshot\n",
    );
    expect((await f.git(f.root, "show", ":origin.txt")).stdout).toBe(index);
  });
  it("does not offer or accept a staged rename as a misleading hunk action", async () => {
    await f.git(f.root, "mv", "origin.txt", "renamed.txt");
    const diff = await projectGitDiff(f.manager, { ...f.input("renamed.txt"), staged: true });
    expect(diff.hunks).toEqual([]);
    const index = (await f.git(f.root, "ls-files", "--stage")).stdout;
    await expect(
      projectGitHunk(f.manager, {
        ...f.input("renamed.txt"),
        staged: true,
        hunk: 0,
        fingerprint: diff.fingerprint,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await f.git(f.root, "ls-files", "--stage")).stdout).toBe(index);
  });
  it("undoes an unpublished commit without losing its content", async () => {
    await f.commit(f.root, "origin.txt", "new content\n");
    const before = await projectGitStatus(f.manager, f.input());
    const status = await projectGitAction(f.manager, {
      ...f.input(),
      paths: [],
      message: "",
      confirmed: true,
      expectedVersion: "",
      operation: "undo",
      fingerprint: before.fingerprint,
    });
    expect(status.changes[0]?.index).toBe("M");
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("new content\n");
  });
  it("pushes only the selected development branch and associates its matching upstream", async () => {
    const before = await projectGitStatus(f.manager, f.input());
    const result = await projectGitAction(f.manager, {
      ...f.input(),
      operation: "push",
      paths: [],
      fingerprint: before.fingerprint,
      message: "",
      confirmed: true,
      expectedVersion: "",
    });
    expect(result.upstream).toBe("origin/feat/editor");
    expect(result.upstream).not.toBe("origin/main");
    expect((await f.git(f.root, "rev-parse", "origin/feat/editor")).stdout.trim()).toBe(
      result.head,
    );
  }, 15000);
  it("blocks stale discards, secret paths, unconfirmed actions and undo of known pushed commits", async () => {
    const status = await projectGitStatus(f.manager, f.input());
    const action = {
      ...f.input(),
      paths: [],
      fingerprint: status.fingerprint,
      message: "",
      confirmed: true,
      expectedVersion: "",
    };
    await expect(projectGitAction(f.manager, { ...action, operation: "undo" })).rejects.toThrow(
      "remote branch",
    );
    await expect(
      projectGitAction(f.manager, { ...action, operation: "push", confirmed: false }),
    ).rejects.toThrow("Confirm");
    await expect(
      projectGitAction(f.manager, { ...action, operation: "stage", paths: [".git/config"] }),
    ).rejects.toThrow();
    await writeFile(join(f.root, "origin.txt"), "keep me\n");
    await expect(
      projectGitAction(f.manager, { ...action, operation: "discard", paths: ["origin.txt"] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("keep me\n");
  });
});
