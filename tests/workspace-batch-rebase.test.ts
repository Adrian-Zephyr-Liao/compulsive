import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

type Fixture = Awaited<ReturnType<typeof createWorkspaceFixture>>;

async function prepare(base: Fixture, branch = "main", detached = false) {
  const remote = await base.remote("batch", branch);
  const workspace = await base.manager.createWorkspace({ name: "Batch Rebase" });
  const updated = await base.manager.addWorkspaceMember({
    workspaceId: workspace.id,
    repositoryId: remote.repository.id,
    mode: "worktree",
    ...(detached
      ? { startPoint: `origin/${branch}`, detached: true }
      : { branch: "feat/batch", createBranch: true }),
  });
  const member = updated.members[0]!;
  if (member.mode !== "worktree") throw new Error("Expected managed worktree");
  return { ...remote, workspace, worktree: member.worktreePath, defaultBranch: branch };
}

type Scenario = Awaited<ReturnType<typeof prepare>>;

async function advanceMain(base: Fixture, scenario: Scenario, file = "main-next.txt") {
  await base.commit(scenario.path, file, "new main code\n");
  await base.git(scenario.path, "push", "-q", "origin", scenario.defaultBranch);
}

async function snapshot(base: Fixture, path: string) {
  const [status, staged, unstaged] = await Promise.all([
    base.git(path, "status", "--porcelain=v1", "-z"),
    base.git(path, "diff", "--cached", "--binary"),
    base.git(path, "diff", "--binary"),
  ]);
  return { status: status.stdout, staged: staged.stdout, unstaged: unstaged.stdout };
}

async function remoteTip(base: Fixture, scenario: Scenario) {
  return (
    await base.git(scenario.path, "ls-remote", "origin", "refs/heads/feat/batch")
  ).stdout.split("\t")[0]!;
}

async function gitPath(base: Fixture, path: string, name: string) {
  const result = (await base.git(path, "rev-parse", "--git-path", name)).stdout.trim();
  return isAbsolute(result) ? result : resolve(path, result);
}

