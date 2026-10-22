import { readFile, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

type Fixture = Awaited<ReturnType<typeof createWorkspaceFixture>>;

async function prepare(base: Fixture) {
  const remote = await base.remote("retry");
  const workspace = await base.manager.createWorkspace({ name: "Sync Retry" });
  const updated = await base.manager.addWorkspaceMember({
    workspaceId: workspace.id,
    repositoryId: remote.repository.id,
    mode: "worktree",
    branch: "feat/retry",
    createBranch: true,
  });
  const member = updated.members[0]!;
  if (member.mode !== "worktree") throw new Error("Expected managed worktree");
  await base.git(member.worktreePath, "push", "-q", "-u", "origin", "feat/retry");
  return { ...remote, workspace, worktree: member.worktreePath };
}

type Scenario = Awaited<ReturnType<typeof prepare>>;

async function ignore(base: Fixture, scenario: Scenario, paths: string[]) {
  const value = (
    await base.git(scenario.worktree, "rev-parse", "--git-path", "info/exclude")
  ).stdout.trim();
  const path = isAbsolute(value) ? value : resolve(scenario.worktree, value);
  await writeFile(path, `${paths.join("\n")}\n`);
}

async function member(base: Fixture, scenario: Scenario) {
  const workspaces = await base.manager.searchWorkspaces();
  return workspaces.find(({ id }) => id === scenario.workspace.id)!.members[0]!;
}

async function remoteTip(base: Fixture, scenario: Scenario) {
  return (
    await base.git(scenario.path, "ls-remote", "origin", "refs/heads/feat/retry")
  ).stdout.split("\t")[0]!;
}

async function stagedDraft(base: Fixture, scenario: Scenario) {
  await writeFile(join(scenario.worktree, "draft.txt"), "staged work in progress\n");
  await base.git(scenario.worktree, "add", "--", "draft.txt");
  return (await base.git(scenario.worktree, "diff", "--cached", "--binary")).stdout;
}

describe("batch synchronization failure retries", { timeout: 15_000 }, () => {
  let base: Fixture;
  let scenario: Scenario;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepare(base);
  }, 20_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);

  it("integrates remote commits after an ignored-path rejection before allowing a retry push", async () => {
    await base.git(scenario.path, "switch", "-q", "--detach", "origin/feat/retry");
    await base.commit(scenario.path, "collision.txt", "remote work must survive\n");
    await base.git(scenario.path, "push", "-q", "origin", "HEAD:refs/heads/feat/retry");
    const remote = await remoteTip(base, scenario);
    await ignore(base, scenario, ["collision.txt"]);
    await writeFile(join(scenario.worktree, "collision.txt"), "ignored local work\n");
    const draft = await stagedDraft(base, scenario);

    const rejected = await base.manager.syncWorkspaceBranches(scenario.workspace.id);
    expect(rejected.items[0]).toMatchObject({
      outcome: "failed",
      phase: "rebase",
      backup: { restored: true },
    });
    expect(await remoteTip(base, scenario)).toBe(remote);
    const saved = join(base.sandbox, "saved-ignored-collision.txt");
    await rename(join(scenario.worktree, "collision.txt"), saved);

    const retried = await base.manager.syncWorkspaceBranches(scenario.workspace.id);
    if (retried.items[0]!.outcome === "push-required") {
      await base.manager.pushWorkspaceMember({
        workspaceId: scenario.workspace.id,
        repositoryId: scenario.repository.id,
        force: true,
      });
    } else {
      expect(retried.items[0]).toMatchObject({ outcome: "synced" });
    }

    expect(await readFile(join(scenario.worktree, "collision.txt"), "utf8")).toBe(
      "remote work must survive\n",
    );
    await expect(
      base.git(scenario.worktree, "merge-base", "--is-ancestor", remote, "HEAD"),
    ).resolves.toBeDefined();
    expect(await remoteTip(base, scenario)).toBe(
      (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout.trim(),
    );
    expect(await readFile(saved, "utf8")).toBe("ignored local work\n");
    expect((await base.git(scenario.worktree, "diff", "--cached", "--binary")).stdout).toBe(draft);
    expect(await member(base, scenario)).not.toHaveProperty("forcePushBase");
  });

  it("does not overwrite ignored files when a confirmed push falls back to a fast-forward rebase", async () => {
    await base.commit(scenario.worktree, "origin.txt", "published feature change\n");
    await base.git(scenario.worktree, "push", "-q", "origin", "feat/retry");
    const originalRemote = await remoteTip(base, scenario);
    await base.commit(scenario.path, "origin.txt", "conflicting default branch change\n");
    await base.git(scenario.path, "push", "-q", "origin", "main");
    const draft = await stagedDraft(base, scenario);

    const batch = await base.manager.syncWorkspaceBranches(scenario.workspace.id);
    expect(batch.items[0]).toMatchObject({
      outcome: "conflict",
      phase: "rebase",
      backup: { restored: false },
    });
    expect(await member(base, scenario)).toMatchObject({ forcePushBase: originalRemote });
    await base.git(scenario.worktree, "rebase", "--abort");
    await base.git(scenario.worktree, "stash", "apply", "--index", batch.items[0]!.backup!.oid);
    await base.git(scenario.path, "switch", "-q", "--detach", "origin/feat/retry");
    await base.commit(scenario.path, "remote-collision.txt", "incoming remote branch file\n");
    await base.git(scenario.path, "push", "-q", "origin", "HEAD:refs/heads/feat/retry");
    const remote = await remoteTip(base, scenario);
    await ignore(base, scenario, ["remote-collision.txt"]);
    await writeFile(join(scenario.worktree, "remote-collision.txt"), "ignored local content\n");
    const head = (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout;

    await expect(
      base.manager.pushWorkspaceMember({
        workspaceId: scenario.workspace.id,
        repositoryId: scenario.repository.id,
        force: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await readFile(join(scenario.worktree, "remote-collision.txt"), "utf8")).toBe(
      "ignored local content\n",
    );
    expect((await base.git(scenario.worktree, "diff", "--cached", "--binary")).stdout).toBe(draft);
    expect((await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout).toBe(head);
    expect(await remoteTip(base, scenario)).toBe(remote);
  });

  it("retries the same-name remote rebase after a conflicted attempt is aborted", async () => {
    await base.commit(scenario.worktree, "origin.txt", "local conflicting commit\n");
    await base.git(scenario.path, "switch", "-q", "--detach", "origin/feat/retry");
    await base.commit(scenario.path, "origin.txt", "remote conflicting commit\n");
    await base.git(scenario.path, "push", "-q", "origin", "HEAD:refs/heads/feat/retry");
    const remote = await remoteTip(base, scenario);
    await stagedDraft(base, scenario);

    const first = await base.manager.syncWorkspaceBranches(scenario.workspace.id);
    expect(first.items[0]).toMatchObject({
      outcome: "conflict",
      phase: "rebase",
      backup: { restored: false },
    });
    await base.git(scenario.worktree, "rebase", "--abort");

    const retried = await base.manager.syncWorkspaceBranches(scenario.workspace.id);
    expect(retried.items[0]).toMatchObject({ outcome: "conflict", phase: "rebase" });
    expect(
      (await base.git(scenario.worktree, "diff", "--name-only", "--diff-filter=U")).stdout,
    ).toBe("origin.txt\n");
    expect(await remoteTip(base, scenario)).toBe(remote);
    expect(
      (await base.git(scenario.worktree, "show", `${first.items[0]!.backup!.oid}:draft.txt`))
        .stdout,
    ).toBe("staged work in progress\n");
    expect(await member(base, scenario)).not.toHaveProperty("forcePushBase");
  });
});
