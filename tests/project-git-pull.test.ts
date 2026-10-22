import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as command from "../src/project/git-command.js";
import { projectGitAction, projectGitStatus } from "../src/project/git.js";
import { createProjectFixture } from "./helpers/project-fixture.js";

describe("editor fast-forward pull", { timeout: 15_000 }, () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  let writer: string;
  beforeEach(async () => {
    f = await createProjectFixture();
    await f.git(f.root, "branch", "--set-upstream-to=origin/main");
    writer = join(f.sandbox, "upstream-writer");
    const remote = (await f.git(f.root, "remote", "get-url", "origin")).stdout.trim();
    await f.git(f.sandbox, "clone", "-q", remote, writer);
  }, 30_000);
  afterEach(async () => {
    vi.restoreAllMocks();
    await f?.dispose();
  }, 20_000);

  async function input() {
    return {
      ...f.input(),
      operation: "pull" as const,
      paths: [],
      fingerprint: (await projectGitStatus(f.manager, f.input())).fingerprint,
      message: "",
      confirmed: true,
      expectedVersion: "",
    };
  }

  it("rejects an incoming tracked file without overwriting ignored local data or moving HEAD", async () => {
    const exclude = (await f.git(f.root, "rev-parse", "--git-path", "info/exclude")).stdout.trim();
    await writeFile(isAbsolute(exclude) ? exclude : resolve(f.root, exclude), "cache.json\n");
    await writeFile(join(f.root, "cache.json"), "local ignored data\n");
    await f.commit(writer, "cache.json", "incoming tracked data\n");
    await f.git(writer, "push", "-q", "origin", "main");
    const before = await projectGitStatus(f.manager, f.input());
    expect(before.changes).toContainEqual(
      expect.objectContaining({ path: "cache.json", ignored: true }),
    );
    const failure = await projectGitAction(f.manager, await input()).then(
      () => null,
      (error: unknown) => error,
    );
    expect(await readFile(join(f.root, "cache.json"), "utf8")).toBe("local ignored data\n");
    expect((await f.git(f.root, "rev-parse", "HEAD")).stdout.trim()).toBe(before.head);
    expect(failure).toMatchObject({ code: "GIT_FAILED" });
  });

  it("fetches and fast-forwards the configured non-origin upstream", async () => {
    await f.git(f.root, "remote", "rename", "origin", "review");
    await f.commit(writer, "incoming.txt", "configured upstream\n");
    await f.git(writer, "push", "-q", "origin", "main");
    const tip = (await f.git(writer, "rev-parse", "HEAD")).stdout.trim();
    const result = await projectGitAction(f.manager, await input());
    expect(result.head).toBe(tip);
    expect(result.upstream).toBe("review/main");
    expect(await readFile(join(f.root, "incoming.txt"), "utf8")).toBe("configured upstream\n");
  });

  it("rejects diverged history without rewriting local commits", async () => {
    await f.commit(f.root, "local.txt", "local commit\n");
    await f.commit(writer, "incoming.txt", "remote commit\n");
    await f.git(writer, "push", "-q", "origin", "main");
    const before = await projectGitStatus(f.manager, f.input());
    await expect(projectGitAction(f.manager, await input())).rejects.toMatchObject({
      code: "GIT_FAILED",
    });
    expect((await f.git(f.root, "rev-parse", "HEAD")).stdout.trim()).toBe(before.head);
    expect(await readFile(join(f.root, "local.txt"), "utf8")).toBe("local commit\n");
    expect((await f.git(f.root, "status", "--porcelain")).stdout).toBe("");
  });

  it("preserves edits made during fetch even when Git autostash is configured", async () => {
    await f.git(f.root, "config", "merge.autoStash", "true");
    await f.commit(writer, "incoming.txt", "remote commit\n");
    await f.git(writer, "push", "-q", "origin", "main");
    const request = await input();
    const before = (await f.git(f.root, "rev-parse", "HEAD")).stdout;
    const run = command.runProjectGit;
    vi.spyOn(command, "runProjectGit").mockImplementation(async (root, args, options) => {
      const result = await run(root, args, options);
      if (args[0] === "fetch") await writeFile(join(root, "origin.txt"), "edited during fetch\n");
      return result;
    });
    await expect(projectGitAction(f.manager, request)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await f.git(f.root, "rev-parse", "HEAD")).stdout).toBe(before);
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toBe("edited during fetch\n");
    expect((await f.git(f.root, "stash", "list")).stdout).toBe("");
  });
});
