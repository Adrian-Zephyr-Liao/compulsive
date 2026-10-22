import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateCodexCommitMessage } from "../src/codex-message.js";
import { projectGitStatus } from "../src/project/git.js";
import { projectGitMessage } from "../src/project/git-message.js";
import { createProjectFixture } from "./helpers/project-fixture.js";

vi.mock("../src/codex-message.js", () => ({ generateCodexCommitMessage: vi.fn() }));

describe("project commit-message generation", () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  beforeEach(async () => {
    f = await createProjectFixture();
    vi.mocked(generateCodexCommitMessage).mockResolvedValue("fix: update the staged example");
  }, 30_000);
  afterEach(async () => {
    vi.resetAllMocks();
    await f.dispose();
  }, 20_000);

  async function input() {
    return {
      ...f.input(),
      fingerprint: (await projectGitStatus(f.manager, f.input())).fingerprint,
    };
  }
  async function stage(content = "staged contents\n") {
    await writeFile(join(f.root, "origin.txt"), content);
    await f.git(f.root, "add", "--", "origin.txt");
  }

  it("generates only from the index without staging, committing or changing the disk", async () => {
    await stage();
    await writeFile(join(f.root, "origin.txt"), "UNSTAGED CONTENT MUST NOT BE SENT\n");
    await writeFile(join(f.root, "untracked.txt"), "UNTRACKED CONTENT MUST NOT BE SENT\n");
    const status = await projectGitStatus(f.manager, f.input());
    const before = { ...f.input(), fingerprint: status.fingerprint };
    await expect(projectGitMessage(f.manager, before)).resolves.toEqual({
      message: "fix: update the staged example",
      fingerprint: before.fingerprint,
    });
    const patch = vi.mocked(generateCodexCommitMessage).mock.calls[0]![0];
    expect(patch).toContain("+staged contents");
    expect(patch).not.toContain("UNSTAGED CONTENT");
    expect(patch).not.toContain("UNTRACKED CONTENT");
    const after = await projectGitStatus(f.manager, f.input());
    expect(after.head).toBe(status.head);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(await readFile(join(f.root, "origin.txt"), "utf8")).toContain("UNSTAGED CONTENT");
  });

  it("rejects a stale request or empty index before calling Codex", async () => {
    await expect(projectGitMessage(f.manager, await input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const old = await input();
    await stage();
    await expect(projectGitMessage(f.manager, old)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(generateCodexCommitMessage).not.toHaveBeenCalled();
  });

  it("rejects excluded staged paths without sending any patch", async () => {
    await stage();
    await writeFile(join(f.root, ".env"), "SECRET_MUST_NOT_BE_SENT\n");
    await f.git(f.root, "add", "--", ".env");
    await expect(projectGitMessage(f.manager, await input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(generateCodexCommitMessage).not.toHaveBeenCalled();
  });

  it("rejects a patch above the size limit instead of silently summarizing a truncated patch", async () => {
    await stage("large staged patch\n".repeat(10_000));
    await expect(projectGitMessage(f.manager, await input())).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(generateCodexCommitMessage).not.toHaveBeenCalled();
  });

  it("rejects conflicted state before calling Codex", async () => {
    await f.git(f.root, "checkout", "-b", "other");
    await f.commit(f.root, "origin.txt", "other branch\n");
    await f.git(f.root, "checkout", "feat/editor");
    await f.commit(f.root, "origin.txt", "editor branch\n");
    await f.git(f.root, "merge", "other").catch(() => {});
    await expect(projectGitMessage(f.manager, await input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(generateCodexCommitMessage).not.toHaveBeenCalled();
  });

  it("does not return a generated message when Git changes during generation", async () => {
    await stage();
    vi.mocked(generateCodexCommitMessage).mockImplementationOnce(async () => {
      await writeFile(join(f.root, "origin.txt"), "new edit while waiting\n");
      return "obsolete message";
    });
    await expect(projectGitMessage(f.manager, await input())).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});