// Real fetch/rebase/push and stash recovery span many subprocesses; scope the budget to these integration cases.
describe("batch rebase preserves local work", { timeout: 10_000 }, () => {
  let base: Fixture;
  let scenario: Scenario;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepare(base);
    await advanceMain(base, scenario);
  }, 20_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);

  describe("seven staged additions", () => {
    const files = Array.from({ length: 6 }, (_, index) => `draft-${index}.txt`);
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
    let before: Awaited<ReturnType<typeof snapshot>>;
    beforeEach(async () => {
      await Promise.all(files.map((name) => writeFile(join(scenario.worktree, name), `${name}\n`)));
      await writeFile(join(scenario.worktree, "draft.png"), png);
      await base.git(scenario.worktree, "add", "--", ...files, "draft.png");
      before = await snapshot(base, scenario.worktree);
    });

    it("syncs the branch and restores staged additions including PNG bytes", async () => {
      const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(result.items[0]).toMatchObject({ outcome: "synced", backup: { restored: true } });
      const [after, image, main, remote, head, stash] = await Promise.all([
        snapshot(base, scenario.worktree),
        readFile(join(scenario.worktree, "draft.png")),
        readFile(join(scenario.worktree, "main-next.txt"), "utf8"),
        remoteTip(base, scenario),
        base.git(scenario.worktree, "rev-parse", "HEAD"),
        base.git(scenario.worktree, "rev-parse", "refs/stash"),
      ]);
      expect(after).toEqual(before);
      expect(image).toEqual(png);
      expect(main).toBe("new main code\n");
      expect(remote).toBe(head.stdout.trim());
      expect(
        (await base.git(scenario.path, "ls-tree", "--name-only", remote)).stdout,
      ).not.toContain("draft");
      expect(stash.stdout.trim()).toBe(result.items[0]!.backup!.oid);
    });
  });

  describe("mixed local changes and an earlier stash", () => {
    let earlier: string;
    let before: Awaited<ReturnType<typeof snapshot>>;
    beforeEach(async () => {
      await writeFile(join(scenario.worktree, "earlier.txt"), "earlier stash\n");
      await base.git(scenario.worktree, "stash", "push", "-u", "-m", "existing user stash");
      earlier = (await base.git(scenario.worktree, "rev-parse", "refs/stash")).stdout.trim();
      await writeFile(join(scenario.worktree, "origin.txt"), "staged version\n");
      await base.git(scenario.worktree, "add", "--", "origin.txt");
      await writeFile(join(scenario.worktree, "origin.txt"), "staged version\nunstaged version\n");
      await writeFile(join(scenario.worktree, "untracked.txt"), "untracked draft\n");
      before = await snapshot(base, scenario.worktree);
    });

    it("restores staged, unstaged and untracked work without replacing the earlier stash", async () => {
      const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(result.items[0]).toMatchObject({ outcome: "synced", backup: { restored: true } });
      expect(await snapshot(base, scenario.worktree)).toEqual(before);
      expect(await readFile(join(scenario.worktree, "untracked.txt"), "utf8")).toBe(
        "untracked draft\n",
      );
      expect((await base.git(scenario.worktree, "rev-parse", "stash@{1}")).stdout.trim()).toBe(
        earlier,
      );
      const remote = await remoteTip(base, scenario);
      expect((await base.git(scenario.path, "show", `${remote}:origin.txt`)).stdout).toBe(
        "batch remote\n",
      );
    });
  });

  it("restores local work and retains a backup after fetch fails", async () => {
    await writeFile(join(scenario.worktree, "origin.txt"), "staged draft\n");
    await base.git(scenario.worktree, "add", "--", "origin.txt");
    const before = await snapshot(base, scenario.worktree);
    const head = (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout;
    await base.git(
      scenario.path,
      "remote",
      "set-url",
      "origin",
      `file://${join(base.sandbox, "missing.git")}`,
    );

    const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

    expect(result.items[0]).toMatchObject({
      outcome: "failed",
      phase: "fetch",
      backup: { restored: true },
    });
    expect(await snapshot(base, scenario.worktree)).toEqual(before);
    expect((await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout).toBe(head);
    expect((await base.git(scenario.worktree, "rev-parse", "refs/stash")).stdout.trim()).toBe(
      result.items[0]!.backup!.oid,
    );
  });

  describe("rejected push", () => {
    let before: Awaited<ReturnType<typeof snapshot>>;
    beforeEach(async () => {
      await writeFile(join(scenario.remotePath, "hooks", "pre-receive"), "#!/bin/sh\nexit 1\n", {
        mode: 0o755,
      });
      await writeFile(join(scenario.worktree, "draft.txt"), "local only\n");
      await base.git(scenario.worktree, "add", "--", "draft.txt");
      before = await snapshot(base, scenario.worktree);
    });

    it("reports the rejection without losing or publishing staged work", async () => {
      const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(result.items[0]).toMatchObject({
        outcome: "failed",
        phase: "push",
        backup: { restored: true },
      });
      expect(await snapshot(base, scenario.worktree)).toEqual(before);
      expect(await remoteTip(base, scenario)).toBe("");
      expect(
        (await base.git(scenario.worktree, "show", `${result.items[0]!.backup!.oid}:draft.txt`))
          .stdout,
      ).toBe("local only\n");
    });
  });

  describe("stash restoration conflict", () => {
    beforeEach(async () => {
      await base.commit(scenario.path, "origin.txt", "main changed the same file\n");
      await base.git(scenario.path, "push", "-q", "origin", "main");
      await writeFile(join(scenario.worktree, "origin.txt"), "staged local change\n");
      await base.git(scenario.worktree, "add", "--", "origin.txt");
    });

    it("reports the restoration conflict instead of reporting the repository synced", async () => {
      const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(result.items[0]).toMatchObject({
        outcome: "conflict",
        phase: "restore",
        backup: { restored: false },
      });
      expect(
        (await base.git(scenario.worktree, "show", `${result.items[0]!.backup!.oid}:origin.txt`))
          .stdout,
      ).toBe("staged local change\n");
      expect((await base.git(scenario.worktree, "rev-parse", "refs/stash")).stdout.trim()).toBe(
        result.items[0]!.backup!.oid,
      );
      expect(
        (await base.git(scenario.path, "show", `${await remoteTip(base, scenario)}:origin.txt`))
          .stdout,
      ).toBe("main changed the same file\n");
    });
  });
});

