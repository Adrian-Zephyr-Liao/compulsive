import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

const execFileAsync = promisify(execFile);
async function prepareClone(base: Awaited<ReturnType<typeof createWorkspaceFixture>>) {
  const createRemoteRepository = async (name: string, defaultBranch = "master") =>
    (await base.remote(name, defaultBranch)).path;
  const selectedPath = await createRemoteRepository("selected");
  const selectedMainPath = await createRemoteRepository("selected-main", "main");
  const skippedPath = await createRemoteRepository("skipped");
  const additionalPath = await createRemoteRepository("additional");
  await execFileAsync("git", ["-C", selectedPath, "switch", "-q", "-c", "local-only"]);
  await writeFile(join(selectedPath, "local.txt"), "canonical only\n");
  await execFileAsync("git", ["-C", selectedPath, "add", "local.txt"]);
  await execFileAsync("git", ["-C", selectedPath, "commit", "-q", "-m", "local"]);
  await execFileAsync("git", ["-C", selectedPath, "branch", "existing-workspace", "origin/master"]);
  await execFileAsync("git", ["-C", selectedPath, "branch", "rollback-preserved", "origin/master"]);

  const manager = base.manager;
  const selectedRepository = await manager.register({ path: selectedPath });
  const selectedMainRepository = await manager.register({ path: selectedMainPath });
  const skippedRepository = await manager.register({ path: skippedPath });
  const additionalRepository = await manager.register({ path: additionalPath });
  await expect(manager.getRepositoryBranches(selectedRepository.id)).resolves.toEqual(
    expect.arrayContaining([
      { name: "existing-workspace", local: true, remote: false },
      { name: "master", local: true, remote: true },
    ]),
  );
  const source = await manager.createWorkspace({ name: "source" });
  await manager.addWorkspaceMember({
    workspaceId: source.id,
    repositoryId: selectedRepository.id,
  });
  await manager.addWorkspaceMember({
    workspaceId: source.id,
    repositoryId: skippedRepository.id,
  });
  await manager.addWorkspaceMember({
    workspaceId: source.id,
    repositoryId: selectedMainRepository.id,
  });

  return {
    manager,
    selectedPath,
    selectedMainPath,
    selectedRepository,
    selectedMainRepository,
    skippedRepository,
    additionalRepository,
    source,
  };
}

describe("workspace clone selection and rollback", () => {
  let base: Awaited<ReturnType<typeof createWorkspaceFixture>>;
  let scenario: Awaited<ReturnType<typeof prepareClone>>;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepareClone(base);
  }, 30_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);
  it("clones selected source members and other registered repositories from remote defaults", async () => {
    const {
      manager,
      selectedPath,
      selectedMainPath,
      selectedRepository,
      selectedMainRepository,
      skippedRepository,
      additionalRepository,
      source,
    } = scenario;
    await expect(
      manager.cloneWorkspace({
        sourceWorkspaceId: source.id,
        name: "rollback-existing",
        repositoryIds: [selectedRepository.id, additionalRepository.id],
        repositoryBranches: [
          { repositoryId: selectedRepository.id, branch: "rollback-preserved" },
          { repositoryId: additionalRepository.id, branch: "master" },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      execFileAsync("git", [
        "-C",
        selectedPath,
        "show-ref",
        "--verify",
        "refs/heads/rollback-preserved",
      ]),
    ).resolves.toBeDefined();
    await expect(manager.searchWorkspaces({ query: "rollback-existing" })).resolves.toEqual([]);

    const cloned = await manager.cloneWorkspace({
      sourceWorkspaceId: source.id,
      name: "cloned",
      repositoryIds: [selectedRepository.id, selectedMainRepository.id, additionalRepository.id],
      repositoryBranches: [
        { repositoryId: selectedRepository.id, branch: "existing-workspace" },
        { repositoryId: additionalRepository.id, branch: "feat/additional-clone" },
      ],
      referenceRepositoryIds: [selectedMainRepository.id],
    });

    expect(cloned.members).toHaveLength(3);
    expect(cloned.members[0]).toMatchObject({
      repositoryId: selectedRepository.id,
      alias: "selected",
      mode: "worktree",
      branch: "existing-workspace",
    });
    const clonedPath = join(cloned.absolutePath, "selected");
    await expect(readFile(join(clonedPath, "origin.txt"), "utf8")).resolves.toBe(
      "selected remote\n",
    );
    await expect(access(join(clonedPath, "local.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    const [head, remoteMaster, developmentBranch] = await Promise.all([
      execFileAsync("git", ["-C", clonedPath, "rev-parse", "HEAD"]),
      execFileAsync("git", ["-C", selectedPath, "rev-parse", "origin/master"]),
      execFileAsync("git", ["-C", clonedPath, "branch", "--show-current"]),
    ]);
    expect(head.stdout.trim()).toBe(remoteMaster.stdout.trim());
    expect(developmentBranch.stdout.trim()).toBe("existing-workspace");
    const clonedMainPath = join(cloned.absolutePath, "selected-main");
    expect(cloned.members[1]).toMatchObject({
      repositoryId: selectedMainRepository.id,
      branch: "origin/main",
      detached: true,
    });
    const [mainHead, remoteMain, referenceBranch, unexpectedBranch] = await Promise.all([
      execFileAsync("git", ["-C", clonedMainPath, "rev-parse", "HEAD"]),
      execFileAsync("git", ["-C", selectedMainPath, "rev-parse", "origin/main"]),
      execFileAsync("git", ["-C", clonedMainPath, "branch", "--show-current"]),
      execFileAsync("git", ["-C", selectedMainPath, "branch", "--list", "feat/custom-clone"]),
    ]);
    expect(mainHead.stdout.trim()).toBe(remoteMain.stdout.trim());
    expect(referenceBranch.stdout.trim()).toBe("");
    expect(unexpectedBranch.stdout.trim()).toBe("");
    expect(cloned.members[2]).toMatchObject({
      repositoryId: additionalRepository.id,
      alias: "additional",
      branch: "feat/additional-clone",
    });
    await expect(
      readFile(join(cloned.absolutePath, "additional", "origin.txt"), "utf8"),
    ).resolves.toBe("additional remote\n");

    const created = await manager.cloneWorkspace({
      name: "fresh",
      repositoryIds: [skippedRepository.id],
      branchName: "feat/fresh-workspace",
    });
    expect(created.members[0]).toMatchObject({
      repositoryId: skippedRepository.id,
      alias: "skipped",
      branch: "feat/fresh-workspace",
    });

    await expect(
      manager.cloneWorkspace({
        sourceWorkspaceId: source.id,
        name: "cloned",
        repositoryIds: [selectedRepository.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }, 20_000);
});
