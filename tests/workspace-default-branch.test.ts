import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

describe("default-branch development", () => {
  let base: Awaited<ReturnType<typeof createWorkspaceFixture>>;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
  });
  afterEach(async () => {
    await base?.dispose();
  });

  it.each(["main", "master", "trunk"])(
    "adds the actual origin default %s without a task branch",
    async (branch) => {
      const { path, repository } = await base.remote("default", branch);
      await base.git(path, "switch", "-c", "canonical-work");
      await base.git(path, "branch", "-D", branch);
      await writeFile(join(path, "draft.txt"), "keep canonical draft\n");
      const workspace = await base.manager.createWorkspace({ name: "task" });
      const updated = await base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
        useDefaultBranch: true,
      });
      const member = updated.members[0]!;
      expect(member).toMatchObject({ mode: "worktree", branch });
      expect(member).not.toHaveProperty("detached");
      const cwd = join(updated.absolutePath, member.alias);
      expect((await base.git(cwd, "branch", "--show-current")).stdout.trim()).toBe(branch);
      expect((await base.git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}")).stdout.trim()).toBe(
        `origin/${branch}`,
      );
      expect((await base.git(cwd, "branch", "--list", "workspace/*")).stdout.trim()).toBe("");
      expect((await base.git(path, "branch", "--show-current")).stdout.trim()).toBe(
        "canonical-work",
      );
      expect(await readFile(join(path, "draft.txt"), "utf8")).toBe("keep canonical draft\n");
    },
  );

  it("clones mixed default, independent and reference repositories", async () => {
    const primary = await base.remote("primary", "master");
    const custom = await base.remote("custom");
    const reference = await base.remote("reference");
    await base.git(primary.path, "switch", "-c", "canonical-work");
    const source = await base.manager.createWorkspace({ name: "source" });
    await base.manager.addWorkspaceMember({
      workspaceId: source.id,
      repositoryId: primary.repository.id,
    });
    const cloned = await base.manager.cloneWorkspace({
      sourceWorkspaceId: source.id,
      name: "cloned",
      repositoryIds: [primary.repository.id, custom.repository.id, reference.repository.id],
      defaultBranchRepositoryIds: [primary.repository.id],
      repositoryBranches: [{ repositoryId: custom.repository.id, branch: "feat/custom" }],
      referenceRepositoryIds: [reference.repository.id],
    });
    expect(cloned.members).toEqual([
      expect.objectContaining({ branch: "master", mode: "worktree" }),
      expect.objectContaining({ branch: "feat/custom", mode: "worktree" }),
      expect.objectContaining({ branch: "origin/main", detached: true }),
    ]);
    expect(cloned.members[0]).not.toHaveProperty("detached");
    expect(
      (await base.git(primary.path, "branch", "--list", "workspace/cloned*")).stdout.trim(),
    ).toBe("");
  }, 15000);

  it("does not force an occupied default branch or leave a partial clone", async () => {
    const { path, repository } = await base.remote("occupied");
    const before = (await base.git(path, "rev-parse", "HEAD")).stdout;
    await expect(
      base.manager.cloneWorkspace({
        name: "blocked",
        repositoryIds: [repository.id],
        defaultBranchRepositoryIds: [repository.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await base.git(path, "rev-parse", "HEAD")).stdout).toBe(before);
    expect((await base.git(path, "branch", "--show-current")).stdout.trim()).toBe("main");
    expect(await base.manager.searchWorkspaces({ query: "blocked" })).toEqual([]);
    await expect(
      access(join((await base.manager.getConfig()).workspaceRoot, "blocked")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects contradictory default-branch choices before creating members", async () => {
    const { repository } = await base.remote("validation");
    const workspace = await base.manager.createWorkspace({ name: "task" });
    await expect(
      base.manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        mode: "worktree",
        useDefaultBranch: true,
        branch: "feat/wrong",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const selection of [
      { defaultBranchRepositoryIds: [repository.id, repository.id] },
      { defaultBranchRepositoryIds: [repository.id], referenceRepositoryIds: [repository.id] },
      {
        defaultBranchRepositoryIds: [repository.id],
        repositoryBranches: [{ repositoryId: repository.id, branch: "feat/wrong" }],
      },
    ]) {
      await expect(
        base.manager.cloneWorkspace({
          name: "invalid",
          repositoryIds: [repository.id],
          ...selection,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect((await base.manager.searchWorkspaces())[0]!.members).toEqual([]);
    expect(await base.manager.searchWorkspaces({ query: "invalid" })).toEqual([]);
  });
});