describe("batch rebase preserves remote history", { timeout: 10_000 }, () => {
  let base: Fixture;
  let scenario: Scenario;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepare(base);
    await base.commit(scenario.worktree, "feature.txt", "local feature\n");
    await base.git(scenario.worktree, "push", "-q", "-u", "origin", "feat/batch");
  }, 20_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);

  describe("same-name remote writer", () => {
    let remote: string;
    beforeEach(async () => {
      const writer = join(base.sandbox, "remote-writer");
      await base.git(
        base.sandbox,
        "clone",
        "-q",
        "--branch",
        "feat/batch",
        `file://${scenario.remotePath}`,
        writer,
      );
      await base.commit(writer, "remote.txt", "remote writer\n");
      await base.git(writer, "push", "-q", "origin", "HEAD");
      remote = (await base.git(writer, "rev-parse", "HEAD")).stdout.trim();
      await base.commit(scenario.worktree, "local-next.txt", "local writer\n");
    });

    it("integrates the remote writer before pushing the local commits", async () => {
      const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(result.items[0]).toMatchObject({ outcome: "synced" });
      expect(await readFile(join(scenario.worktree, "remote.txt"), "utf8")).toBe("remote writer\n");
      expect(await readFile(join(scenario.worktree, "local-next.txt"), "utf8")).toBe(
        "local writer\n",
      );
      await expect(
        base.git(scenario.worktree, "merge-base", "--is-ancestor", remote, "HEAD"),
      ).resolves.toBeDefined();
      expect(await remoteTip(base, scenario)).toBe(
        (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout.trim(),
      );
    });
  });

  describe("rebasing published history", () => {
    let originalRemote: string;
    let before: Awaited<ReturnType<typeof snapshot>>;
    beforeEach(async () => {
      originalRemote = await remoteTip(base, scenario);
      await advanceMain(base, scenario);
      await writeFile(join(scenario.worktree, "draft.txt"), "not a commit\n");
      await base.git(scenario.worktree, "add", "--", "draft.txt");
      before = await snapshot(base, scenario.worktree);
    });

    it("requires explicit leased force push and restores staged work", async () => {
      const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(result.items[0]).toMatchObject({
        outcome: "push-required",
        phase: "push",
        backup: { restored: true },
      });
      expect(await remoteTip(base, scenario)).toBe(originalRemote);
      expect(await snapshot(base, scenario.worktree)).toEqual(before);
      const workspace = (await base.manager.searchWorkspaces()).find(
        ({ id }) => id === scenario.workspace.id,
      )!;
      expect(workspace.members[0]).toMatchObject({ forcePushBase: originalRemote });
      await expect(
        base.git(scenario.worktree, "merge-base", "--is-ancestor", "origin/main", "HEAD"),
      ).resolves.toBeDefined();
    });
  });

  it("leaves a conflicted rebase and its stash intact without pushing", async () => {
    await base.commit(scenario.worktree, "origin.txt", "feature conflicts\n");
    const oldRemote = await remoteTip(base, scenario);
    await base.commit(scenario.path, "origin.txt", "main conflicts\n");
    await base.git(scenario.path, "push", "-q", "origin", "main");
    await writeFile(join(scenario.worktree, "draft.txt"), "preserved staged draft\n");
    await base.git(scenario.worktree, "add", "--", "draft.txt");

    const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

    expect(result.items[0]).toMatchObject({
      outcome: "conflict",
      phase: "rebase",
      backup: { restored: false },
    });
    expect(
      (await base.git(scenario.worktree, "diff", "--name-only", "--diff-filter=U")).stdout,
    ).toBe("origin.txt\n");
    expect(
      await readFile(await gitPath(base, scenario.worktree, "rebase-merge/head-name"), "utf8"),
    ).toBe("refs/heads/feat/batch\n");
    expect(await remoteTip(base, scenario)).toBe(oldRemote);
    expect(
      (await base.git(scenario.worktree, "show", `${result.items[0]!.backup!.oid}:draft.txt`))
        .stdout,
    ).toBe("preserved staged draft\n");
  });
});

