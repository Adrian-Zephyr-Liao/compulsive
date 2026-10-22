import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositoryManager } from "../src/manager.js";
import {
  parseWorktreeChanges,
  parseWorktreeList,
  validateAuditPath,
} from "../src/worktree-audit.js";
import { createWorktreeAuditJobs } from "../src/worktree-audit-jobs.js";
import { runCli } from "../src/cli.js";
import type { RepositoryManager } from "../src/types.js";

const execute = promisify(execFile);

describe("worktree porcelain parsers", () => {
  it("preserves whitespace and parses detached, locked and prunable records", () => {
    expect(
      parseWorktreeList(
        "worktree /repo/main\0HEAD abc\0branch refs/heads/main\0\0worktree /repo/path with\nnewline\0HEAD def\0detached\0locked waiting for review\0prunable\0\0",
      ),
    ).toEqual([
      { path: "/repo/main", head: "abc", branch: "main", locked: null, prunable: null },
      {
        path: "/repo/path with\nnewline",
        head: "def",
        branch: null,
        locked: "waiting for review",
        prunable: "",
      },
    ]);
  });
  it("parses rename pairs, conflicts and ignored files without line splitting", () => {
    expect(
      parseWorktreeChanges("R  new name\0old\nname\0UU conflict\0!! secret.txt\0?? a\nb\0"),
    ).toEqual([
      { status: "R ", path: "new name", from: "old\nname" },
      { status: "UU", path: "conflict" },
      { status: "!!", path: "secret.txt" },
      { status: "??", path: "a\nb" },
    ]);
    expect(() => parseWorktreeChanges("R  new\0")).toThrow();
    expect(() => parseWorktreeList("worktree relative\0\0")).toThrow();
  });
});

