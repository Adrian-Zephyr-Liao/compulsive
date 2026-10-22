import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { createProjectFixture } from "./helpers/project-fixture.js";
import { projectGitStatus } from "../src/project/git.js";
import { projectGitDiscardAll } from "../src/project/git-discard.js";
import * as command from "../src/project/git-command.js";

describe("discard of all editor changes with optional backup", () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  beforeEach(async () => {
    f = await createProjectFixture();
    await f.commit(f.root, ".gitignore", "ignored.txt\n");
  }, 30000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.dispose();
  }, 20000);
  async function input(backup = false) {
    return {
      ...f.input(),
      fingerprint: (await projectGitStatus(f.manager, f.input())).fingerprint,
      confirmed: true,
      ...(backup ? { backup: true } : {}),
    };
  }
  describe("mixed saved changes", () => {
    let head = "";
    let branch = "";
    let reviewed: Awaited<ReturnType<typeof input>>;
    beforeEach(async () => {
      await writeFile(join(f.root, "origin.txt"), "staged\n");
      await f.git(f.root, "add", "--", "origin.txt");
      await writeFile(join(f.root, "origin.txt"), "unstaged on top\n");
      await writeFile(join(f.root, "literal[1].txt"), "new local file\n");
      await writeFile(join(f.root, "ignored.txt"), "ignored local content\n");
      head = (await f.git(f.root, "rev-parse", "HEAD")).stdout;
      branch = (await f.git(f.root, "symbolic-ref", "HEAD")).stdout;
      reviewed = await input();
    });
    it.each([false, true])(
      "discards mixed changes while preserving ignored files and commits (backup: %s)",
      async (backup) => {
        const result = await projectGitDiscardAll(f.manager, { ...reviewed, backup });
        expect(result.status.changes.filter((change) => !change.ignored)).toEqual([]);
        expect((await f.git(f.root, "rev-parse", "HEAD")).stdout).toBe(head);
        expect((await f.git(f.root, "symbolic-ref", "HEAD")).stdout).toBe(branch);
        expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("editor remote\n");
        expect(await readFile(join(f.root, "ignored.txt"), "utf8")).toBe("ignored local content\n");
        await expect(readFile(join(f.root, "literal[1].txt"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        if (backup) {
          expect(result.backup?.oid).toMatch(/^[a-f0-9]{40,64}$/);
          expect((await f.git(f.root, "stash", "list")).stdout).toContain(result.backup!.message);
          await f.git(f.root, "stash", "apply", "--index", result.backup!.oid);
          expect((await f.git(f.root, "show", ":origin.txt")).stdout).toBe("staged\n");
          expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("unstaged on top\n");
          expect(await readFile(join(f.root, "literal[1].txt"), "utf8")).toBe("new local file\n");
        } else {
          expect(result.backup).toBeNull();
          expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
        }
      },
    );
  });
  describe("staged deletion", () => {
    let reviewed: Awaited<ReturnType<typeof input>>;
    beforeEach(async () => {
      await mkdir(join(f.root, "nested"));
      await f.commit(f.root, "nested/deleted.txt", "restore this file\n");
      await rm(join(f.root, "nested"), { recursive: true });
      await f.git(f.root, "add", "-u", "--", "nested");
      reviewed = await input();
    });
    it.each([false, true])(
      "restores a staged deletion whose parent disappeared (backup: %s)",
      async (backup) => {
        const result = await projectGitDiscardAll(f.manager, { ...reviewed, backup });
        expect(await readFile(join(f.root, "nested/deleted.txt"), "utf8")).toBe(
          "restore this file\n",
        );
        if (backup) {
          await f.git(f.root, "stash", "apply", "--index", result.backup!.oid);
          await expect(readFile(join(f.root, "nested/deleted.txt"))).rejects.toMatchObject({
            code: "ENOENT",
          });
        } else expect(result.backup).toBeNull();
      },
    );
  });
  it("requires confirmation and rejects newly edited untracked or binary contents", async () => {
    await f.commit(f.root, "binary.bin", "\0old");
    await writeFile(join(f.root, "new.txt"), "first\n");
    await writeFile(join(f.root, "binary.bin"), "\0one");
    const before = await input();
    await expect(
      projectGitDiscardAll(f.manager, { ...before, confirmed: false }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await writeFile(join(f.root, "new.txt"), "other\n");
    await expect(projectGitDiscardAll(f.manager, before)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const newer = await input();
    await writeFile(join(f.root, "binary.bin"), "\0two");
    await expect(projectGitDiscardAll(f.manager, newer)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await readFile(join(f.root, "new.txt"), "utf8")).toBe("other\n");
    expect(await readFile(join(f.root, "binary.bin"), "utf8")).toBe("\0two");
    expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
  });
  it.each([false, true])(
    "discards a staged rename with a later working edit (backup: %s)",
    async (backup) => {
      await f.git(f.root, "mv", "origin.txt", "renamed.txt");
      await writeFile(join(f.root, "renamed.txt"), "editor remote\nworking edit\n");
      const result = await projectGitDiscardAll(f.manager, await input(backup));
      expect(result.status.changes.filter((change) => !change.ignored)).toEqual([]);
      expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("editor remote\n");
      await expect(readFile(join(f.root, "renamed.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      if (backup) {
        await f.git(f.root, "stash", "apply", "--index", result.backup!.oid);
        expect((await f.git(f.root, "status", "--porcelain=v1", "-z")).stdout).toContain(
          "RM renamed.txt\0origin.txt\0",
        );
        expect(await readFile(join(f.root, "renamed.txt"), "utf8")).toBe(
          "editor remote\nworking edit\n",
        );
      } else expect(result.backup).toBeNull();
    },
  );
  it.each(["add", "untrack"] as const)(
    "defaults to no backup for staged %s and preserves restored HEAD paths",
    async (kind) => {
      if (kind === "add") {
        await writeFile(join(f.root, "added.txt"), "staged new\n");
        await f.git(f.root, "add", "--", "added.txt");
        await writeFile(join(f.root, "added.txt"), "working new\n");
      } else {
        await f.git(f.root, "rm", "--cached", "--", "origin.txt");
        await writeFile(join(f.root, "origin.txt"), "now untracked\n");
      }
      const run = command.runProjectGit;
      const calls = vi.spyOn(command, "runProjectGit").mockImplementation(run);
      const result = await projectGitDiscardAll(f.manager, await input());
      expect(result.backup).toBeNull();
      expect(result.status.changes.filter((change) => !change.ignored)).toEqual([]);
      expect(
        calls.mock.calls.some(([, args]) => ["stash", "reset", "clean"].includes(args[0] ?? "")),
      ).toBe(false);
      expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
      if (kind === "add")
        await expect(readFile(join(f.root, "added.txt"))).rejects.toMatchObject({ code: "ENOENT" });
      else expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("editor remote\n");
    },
  );
  it.each(["secret", "symlink", "oversized", "repository"] as const)(
    "rejects %s changes without mutating them",
    async (kind) => {
      if (kind === "secret") await writeFile(join(f.root, ".env"), "secret\n");
      if (kind === "symlink") await symlink(join(f.root, "origin.txt"), join(f.root, "linked.txt"));
      if (kind === "oversized")
        await writeFile(join(f.root, "large.bin"), Buffer.alloc(4 * 1024 * 1024 + 1));
      if (kind === "repository") {
        await mkdir(join(f.root, "nested"));
        await f.git(join(f.root, "nested"), "init", "-q");
      }
      const before = (await f.git(f.root, "status", "--porcelain=v1", "--untracked-files=all"))
        .stdout;
      await expect(projectGitDiscardAll(f.manager, await input())).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(
        (await f.git(f.root, "status", "--porcelain=v1", "--untracked-files=all")).stdout,
      ).toBe(before);
      expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
      if (kind === "secret") expect(await readFile(join(f.root, ".env"), "utf8")).toBe("secret\n");
      if (kind === "repository")
        expect(
          (await f.git(join(f.root, "nested"), "rev-parse", "--is-inside-work-tree")).stdout.trim(),
        ).toBe("true");
    },
  );
  it.each(["symlink", "submodule"] as const)(
    "rejects deleted %s entries still present only in Git trees",
    async (kind) => {
      if (kind === "symlink") {
        await symlink("origin.txt", join(f.root, "linked.txt"));
        await f.git(f.root, "add", "--", "linked.txt");
        await f.git(f.root, "commit", "-q", "-m", "fixture symbolic link");
        await rm(join(f.root, "linked.txt"));
      } else {
        const head = (await f.git(f.root, "rev-parse", "HEAD")).stdout.trim();
        await f.git(f.root, "update-index", "--add", "--cacheinfo", `160000,${head},module`);
      }
      await expect(projectGitDiscardAll(f.manager, await input())).rejects.toMatchObject({
        code: "CONFLICT",
      });
      if (kind === "submodule")
        expect((await f.git(f.root, "ls-files", "--stage", "module")).stdout).toContain("160000");
      expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
    },
  );
  it.each([
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ])("refuses unfinished %s even when no files are conflicted", async (marker) => {
    await writeFile(join(f.root, "origin.txt"), "keep this edit\n");
    const head = (await f.git(f.root, "rev-parse", "HEAD")).stdout.trim();
    const path = (await f.git(f.root, "rev-parse", "--git-path", marker)).stdout.trim();
    const target = isAbsolute(path) ? path : resolve(f.root, path);
    if (marker.includes("-") || marker === "sequencer") await mkdir(target);
    else await writeFile(target, `${head}\n`);
    await expect(projectGitDiscardAll(f.manager, await input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("keep this edit\n");
    expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
  });
  it("rejects an unmerged index without losing either conflict stage", async () => {
    const blob = (await f.git(f.root, "rev-parse", "HEAD:origin.txt")).stdout.trim();
    await command.runProjectGit(f.root, ["update-index", "--index-info"], {
      input: `0 ${"0".repeat(40)}\torigin.txt\n100644 ${blob} 2\torigin.txt\n100644 ${blob} 3\torigin.txt\n`,
    });
    await writeFile(
      join(f.root, "origin.txt"),
      "<<<<<<< ours\nours\n=======\ntheirs\n>>>>>>> theirs\n",
    );
    const before = (await f.git(f.root, "ls-files", "--unmerged")).stdout;
    expect((await projectGitStatus(f.manager, f.input())).changes[0]?.conflict).toBe(true);
    await expect(projectGitDiscardAll(f.manager, await input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await f.git(f.root, "ls-files", "--unmerged")).stdout).toBe(before);
    expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
  });
  it("does not hide a partial stash failure and exposes its recoverable backup", async () => {
    await writeFile(join(f.root, "origin.txt"), "recover my content\n");
    const run = command.runProjectGit;
    vi.spyOn(command, "runProjectGit").mockImplementation(async (root, args, options) => {
      const result = await run(root, args, options);
      return args[0] === "stash" && args[1] === "push"
        ? { ...result, exitCode: 1, stderr: "injected cleanup failure" }
        : result;
    });
    let error: unknown;
    try {
      await projectGitDiscardAll(f.manager, await input(true));
    } catch (failure) {
      error = failure;
    }
    expect(error).toMatchObject({
      code: "GIT_FAILED",
      details: { backup: { oid: expect.stringMatching(/^[a-f0-9]{40,64}$/) } },
    });
    expect((error as Error).message).toContain("git stash apply --index");
    const oid = (error as { details: { backup: { oid: string } } }).details.backup.oid;
    expect((await f.git(f.root, "show", `${oid}:origin.txt`)).stdout).toBe("recover my content\n");
  });
  it("reports permanent partial failure without claiming a backup exists", async () => {
    await writeFile(join(f.root, "origin.txt"), "discard tracked\n");
    await writeFile(join(f.root, "new.txt"), "do not claim this was removed\n");
    const run = command.runProjectGit;
    vi.spyOn(command, "runProjectGit").mockImplementation(async (root, args, options) => {
      const result = await run(root, args, options);
      if (args[0] === "restore") throw new Error("injected after tracked restore");
      return result;
    });
    await expect(projectGitDiscardAll(f.manager, await input())).rejects.toMatchObject({
      message: expect.stringContaining("permanently removed; no backup was created"),
      details: { backup: null },
    });
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("editor remote\n");
    expect(await readFile(join(f.root, "new.txt"), "utf8")).toBe("do not claim this was removed\n");
    expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
  });
});
