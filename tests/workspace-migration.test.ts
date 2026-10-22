import { execFile } from "node:child_process";
import { lstat, readFile, readlink, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createStoragePaths, readWorkspaceRegistry } from "../src/storage.js";
import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

const execFileAsync = promisify(execFile);
async function prepareMigration(base: Awaited<ReturnType<typeof createWorkspaceFixture>>) {
  const { sandbox, dataDir, manager } = base;
  const remotePath = join(sandbox, "legacy-remote.git");
  const submodulePath = join(sandbox, "submodule");
  const repositoryPath = join(sandbox, "repositories", "legacy-worktree");
  await execFileAsync("git", ["init", "-q", "-b", "main", submodulePath]);
  await execFileAsync("git", ["-C", submodulePath, "config", "user.name", "Compulsive Test"]);
  await execFileAsync("git", ["-C", submodulePath, "config", "user.email", "test@example.com"]);
  await writeFile(join(submodulePath, "module.txt"), "module\n");
  await execFileAsync("git", ["-C", submodulePath, "add", "module.txt"]);
  await execFileAsync("git", ["-C", submodulePath, "commit", "-q", "-m", "module"]);
  await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", remotePath]);
  await execFileAsync("git", ["clone", "-q", `file://${remotePath}`, repositoryPath]);
  await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
  await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
  await writeFile(join(repositoryPath, "README.md"), "initial\n");
  await execFileAsync("git", ["-C", repositoryPath, "add", "README.md"]);
  await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "initial"]);
  await execFileAsync("git", [
    "-c",
    "protocol.file.allow=always",
    "-C",
    repositoryPath,
    "submodule",
    "add",
    "-q",
    `file://${submodulePath}`,
    "vendor/submodule",
  ]);
  await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-am", "submodule"]);
  await execFileAsync("git", ["-C", repositoryPath, "push", "-q", "-u", "origin", "main"]);
  await execFileAsync("git", ["-C", repositoryPath, "branch", "legacy-branch"]);
  const repository = await manager.register({ path: repositoryPath });
  const workspace = await manager.createWorkspace({ name: "Legacy" });
  const legacyPath = join(workspace.absolutePath, repository.name);
  await execFileAsync("git", [
    "-C",
    repositoryPath,
    "worktree",
    "add",
    "-q",
    legacyPath,
    "legacy-branch",
  ]);
  await execFileAsync("git", [
    "-c",
    "protocol.file.allow=always",
    "-C",
    legacyPath,
    "submodule",
    "update",
    "--init",
    "-q",
  ]);
  await writeFile(join(legacyPath, "README.md"), "dirty\n");
  await writeFile(join(legacyPath, "untracked.txt"), "keep\n");
  const before = (await execFileAsync("git", ["-C", legacyPath, "status", "--porcelain"])).stdout;
  const paths = createStoragePaths(dataDir);
  const registry = await readWorkspaceRegistry(paths.workspaces);
  registry.workspaces[0]!.members = [
    {
      repositoryId: repository.id,
      alias: repository.name,
      mode: "worktree",
      branch: "legacy-branch",
      worktreePath: legacyPath,
    },
  ];
  await writeFile(paths.workspaces, `${JSON.stringify(registry, undefined, 2)}\n`);

  return { manager, repositoryPath, workspace, legacyPath, before, paths };
}

describe("legacy worktree migration with submodules", () => {
  let base: Awaited<ReturnType<typeof createWorkspaceFixture>>;
  let scenario: Awaited<ReturnType<typeof prepareMigration>>;
  beforeEach(async () => {
    base = await createWorkspaceFixture();
    scenario = await prepareMigration(base);
  }, 30_000);
  afterEach(async () => {
    await base?.dispose();
  }, 20_000);
  it("migrates a dirty legacy worktree into the canonical repository and leaves a link", async () => {
    const { manager, repositoryPath, workspace, legacyPath, before, paths } = scenario;
    const result = await manager.migrateWorkspaces();

    const target = join(repositoryPath, ".worktrees", workspace.name);
    expect(result.migrated).toBe(1);
    expect((await lstat(legacyPath)).isSymbolicLink()).toBe(true);
    expect(await readlink(legacyPath)).toBe(await realpath(target));
    expect((await execFileAsync("git", ["-C", target, "status", "--porcelain"])).stdout).toBe(
      before,
    );
    expect(await readFile(join(target, "untracked.txt"), "utf8")).toBe("keep\n");
    expect(
      (
        await execFileAsync("git", [
          "-C",
          target,
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ])
      ).stdout.trim(),
    ).toBe("origin/main");
    await expect(readWorkspaceRegistry(paths.workspaces)).resolves.toMatchObject({
      workspaces: [{ members: [{ worktreePath: await realpath(target) }] }],
    });
  });
});