describe("worktree audit and controlled removal", () => {
  let sandbox: string;
  let root: string;
  let repo: string;
  let data: string;
  let manager: RepositoryManager;
  async function git(...args: string[]) {
    return (await execute("git", ["-C", repo, ...args])).stdout.trim();
  }
  async function worktree(name: string, external = false) {
    const path = external ? join(sandbox, name) : join(repo, ".worktrees", name);
    await git("worktree", "add", "-q", "-b", name, path);
    return path;
  }
  beforeEach(async () => {
    sandbox = await realpath(await mkdtemp(join(tmpdir(), "cpl-audit-")));
    root = join(sandbox, "repos");
    repo = join(root, "local", "sample");
    data = join(sandbox, "config");
    await mkdir(repo, { recursive: true });
    await git("init", "-q", "-b", "main");
    await writeFile(join(repo, "file.txt"), "base\n");
    await writeFile(join(repo, ".gitignore"), ".worktrees/\nignored/\n");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-qm",
      "initial",
    );
    manager = createRepositoryManager({ dataDir: data, defaultRootDir: root });
    await manager.initialize({ workspaceRoot: join(sandbox, "requirements") });
    const record = await manager.register({ path: repo });
    expect(record.isManaged).toBe(true);
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("compares registry, Git and disk, protects primary and retains file risks", async () => {
    const referenced = await worktree("referenced");
    const unused = await worktree("unused");
    const external = await worktree("external", true);
    const missing = await worktree("missing");
    await rm(missing, { recursive: true });
    await git("worktree", "lock", "--reason", "review", unused);
    const disk = join(repo, ".worktrees", "unregistered");
    await mkdir(disk);
    await writeFile(join(unused, "file.txt"), "edited\n");
    await writeFile(join(unused, "new.txt"), "untracked");
    await mkdir(join(unused, "ignored"));
    await writeFile(join(unused, "ignored", "private.txt"), "ignored");
    const record = (await manager.search())[0]!;
    const workspace = await manager.createWorkspace({ name: "requirement" });
    // Legacy links must also protect a worktree that is not in current member metadata.
    await symlink(referenced, join(workspace.absolutePath, "legacy"));
    const registry = JSON.parse(await readFile(join(data, "workspaces.json"), "utf8"));
    registry.workspaces[0].members = [{ repositoryId: record.id, alias: "legacy", mode: "link" }];
    await writeFile(join(data, "workspaces.json"), JSON.stringify(registry));
    const report = await manager.auditWorktrees();
    expect(report.items.some((item) => item.path === repo)).toBe(false);
    expect(report.items.find((item) => item.path === referenced)).toMatchObject({
      category: "referenced",
      references: ["requirement/legacy"],
    });
    expect(report.items.find((item) => item.path === external)?.category).toBe("external");
    expect(report.items.find((item) => item.path === missing)).toMatchObject({
      category: "missing",
      exists: false,
    });
    expect(report.items.find((item) => item.path === disk)).toMatchObject({
      category: "unregistered",
      risks: ["unknown"],
    });
    const candidate = report.items.find((item) => item.path === unused)!;
    expect(candidate.category).toBe("unreferenced");
    expect(candidate.risks).toEqual(
      expect.arrayContaining([
        "dirty",
        "untracked",
        "ignored-files",
        "locked",
        "no-upstream",
        "unpublished",
      ]),
    );
    expect(candidate.locked).toBe("review");
    expect(candidate.changes).toContainEqual({ status: "!!", path: "ignored/" });
    expect(await git("worktree", "list", "--porcelain")).toContain("locked review");
    expect(await readFile(join(unused, "file.txt"), "utf8")).toBe("edited\n");
    await expect(validateAuditPath(candidate, await manager.search())).resolves.toBe(unused);
    await expect(
      validateAuditPath({ ...candidate, path: repo }, await manager.search()),
    ).rejects.toThrow();
  });

  it("persists reports and ignores, then resurfaces changes at the same path", async () => {
    const path = await worktree("keep");
    await writeFile(join(path, "new.txt"), "first");
    const first = (await manager.auditWorktrees()).items[0]!;
    await manager.setWorktreeAuditIgnored(first.id, first.fingerprint, true);
    const reloaded = createRepositoryManager({ dataDir: data });
    expect((await reloaded.getWorktreeAudit())?.items[0]?.ignored).toBe(true);
    expect((await reloaded.auditWorktrees()).items[0]?.ignored).toBe(true);
    await writeFile(join(path, "new.txt"), "second edit");
    const updated = (await reloaded.auditWorktrees()).items[0]!;
    expect(updated.ignored).toBe(false);
    expect(updated.fingerprint).not.toBe(first.fingerprint);
    await expect(
      reloaded.setWorktreeAuditIgnored(first.id, first.fingerprint, true),
    ).rejects.toThrow("changed");
    await reloaded.setWorktreeAuditIgnored(updated.id, updated.fingerprint, true);
    expect(
      (await reloaded.setWorktreeAuditIgnored(updated.id, updated.fingerprint, false)).items[0]
        ?.ignored,
    ).toBe(false);
    await writeFile(join(data, "worktree-audit.json"), "{}");
    await expect(reloaded.getWorktreeAudit()).rejects.toThrow("Invalid");
  });

  it("does not traverse unregistered symlink directories or fall back to the parent Git repository", async () => {
    const path = await worktree("outside", true);
    await mkdir(join(repo, ".worktrees"));
    const link = join(repo, ".worktrees", "link");
    await symlink(path, link);
    const report = await manager.auditWorktrees();
    expect(report.items.find((item) => item.path === link)).toMatchObject({
      category: "unregistered",
      changes: [],
      risks: ["symlink", "unknown"],
    });
    const valid = report.items.find((item) => item.path === path)!;
    await expect(
      validateAuditPath({ ...valid, path: link }, await manager.search()),
    ).rejects.toThrow();
  });

  it("detects a real merge conflict and unfinished operation", async () => {
    const path = await worktree("conflict");
    await execute("git", ["-C", path, "config", "user.name", "Test"]);
    await execute("git", ["-C", path, "config", "user.email", "test@example.com"]);
    await writeFile(join(path, "file.txt"), "ours\n");
    await execute("git", ["-C", path, "commit", "-qam", "ours"]);
    await writeFile(join(repo, "file.txt"), "theirs\n");
    await git("commit", "-qam", "theirs");
    await expect(execute("git", ["-C", path, "merge", "main"])).rejects.toThrow();
    const item = (await manager.auditWorktrees()).items[0]!;
    expect(item.operations).toContain("MERGE_HEAD");
    expect(item.risks).toEqual(expect.arrayContaining(["conflicts", "dirty", "in-progress"]));
    expect(await readFile(join(path, ".git"), "utf8")).toContain("gitdir:");
  });

  it("supports cancellation and isolates repository failures without reporting success", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await manager.auditWorktrees({ signal: controller.signal })).toMatchObject({
      complete: false,
      cancelled: true,
      repositoriesScanned: 0,
    });
    await rm(join(repo, ".git"), { recursive: true });
    const report = await manager.auditWorktrees();
    expect(report.complete).toBe(false);
    expect(report.errors).toHaveLength(1);
  });

  it("warns when detached commits have no local branch or tag and never fetches remote refs", async () => {
    await git("remote", "add", "origin", join(sandbox, "nonexistent-remote.git"));
    await git("update-ref", "refs/remotes/origin/main", "HEAD");
    await git("branch", "--set-upstream-to=origin/main", "main");
    const path = join(repo, ".worktrees", "detached");
    await git("worktree", "add", "-q", "--detach", path);
    await execute("git", [
      "-C",
      path,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-qm",
      "detached commit",
    ]);
    const item = (await manager.auditWorktrees()).items[0]!;
    expect(item.error).toBeNull();
    expect(item.upstream).toBeNull();
    expect(item.unpublished).toBe(1);
    expect(item.risks).toContain("detached-unprotected");
    await execute("git", ["-C", path, "tag", "keep-detached"]);
    expect((await manager.auditWorktrees()).items[0]?.risks).not.toContain("detached-unprotected");
  });

  it("stops a running job and returns an incomplete persisted report", async () => {
    await worktree("cancel");
    const jobs = createWorktreeAuditJobs(manager);
    let job = jobs.start();
    jobs.cancel(job.id);
    while (job.status === "running") job = await jobs.wait(job.id, job.revision);
    expect(job.status).toBe("cancelled");
    expect(job.report).toMatchObject({ complete: false, cancelled: true });
    expect(await manager.getWorktreeAudit()).toMatchObject({ complete: false, cancelled: true });
  });

  it("handles a missing cached upstream without treating the whole worktree as unreadable", async () => {
    const path = await worktree("upstream-gone");
    await git("remote", "add", "origin", join(sandbox, "not-a-remote.git"));
    await git("update-ref", "refs/remotes/origin/topic", "HEAD");
    await git("branch", "--set-upstream-to=origin/topic", "upstream-gone");
    await git("update-ref", "-d", "refs/remotes/origin/topic");
    const item = (await manager.auditWorktrees()).items.find((item) => item.path === path)!;
    expect(item.error).toBeNull();
    expect(item.risks).toContain("missing-upstream");
    expect((await manager.previewWorktreeRemoval(item.id)).blockers).toEqual([]);
  });

  it("requires a separate opt-in before deleting Git-ignored files or directories", async () => {
    const path = await worktree("with-ignored");
    await mkdir(join(path, "ignored"));
    await writeFile(join(path, "ignored", "local.env"), "keep unless explicitly confirmed");
    const item = (await manager.auditWorktrees()).items[0]!;
    const plan = await manager.previewWorktreeRemoval(item.id);
    expect(plan.blockers).toEqual([]);
    const input = { id: item.id, fingerprint: plan.item.fingerprint, confirmedPath: path };
    await expect(manager.removeAuditedWorktree(input)).rejects.toThrow("ignored files");
    expect(await readFile(join(path, "ignored", "local.env"), "utf8")).toBe(
      "keep unless explicitly confirmed",
    );
    await manager.removeAuditedWorktree({ ...input, includeIgnored: true });
    await expect(readFile(join(path, "ignored", "local.env"), "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await git("rev-parse", "with-ignored")).toBe(await git("rev-parse", "main"));
  }, 30_000);

  it("provides cancellable progress jobs and preserves the legacy doctor JSON contract", async () => {
    await worktree("job");
    const jobs = createWorktreeAuditJobs(manager);
    let job = jobs.start();
    expect(jobs.start().id).toBe(job.id);
    while (job.status === "running") job = await jobs.wait(job.id, job.revision);
    expect(job.status).toBe("completed");
    expect(job.completed).toBe(1);
    expect(job.report?.items).toHaveLength(1);
    await expect(jobs.wait("bad-id", 0)).rejects.toThrow("Unknown");
    const output: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: () => {},
      isTTY: false,
    };
    expect(await runCli(["doctor", "worktrees", "--json"], context)).toBe(0);
    expect(JSON.parse(output.join("\n"))).toMatchObject({ schemaVersion: 1, complete: true });
    output.length = 0;
    await runCli(["doctor", "--json"], context);
    expect(Array.isArray(JSON.parse(output.join("\n")))).toBe(true);
  });

  it("deletes only the confirmed worktree directory and registration, retaining branches and siblings", async () => {
    const path = await worktree("delete-me");
    const sibling = await worktree("sibling");
    const external = await worktree("delete-external", true);
    const head = await git("rev-parse", "delete-me");
    const report = await manager.auditWorktrees();
    const item = report.items.find((item) => item.path === path)!;
    const plan = await manager.previewWorktreeRemoval(item.id);
    expect(plan.blockers).toEqual([]);
    await expect(
      manager.removeAuditedWorktree({
        id: item.id,
        fingerprint: plan.item.fingerprint,
        confirmedPath: "delete-me",
      }),
    ).rejects.toThrow("complete worktree path");
    await expect(
      manager.removeAuditedWorktree({ id: item.id, fingerprint: "stale", confirmedPath: path }),
    ).rejects.toThrow("changed");
    const result = await manager.removeAuditedWorktree({
      id: item.id,
      fingerprint: plan.item.fingerprint,
      confirmedPath: path,
    });
    expect(result.removedPath).toBe(path);
    expect(result.warning).toBeNull();
    await expect(readFile(join(path, ".git"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await git("rev-parse", "delete-me")).toBe(head);
    expect(await git("worktree", "list", "--porcelain")).not.toContain(`worktree ${path}\n`);
    expect(await readFile(join(sibling, "file.txt"), "utf8")).toBe("base\n");
    expect((await manager.getWorktreeAudit())?.items.some((entry) => entry.id === item.id)).toBe(
      false,
    );
    const externalItem = report.items.find((entry) => entry.path === external)!;
    const externalPlan = await manager.previewWorktreeRemoval(externalItem.id);
    expect(externalPlan.blockers).toEqual([]);
    await manager.removeAuditedWorktree({
      id: externalItem.id,
      fingerprint: externalPlan.item.fingerprint,
      confirmedPath: external,
    });
    expect(await git("rev-parse", "delete-external")).toBe(head);
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("base\n");
  }, 30_000);

  it("rechecks deletion protections after preview instead of trusting the cached report", async () => {
    const path = await worktree("protected");
    const item = (await manager.auditWorktrees()).items[0]!;
    const initial = await manager.previewWorktreeRemoval(item.id);
    const input = { id: item.id, fingerprint: initial.item.fingerprint, confirmedPath: path };
    await writeFile(join(path, "untracked.txt"), "keep me");
    expect((await manager.previewWorktreeRemoval(item.id)).forceReasons).toContain("untracked");
    await expect(manager.removeAuditedWorktree(input)).rejects.toThrow("protected");
    await rm(join(path, "untracked.txt"));
    await mkdir(join(path, "ignored"));
    await writeFile(join(path, "ignored", "secret.txt"), "private");
    expect((await manager.previewWorktreeRemoval(item.id)).item.risks).toContain("ignored-files");
    await expect(manager.removeAuditedWorktree(input)).rejects.toThrow("protected");
    await rm(join(path, "ignored"), { recursive: true });
    await git("worktree", "lock", path);
    expect((await manager.previewWorktreeRemoval(item.id)).forceReasons).toContain("locked");
    await git("worktree", "unlock", path);
    await manager.register({ path });
    expect((await manager.previewWorktreeRemoval(item.id)).blockers).toContain("protected-path");
    await expect(manager.previewWorktreeRemoval("unknown-id")).rejects.toThrow("not found");
    expect(await readFile(join(path, "file.txt"), "utf8")).toBe("base\n");
  }, 30_000);

  it("requires force confirmation for referenced members, missing paths and detached commits", async () => {
    const repository = (await manager.search())[0]!;
    const workspace = await manager.createWorkspace({ name: "in-use" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      mode: "worktree",
      branch: "feat/in-use",
      createBranch: true,
    });
    const missing = await worktree("gone");
    await rm(missing, { recursive: true });
    const detached = join(repo, ".worktrees", "detached-unique");
    await git("worktree", "add", "-q", "--detach", detached);
    await execute("git", [
      "-C",
      detached,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-qm",
      "unique",
    ]);
    const report = await manager.auditWorktrees();
    const used = report.items.find((item) => item.category === "referenced")!;
    expect((await manager.previewWorktreeRemoval(used.id)).forceReasons).toContain("referenced");
    const gone = report.items.find((item) => item.path === missing)!;
    expect((await manager.previewWorktreeRemoval(gone.id)).forceReasons).toContain("missing");
    const unique = report.items.find((item) => item.path === detached)!;
    const uniquePlan = await manager.previewWorktreeRemoval(unique.id);
    expect(uniquePlan.forceReasons).toContain("detached-unprotected");
    await expect(
      manager.removeAuditedWorktree({
        id: unique.id,
        fingerprint: uniquePlan.item.fingerprint,
        confirmedPath: detached,
      }),
    ).rejects.toThrow("Force deletion confirmation");
  }, 30_000);
});
