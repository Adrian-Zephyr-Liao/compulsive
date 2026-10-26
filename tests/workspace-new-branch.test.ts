import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

describe("new workspace branch baselines", () => {
  let base: Awaited<ReturnType<typeof createWorkspaceFixture>>;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
  });
  afterEach(async () => {
    await base?.dispose();
  });

  async function divergedRepository(defaultBranch: string) {
    const remote = await base.remote("app", defaultBranch);
    const cached = (await base.git(remote.path, "rev-parse", `origin/${defaultBranch}`)).stdout;
    await base.git(remote.path, "switch", "-c", "canonical-work");
    await base.commit(remote.path, "canonical-only.txt");
    const canonicalHead = (await base.git(remote.path, "rev-parse", "HEAD")).stdout;
    await writeFile(join(remote.path, "draft.txt"), "keep canonical draft\n");
    const writer = join(base.sandbox, "writer");
    await base.git(base.sandbox, "clone", "-q", remote.remotePath, writer);
    await base.commit(writer, "remote-only.txt");
    await base.git(writer, "push", "-q", "origin", defaultBranch);
    const remoteHead = (await base.git(writer, "rev-parse", "HEAD")).stdout;
    expect((await base.git(remote.path, "rev-parse", `origin/${defaultBranch}`)).stdout).toBe(
      cached,
    );
    expect(remoteHead).not.toBe(cached);
    return { ...remote, canonicalHead, remoteHead };
  }

  describe.each(["main", "master", "trunk"])("origin/%s", (defaultBranch) => {
    let scenario: Awaited<ReturnType<typeof divergedRepository>>;
    beforeEach(async () => {
      scenario = await divergedRepository(defaultBranch);
    }, 30_000);
    it("bases a new branch on the freshly fetched default, not canonical HEAD or cached refs", async () => {
      const { path, repository, canonicalHead, remoteHead } = scenario;
      await base.git(path, "config", "branch.autoSetupMerge", "always");
      const workspace = await base.manager.createWorkspace({ name: "task" });
      const updated = await base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
        branch: "feat/new-task",
        createBranch: true,
      });
      const cwd = join(updated.absolutePath, "app");
      expect((await base.git(cwd, "rev-parse", "HEAD")).stdout).toBe(remoteHead);
      expect((await base.git(cwd, "branch", "--show-current")).stdout.trim()).toBe("feat/new-task");
      await expect(base.git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).rejects.toThrow();
      expect((await base.git(path, "rev-parse", "HEAD")).stdout).toBe(canonicalHead);
      expect(await readFile(join(path, "draft.txt"), "utf8")).toBe("keep canonical draft\n");
      await expect(access(join(cwd, "canonical-only.txt"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
  });

  describe("branch selection", () => {
    let scenario: Awaited<ReturnType<typeof divergedRepository>>;
    beforeEach(async () => {
      scenario = await divergedRepository("main");
    }, 30_000);

    it("uses the remote default for generated workspace branches too", async () => {
      const { repository, remoteHead } = scenario;
      const workspace = await base.manager.createWorkspace({ name: "generated" });
      const updated = await base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
      });
      expect(updated.members[0]).toMatchObject({ branch: "workspace/generated/app" });
      const cwd = join(updated.absolutePath, "app");
      expect((await base.git(cwd, "rev-parse", "HEAD")).stdout).toBe(remoteHead);
      await expect(base.git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).rejects.toThrow();
    });

    it("reuses an existing local branch without changing its commits or upstream", async () => {
      const { path, repository, canonicalHead } = scenario;
      await base.git(path, "branch", "--no-track", "feat/existing");
      await base.git(path, "branch", "--set-upstream-to=origin/main", "feat/existing");
      const workspace = await base.manager.createWorkspace({ name: "existing" });
      const updated = await base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
        branch: "feat/existing",
        createBranch: true,
      });
      const cwd = join(updated.absolutePath, "app");
      expect((await base.git(cwd, "rev-parse", "HEAD")).stdout).toBe(canonicalHead);
      expect((await base.git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).stdout.trim()).toBe(
        "origin/main",
      );
    });

    it("fetches and tracks a same-name remote branch before considering the default", async () => {
      const { path, repository, canonicalHead } = scenario;
      await base.git(path, "push", "-q", "origin", "HEAD:refs/heads/feat/existing");
      const workspace = await base.manager.createWorkspace({ name: "remote" });
      const updated = await base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
        branch: "feat/existing",
        createBranch: true,
      });
      const cwd = join(updated.absolutePath, "app");
      expect((await base.git(cwd, "rev-parse", "HEAD")).stdout).toBe(canonicalHead);
      expect((await base.git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).stdout.trim()).toBe(
        "origin/feat/existing",
      );
    });

    it("honors an explicit start point without implicitly tracking it", async () => {
      const { path, repository } = scenario;
      await base.git(path, "config", "branch.autoSetupMerge", "always");
      const expected = (await base.git(path, "rev-parse", "origin/main")).stdout;
      const workspace = await base.manager.createWorkspace({ name: "explicit" });
      const updated = await base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
        branch: "feat/explicit",
        createBranch: true,
        startPoint: "origin/main",
      });
      const cwd = join(updated.absolutePath, "app");
      expect((await base.git(cwd, "rev-parse", "HEAD")).stdout).toBe(expected);
      await expect(base.git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).rejects.toThrow();
    });
  });

  describe("origin availability", () => {
    let scenario: Awaited<ReturnType<typeof base.remote>>;
    beforeEach(async () => {
      scenario = await base.remote("app");
    }, 30_000);

    it("retains current-HEAD creation for repositories without origin", async () => {
      const { path, repository } = scenario;
      await base.git(path, "remote", "remove", "origin");
      const expected = (await base.git(path, "rev-parse", "HEAD")).stdout;
      const workspace = await base.manager.createWorkspace({ name: "local" });
      const updated = await base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
        branch: "feat/local",
        createBranch: true,
      });
      const cwd = join(updated.absolutePath, "app");
      expect((await base.git(cwd, "rev-parse", "HEAD")).stdout).toBe(expected);
      await expect(base.git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).rejects.toThrow();
    });

    it.each(["unreachable", "missing-default"])(
      "rejects %s origin rather than silently falling back to HEAD",
      async (failure) => {
        const { path, remotePath, repository } = scenario;
        const head = (await base.git(path, "rev-parse", "HEAD")).stdout;
        await writeFile(join(path, "draft.txt"), "keep draft\n");
        if (failure === "unreachable") {
          await base.git(path, "remote", "set-url", "origin", join(base.sandbox, "missing.git"));
        } else {
          await base.git(remotePath, "symbolic-ref", "HEAD", "refs/heads/missing");
        }
        const workspace = await base.manager.createWorkspace({ name: "failed" });
        await expect(
          base.manager.addWorkspaceMember({
            workspaceId: workspace.id,
            repositoryId: repository.id,
            mode: "worktree",
            branch: "feat/failed",
            createBranch: true,
          }),
        ).rejects.toMatchObject({ code: failure === "unreachable" ? "GIT_FAILED" : "CONFLICT" });
        expect((await base.manager.searchWorkspaces())[0]!.members).toEqual([]);
        await expect(
          base.git(path, "show-ref", "--verify", "refs/heads/feat/failed"),
        ).rejects.toThrow();
        await expect(access(join(path, ".worktrees", "failed"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        await expect(access(join(workspace.absolutePath, "app"))).rejects.toMatchObject({
          code: "ENOENT",
        });
        expect((await base.git(path, "rev-parse", "HEAD")).stdout).toBe(head);
        expect(await readFile(join(path, "draft.txt"), "utf8")).toBe("keep draft\n");
      },
    );
  });
});
