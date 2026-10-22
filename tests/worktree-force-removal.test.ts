import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRepositoryManager } from "../src/manager.js";
import type { RepositoryManager } from "../src/types.js";
import type { WorktreeRemovalInput } from "../src/worktree-audit-types.js";
import * as storage from "../src/storage.js";

const execute = promisify(execFile);

describe("explicit force worktree removal", () => {
  let sandbox: string;
  let repository: string;
  let manager: RepositoryManager;
  async function git(path: string, ...args: string[]) {
    return (await execute("git", ["-C", path, ...args])).stdout.trim();
  }
  async function worktree(name: string) {
    const path = join(repository, ".worktrees", name);
    await git(repository, "worktree", "add", "-qb", name, path);
    return path;
  }
  async function inputFor(path: string): Promise<WorktreeRemovalInput> {
    const item = (await manager.auditWorktrees()).items.find((item) => item.path === path)!;
    const plan = await manager.previewWorktreeRemoval(item.id);
    expect(plan.blockers).toEqual([]);
    return {
      id: item.id,
      fingerprint: plan.item.fingerprint,
      confirmedPath: path,
      force: true,
      includeIgnored: true,
    };
  }
  beforeEach(async () => {
    sandbox = await realpath(await mkdtemp(join(tmpdir(), "cpl-force-removal-")));
    repository = join(sandbox, "repos", "sample");
    await mkdir(repository, { recursive: true });
    await git(repository, "init", "-qb", "main");
    await git(repository, "config", "user.name", "Test");
    await git(repository, "config", "user.email", "test@example.com");
    await writeFile(join(repository, "file.txt"), "base\n");
    await writeFile(join(repository, ".gitignore"), ".worktrees/\nignored/\n");
    await git(repository, "add", ".");
    await git(repository, "commit", "-qm", "initial");
    manager = createRepositoryManager({
      dataDir: join(sandbox, "data"),
      defaultRootDir: join(sandbox, "repos"),
    });
    await manager.initialize({ workspaceRoot: join(sandbox, "requirements") });
    await manager.register({ path: repository });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(sandbox, { recursive: true, force: true });
  });

  it("requires a real force boolean and separately confirms ignored data before removing dirty locked worktrees", async () => {
    const path = await worktree("dirty-locked");
    await writeFile(join(path, "file.txt"), "uncommitted");
    await writeFile(join(path, "new.txt"), "untracked");
    await mkdir(join(path, "ignored"));
    await writeFile(join(path, "ignored", "local.env"), "secret");
    await git(repository, "worktree", "lock", "--reason", "review", path);
    const input = await inputFor(path);
    const plan = await manager.previewWorktreeRemoval(input.id);
    expect(plan.forceReasons).toEqual(expect.arrayContaining(["dirty", "untracked", "locked"]));
    await expect(manager.removeAuditedWorktree({ ...input, force: false })).rejects.toThrow(
      "Force deletion",
    );
    await expect(
      manager.removeAuditedWorktree({ ...input, force: "true" } as unknown as WorktreeRemovalInput),
    ).rejects.toThrow("Force deletion");
    await expect(
      manager.removeAuditedWorktree({ ...input, includeIgnored: false }),
    ).rejects.toThrow("ignored files");
    expect(await readFile(join(path, "new.txt"), "utf8")).toBe("untracked");
    await manager.removeAuditedWorktree(input);
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await git(repository, "rev-parse", "dirty-locked")).toBe(
      await git(repository, "rev-parse", "main"),
    );
    expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("base\n");
  }, 30_000);

  it.each(["merge", "rebase"])(
    "removes an unfinished %s only after force confirmation",
    async (operation) => {
      const path = await worktree(`in-${operation}`);
      await writeFile(join(path, "file.txt"), "ours\n");
      await git(path, "commit", "-qam", "ours");
      await writeFile(join(repository, "file.txt"), "theirs\n");
      await git(repository, "commit", "-qam", "theirs");
      await expect(git(path, operation, "main")).rejects.toThrow();
      const input = await inputFor(path);
      const plan = await manager.previewWorktreeRemoval(input.id);
      expect(plan.forceReasons).toEqual(expect.arrayContaining(["conflicts", "in-progress"]));
      await expect(manager.removeAuditedWorktree({ ...input, force: false })).rejects.toThrow(
        "Force deletion",
      );
      await manager.removeAuditedWorktree(input);
      await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
      expect(await git(repository, "branch", "--show-current")).toBe("main");
      expect(await git(repository, "status", "--porcelain")).toBe("");
    },
    30_000,
  );

  it("removes only a selected missing locked registration without pruning siblings", async () => {
    const path = await worktree("missing");
    const sibling = await worktree("other-missing");
    await git(repository, "worktree", "lock", path);
    await rm(path, { recursive: true });
    await rm(sibling, { recursive: true });
    await manager.removeAuditedWorktree(await inputFor(path));
    const list = await git(repository, "worktree", "list", "--porcelain");
    expect(list).not.toContain(`worktree ${path}\n`);
    expect(list).toContain(`worktree ${sibling}\n`);
    expect(await git(repository, "rev-parse", "missing")).toBe(
      await git(repository, "rev-parse", "main"),
    );
  }, 30_000);

  it("force removes unregistered directories and removes symlinks without following their targets", async () => {
    const directory = join(repository, ".worktrees", "orphan");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "keep-until-confirmed.txt"), "content");
    const input = await inputFor(directory);
    await expect(manager.removeAuditedWorktree({ ...input, force: false })).rejects.toThrow(
      "Force deletion",
    );
    await manager.removeAuditedWorktree(input);
    await expect(lstat(directory)).rejects.toMatchObject({ code: "ENOENT" });
    const link = join(repository, ".worktrees", "orphan-link");
    await symlink(repository, link);
    await manager.removeAuditedWorktree(await inputFor(link));
    await expect(lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(repository, "file.txt"), "utf8")).toBe("base\n");
  }, 30_000);

  it("cleans affected requirement memberships and links while retaining their directories and branches", async () => {
    const record = (await manager.search())[0]!;
    const workspace = await manager.createWorkspace({ name: "used" });
    const updated = await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: record.id,
      mode: "worktree",
      branch: "feat/used",
      createBranch: true,
    });
    const member = updated.members[0]!;
    if (member.mode !== "worktree") throw new Error("Expected a worktree fixture.");
    const input = await inputFor(member.worktreePath);
    const plan = await manager.previewWorktreeRemoval(input.id);
    expect(plan.forceReasons).toContain("referenced");
    await manager.removeAuditedWorktree(input);
    expect((await manager.searchWorkspaces())[0]?.members).toEqual([]);
    expect((await lstat(workspace.absolutePath)).isDirectory()).toBe(true);
    await expect(lstat(join(workspace.absolutePath, member.alias))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await git(repository, "rev-parse", "feat/used")).toBe(
      await git(repository, "rev-parse", "main"),
    );
  }, 30_000);

  it("retains a detached HEAD commit in a recovery ref before force removal", async () => {
    const path = join(repository, ".worktrees", "detached");
    await git(repository, "worktree", "add", "--detach", path);
    await git(path, "commit", "--allow-empty", "-qm", "detached unique");
    const head = await git(path, "rev-parse", "HEAD");
    const result = await manager.removeAuditedWorktree(await inputFor(path));
    expect(result.retainedCommitRef).toMatch(/^refs\/cpl\/removed-worktrees\//);
    expect(await git(repository, "rev-parse", result.retainedCommitRef!)).toBe(head);
  }, 30_000);

  it("does not allow force to bypass primary-repository protection or changed fingerprints", async () => {
    const nested = join(repository, ".worktrees", "independent-main");
    await mkdir(nested, { recursive: true });
    await git(nested, "init", "-q");
    const report = await manager.auditWorktrees();
    const item = report.items.find((item) => item.path === nested)!;
    const plan = await manager.previewWorktreeRemoval(item.id);
    expect(plan.blockers).toContain("protected-path");
    await expect(
      manager.removeAuditedWorktree({
        id: item.id,
        fingerprint: plan.item.fingerprint,
        confirmedPath: nested,
        force: true,
        includeIgnored: true,
      }),
    ).rejects.toThrow("protected");
    expect((await lstat(join(nested, ".git"))).isDirectory()).toBe(true);
    const path = await worktree("changed");
    const input = await inputFor(path);
    await writeFile(join(path, "new-file"), "added after preview");
    await expect(manager.removeAuditedWorktree(input)).rejects.toThrow("changed");
    expect(await readFile(join(path, "new-file"), "utf8")).toBe("added after preview");
  }, 30_000);

  it("never interprets a confirmed system-root path as a replacement deletion target", async () => {
    const path = await worktree("safe-target");
    const input = await inputFor(path);
    for (const protectedPath of ["/", "/System", "/Users", repository, join(sandbox, "repos")]) {
      await expect(
        manager.removeAuditedWorktree({ ...input, confirmedPath: protectedPath }),
      ).rejects.toThrow("complete worktree path");
    }
    expect(await readFile(join(path, "file.txt"), "utf8")).toBe("base\n");
  }, 30_000);

  it("rejects an unregistered entry that actually belongs to another repository", async () => {
    const other = join(sandbox, "other");
    await mkdir(other);
    await git(other, "init", "-q");
    await git(
      other,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-qm",
      "other",
    );
    const path = join(repository, ".worktrees", "foreign");
    await git(other, "worktree", "add", "--detach", path);
    const report = await manager.auditWorktrees();
    const item = report.items.find((item) => item.path === path)!;
    const plan = await manager.previewWorktreeRemoval(item.id);
    expect(plan.blockers).toContain("identity-changed");
    await expect(
      manager.removeAuditedWorktree({
        id: item.id,
        fingerprint: plan.item.fingerprint,
        confirmedPath: path,
        force: true,
      }),
    ).rejects.toThrow("protected");
    expect(await git(other, "worktree", "list", "--porcelain")).toContain(path);
  }, 30_000);

  it("can force remove an initialized submodule worktree without touching its source repository", async () => {
    const source = join(sandbox, "module-source");
    await mkdir(source);
    await git(source, "init", "-q");
    await writeFile(join(source, "module.txt"), "source");
    await git(source, "add", ".");
    await git(
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "module",
    );
    await git(
      repository,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "-q",
      source,
      "module",
    );
    await git(repository, "commit", "-qam", "add module");
    const path = await worktree("with-module");
    await git(path, "-c", "protocol.file.allow=always", "submodule", "update", "--init", "-q");
    const input = await inputFor(path);
    const plan = await manager.previewWorktreeRemoval(input.id);
    expect(plan.forceReasons).toContain("submodules");
    await manager.removeAuditedWorktree(input);
    await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(source, "module.txt"), "utf8")).toBe("source");
  }, 30_000);

  it("reports deletion success with a warning if requirement metadata cleanup subsequently fails", async () => {
    const record = (await manager.search())[0]!;
    const workspace = await manager.createWorkspace({ name: "metadata-failure" });
    const updated = await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: record.id,
      mode: "worktree",
      branch: "feat/metadata-failure",
      createBranch: true,
    });
    const member = updated.members[0]!;
    if (member.mode !== "worktree") throw new Error("Expected worktree.");
    const input = await inputFor(member.worktreePath);
    const write = storage.writeJsonAtomic;
    vi.spyOn(storage, "writeJsonAtomic").mockImplementation(async (path, value) => {
      if (path.endsWith("/workspaces.json")) throw new Error("simulated metadata write failure");
      return write(path, value);
    });
    const result = await manager.removeAuditedWorktree(input);
    expect(result.removedPath).toBe(member.worktreePath);
    expect(result.warning).toContain("references could not be fully cleaned");
    await expect(lstat(member.worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await manager.searchWorkspaces())[0]?.members).toHaveLength(1);
  }, 30_000);
});