describe("batch rebase preflight", () => {
  let base: Fixture;
  let scenario: Scenario;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepare(base);
    await writeFile(join(scenario.worktree, "draft.txt"), "keep local work\n");
    await base.git(scenario.worktree, "add", "--", "draft.txt");
  }, 20_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);

  it("does not stash or fetch while a Git operation is unfinished", async () => {
    const head = (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout.trim();
    await writeFile(await gitPath(base, scenario.worktree, "MERGE_HEAD"), `${head}\n`);
    const before = await snapshot(base, scenario.worktree);

    const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

    expect(result.items[0]).toMatchObject({ phase: "preflight" });
    expect(result.items[0]!.outcome).not.toBe("synced");
    expect(result.items[0]).not.toHaveProperty("backup");
    expect(await snapshot(base, scenario.worktree)).toEqual(before);
    await expect(
      base.git(scenario.worktree, "rev-parse", "--verify", "refs/stash"),
    ).rejects.toBeDefined();
    expect(await readFile(await gitPath(base, scenario.worktree, "MERGE_HEAD"), "utf8")).toBe(
      `${head}\n`,
    );
  });

  it("does not stash when the worktree is on an unexpected branch", async () => {
    await base.git(scenario.worktree, "switch", "-q", "-c", "feat/unexpected");
    const before = await snapshot(base, scenario.worktree);

    const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

    expect(result.items[0]).toMatchObject({ phase: "preflight" });
    expect(result.items[0]!.outcome).not.toBe("synced");
    expect(result.items[0]).not.toHaveProperty("backup");
    expect(await snapshot(base, scenario.worktree)).toEqual(before);
    await expect(
      base.git(scenario.worktree, "rev-parse", "--verify", "refs/stash"),
    ).rejects.toBeDefined();
  });
});

describe("confirmed force push after batch rebase", { timeout: 10_000 }, () => {
  let base: Fixture;
  let scenario: Scenario;
  let before: Awaited<ReturnType<typeof snapshot>>;
  let originalRemote: string;
  let batchBackup: string;
  let rewrittenHead: string;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepare(base);
    await base.commit(scenario.worktree, "feature.txt", "published feature\n");
    await base.git(scenario.worktree, "push", "-q", "-u", "origin", "feat/batch");
    originalRemote = await remoteTip(base, scenario);
    await advanceMain(base, scenario);
    await writeFile(join(scenario.worktree, "draft.txt"), "staged local draft\n");
    await base.git(scenario.worktree, "add", "--", "draft.txt");
    await writeFile(join(scenario.worktree, "untracked.txt"), "untracked local draft\n");
    before = await snapshot(base, scenario.worktree);
    const batch = await base.manager.syncWorkspaceBranches(scenario.workspace.id);
    expect(batch.items[0]).toMatchObject({
      outcome: "push-required",
      backup: { restored: true },
    });
    batchBackup = batch.items[0]!.backup!.oid;
    rewrittenHead = (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout;
  }, 20_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);

  it("preserves restored local work when explicitly confirming the leased force push", async () => {
    await base.manager.pushWorkspaceMember({
      workspaceId: scenario.workspace.id,
      repositoryId: scenario.repository.id,
      force: true,
    });

    expect(await snapshot(base, scenario.worktree)).toEqual(before);
    const head = (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout.trim();
    expect(await remoteTip(base, scenario)).toBe(head);
    expect((await base.git(scenario.path, "ls-tree", "--name-only", head)).stdout).not.toContain(
      "draft",
    );
    expect((await base.git(scenario.worktree, "stash", "list", "--format=%H")).stdout).toContain(
      batchBackup,
    );
    const workspace = (await base.manager.searchWorkspaces()).find(
      ({ id }) => id === scenario.workspace.id,
    )!;
    expect(workspace.members[0]).not.toHaveProperty("forcePushBase");
  });

  describe("another remote writer after rebase", () => {
    let remote: string;
    beforeEach(async () => {
      const writer = join(base.sandbox, "force-lease-writer");
      await base.git(
        base.sandbox,
        "clone",
        "-q",
        "--branch",
        "feat/batch",
        `file://${scenario.remotePath}`,
        writer,
      );
      await base.commit(writer, "remote-writer.txt", "concurrent remote writer\n");
      await base.git(writer, "push", "-q", "origin", "HEAD");
      remote = (await base.git(writer, "rev-parse", "HEAD")).stdout.trim();
    });

    it("keeps the original lease and rewritten HEAD across repeated batch synchronization", async () => {
      const repeated = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(repeated.items[0]).toMatchObject({ outcome: "push-required", phase: "push" });
      const [head, actualRemote, after, workspaces] = await Promise.all([
        base.git(scenario.worktree, "rev-parse", "HEAD"),
        remoteTip(base, scenario),
        snapshot(base, scenario.worktree),
        base.manager.searchWorkspaces(),
      ]);
      expect(head.stdout).toBe(rewrittenHead);
      expect(actualRemote).toBe(remote);
      expect(after).toEqual(before);
      const workspace = workspaces.find(({ id }) => id === scenario.workspace.id)!;
      expect(workspace.members[0]).toMatchObject({ forcePushBase: originalRemote });
    });

    it("rejects a changed remote lease and restores work instead of overwriting the writer", async () => {
      await expect(
        base.manager.pushWorkspaceMember({
          workspaceId: scenario.workspace.id,
          repositoryId: scenario.repository.id,
          force: true,
        }),
      ).rejects.toMatchObject({ code: "GIT_FAILED" });

      expect(await remoteTip(base, scenario)).toBe(remote);
      expect(await snapshot(base, scenario.worktree)).toEqual(before);
      expect((await base.git(scenario.worktree, "stash", "list", "--format=%H")).stdout).toContain(
        batchBackup,
      );
      const workspace = (await base.manager.searchWorkspaces()).find(
        ({ id }) => id === scenario.workspace.id,
      )!;
      expect(workspace.members[0]).toMatchObject({ forcePushBase: originalRemote });
    });
  });
});

describe.each(["collision.txt", "generated/code.ts"])(
  "batch rebase protects ignored collisions: %s",
  (target) => {
    let base: Fixture;
    let scenario: Scenario;
    let before: Awaited<ReturnType<typeof snapshot>>;
    let collision: string;
    beforeEach(async () => {
      base = await createWorkspaceFixture();
      scenario = await prepare(base);
      if (target.includes("/")) await mkdir(join(scenario.path, "generated"));
      await base.commit(scenario.path, target, "upstream tracked content\n");
      await base.git(scenario.path, "push", "-q", "origin", "main");
      collision = target.includes("/") ? "generated" : target;
      await writeFile(await gitPath(base, scenario.path, "info/exclude"), `${collision}\n`);
      await writeFile(join(scenario.worktree, collision), "ignored local content\n");
      await writeFile(join(scenario.worktree, "draft.txt"), "staged draft\n");
      await base.git(scenario.worktree, "add", "--", "draft.txt");
      before = await snapshot(base, scenario.worktree);
    }, 20_000);
    afterEach(async () => {
      await base?.dispose();
    }, 20_000);

    it("rejects the rebase without overwriting an ignored file or ancestor and restores staged work", async () => {
      const head = (await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout;

      const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

      expect(result.items[0]).toMatchObject({
        outcome: "failed",
        phase: "rebase",
        backup: { restored: true },
      });
      expect(await readFile(join(scenario.worktree, collision), "utf8")).toBe(
        "ignored local content\n",
      );
      expect((await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout).toBe(head);
      expect(await snapshot(base, scenario.worktree)).toEqual(before);
      expect(await remoteTip(base, scenario)).toBe("");
    });
  },
);

describe.each(["main", "master"])("batch detached reference follows origin/%s", (branch) => {
  let base: Fixture;
  let scenario: Scenario;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepare(base, branch, true);
    await advanceMain(base, scenario);
    await writeFile(join(scenario.worktree, "reference-draft.txt"), "reference draft\n");
    await base.git(scenario.worktree, "add", "--", "reference-draft.txt");
  }, 20_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);

  it("updates the detached checkout and restores staged work without publishing a branch", async () => {
    const before = await snapshot(base, scenario.worktree);

    const result = await base.manager.syncWorkspaceBranches(scenario.workspace.id);

    expect(result.items[0]).toMatchObject({ outcome: "synced", backup: { restored: true } });
    expect(await snapshot(base, scenario.worktree)).toEqual(before);
    expect((await base.git(scenario.worktree, "branch", "--show-current")).stdout).toBe("");
    expect((await base.git(scenario.worktree, "rev-parse", "HEAD")).stdout).toBe(
      (await base.git(scenario.path, "rev-parse", `origin/${branch}`)).stdout,
    );
    expect(await remoteTip(base, scenario)).toBe("");
  });
});
