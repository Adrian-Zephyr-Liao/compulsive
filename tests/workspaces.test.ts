import { execFile } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositoryManager } from "../src/manager.js";
import { createStoragePaths, readWorkspaceRegistry } from "../src/storage.js";

const execFileAsync = promisify(execFile);

describe("workspace state", () => {
  let sandbox: string;
  let dataDir: string;
  let rootDir: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "compulsive-workspaces-"));
    dataDir = join(sandbox, "app-data");
    rootDir = join(sandbox, "Code");
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("derives a sibling workspace root and initializes an empty registry", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });

    const config = await manager.initialize();
    const paths = createStoragePaths(dataDir);

    expect(config.workspaceRoot).toBe(join(dirname(rootDir), "Workspaces"));
    await expect(readWorkspaceRegistry(paths.workspaces)).resolves.toEqual({
      schemaVersion: 1,
      workspaces: [],
    });
  });

  it("accepts legacy schema-v1 config and persists the derived root on the next write", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "config.json"),
      `${JSON.stringify({ schemaVersion: 1, rootDir, scanRoots: [] })}\n`,
    );
    await writeFile(
      join(dataDir, "repositories.json"),
      `${JSON.stringify({ schemaVersion: 1, repositories: [] })}\n`,
    );
    const manager = createRepositoryManager({ dataDir, defaultRootDir: join(sandbox, "ignored") });

    const initialized = await manager.initialize();

    expect(initialized.workspaceRoot).toBe(join(dirname(rootDir), "Workspaces"));
    expect(JSON.parse(await readFile(join(dataDir, "config.json"), "utf8"))).not.toHaveProperty(
      "workspaceRoot",
    );

    const updated = await manager.updateConfig({});

    expect(updated.workspaceRoot).toBe(join(dirname(rootDir), "Workspaces"));
    expect(JSON.parse(await readFile(join(dataDir, "config.json"), "utf8"))).toHaveProperty(
      "workspaceRoot",
      join(dirname(rootDir), "Workspaces"),
    );
  });

  it("rejects a malformed workspace registry", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const paths = createStoragePaths(dataDir);
    await writeFile(paths.workspaces, '{"schemaVersion":1,"workspaces":[{"id":false}]}');

    await expect(readWorkspaceRegistry(paths.workspaces)).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
    });
  });

  it("rejects duplicate workspace identifiers in persisted state", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const paths = createStoragePaths(dataDir);
    const now = new Date().toISOString();
    await writeFile(
      paths.workspaces,
      JSON.stringify({
        schemaVersion: 1,
        workspaces: [
          {
            id: "workspace:duplicate",
            name: "First",
            absolutePath: join(sandbox, "First"),
            members: [],
            createdAt: now,
            updatedAt: now,
          },
          {
            id: "workspace:duplicate",
            name: "Second",
            absolutePath: join(sandbox, "Second"),
            members: [],
            createdAt: now,
            updatedAt: now,
          },
        ],
      }),
    );

    await expect(readWorkspaceRegistry(paths.workspaces)).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
    });
  });

  it("rejects a non-string workspace root in persisted configuration", async () => {
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, "config.json"),
      `${JSON.stringify({ schemaVersion: 1, rootDir, workspaceRoot: 42, scanRoots: [] })}\n`,
    );
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });

    await expect(manager.getConfig()).rejects.toMatchObject({ code: "FILESYSTEM_FAILED" });
  });

  it("creates a workspace under the configured root and searches it by name", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    const config = await manager.initialize();

    const workspace = await manager.createWorkspace({ name: "Client Apps" });

    expect(workspace).toMatchObject({
      name: "Client Apps",
      absolutePath: await realpath(join(config.workspaceRoot, "Client Apps")),
      members: [],
    });
    await expect(manager.searchWorkspaces({ query: "client" })).resolves.toEqual([workspace]);
  });

  it("rejects duplicate names and paths without removing existing directories", async () => {
    const customPath = join(sandbox, "custom workspace");
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.createWorkspace({ name: "Frontend", path: customPath });

    await expect(manager.createWorkspace({ name: "FRONTEND" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(
      manager.createWorkspace({ name: "Another", path: customPath }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(access(customPath)).resolves.toBeUndefined();
  });

  it("rejects workspace names that are unsafe path segments", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    await expect(manager.createWorkspace({ name: "../escape" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("links one repository into multiple workspaces without duplicating its checkout", async () => {
    const repositoryPath = join(sandbox, "repositories", "shared app");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await writeFile(join(repositoryPath, "shared.txt"), "canonical\n");
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const first = await manager.createWorkspace({ name: "Frontend" });
    const second = await manager.createWorkspace({ name: "Platform" });

    const firstUpdated = await manager.addWorkspaceMember({
      workspaceId: first.id,
      repositoryId: repository.id,
    });
    const secondUpdated = await manager.addWorkspaceMember({
      workspaceId: second.id,
      repositoryId: repository.id,
      alias: "shared-service",
    });

    const firstLink = join(first.absolutePath, repository.name);
    const secondLink = join(second.absolutePath, "shared-service");
    expect((await lstat(firstLink)).isSymbolicLink()).toBe(true);
    expect(await readlink(firstLink)).toBe(await realpath(repositoryPath));
    expect(await readFile(join(secondLink, "shared.txt"), "utf8")).toBe("canonical\n");
    expect(firstUpdated.members).toEqual([
      { repositoryId: repository.id, alias: repository.name, mode: "link" },
    ]);
    expect(secondUpdated.members).toEqual([
      { repositoryId: repository.id, alias: "shared-service", mode: "link" },
    ]);
  });

  it("refuses duplicate membership, unsafe aliases, and occupied member paths", async () => {
    const repositoryPath = join(sandbox, "repositories", "api");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Suite" });
    await writeFile(join(workspace.absolutePath, "occupied"), "keep\n");

    await expect(
      manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        alias: "../escape",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        alias: "occupied",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    await expect(
      manager.addWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
        alias: "again",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(readFile(join(workspace.absolutePath, "occupied"), "utf8")).resolves.toBe(
      "keep\n",
    );
  });

  it("repairs a missing workspace directory and reports an occupied-path conflict", async () => {
    const repositoryPath = join(sandbox, "repositories", "repair-me");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Repair" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    const memberPath = join(workspace.absolutePath, repository.name);
    await rm(workspace.absolutePath, { recursive: true });

    const repaired = await manager.syncWorkspace(workspace.id);

    expect(repaired.repaired).toEqual([repository.id]);
    expect(repaired.issues).toEqual([]);
    await unlink(memberPath);
    await writeFile(memberPath, "user file\n");

    const conflicted = await manager.syncWorkspace(workspace.id);

    expect(conflicted.repaired).toEqual([]);
    expect(conflicted.issues).toHaveLength(1);
    await expect(readFile(memberPath, "utf8")).resolves.toBe("user file\n");
  });

  it("removes an exact link member while preserving the canonical repository", async () => {
    const repositoryPath = join(sandbox, "repositories", "keep-canonical");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Disposable Link" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });

    const updated = await manager.removeWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });

    expect(updated.members).toEqual([]);
    await expect(access(join(workspace.absolutePath, repository.name))).rejects.toThrow();
    await expect(access(join(repositoryPath, ".git"))).resolves.toBeUndefined();
  });

  it("deletes the workspace directory while preserving the canonical repository", async () => {
    const repositoryPath = join(sandbox, "repositories", "preserved");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "With Notes" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    await writeFile(join(workspace.absolutePath, "notes.md"), "keep this\n");

    await manager.deleteWorkspace(workspace.id);

    await expect(manager.searchWorkspaces()).resolves.toEqual([]);
    await expect(access(workspace.absolutePath)).rejects.toThrow();
    await expect(access(join(repositoryPath, ".git"))).resolves.toBeUndefined();
  });

  it("refuses to delete a workspace that contains another registered workspace", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const parent = await manager.createWorkspace({ name: "Parent" });
    const child = await manager.createWorkspace({
      name: "Child",
      path: join(parent.absolutePath, "child"),
    });

    await expect(manager.deleteWorkspace(parent.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(access(child.absolutePath)).resolves.toBeUndefined();
    await expect(manager.searchWorkspaces()).resolves.toHaveLength(2);
  });

  it("refuses to remove an unexpected link and preserves workspace metadata", async () => {
    const repositoryPath = join(sandbox, "repositories", "expected");
    const otherPath = join(sandbox, "repositories", "unexpected");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await execFileAsync("git", ["init", "-q", otherPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Protected" });
    const updated = await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    const memberPath = join(workspace.absolutePath, repository.name);
    await unlink(memberPath);
    await symlink(await realpath(otherPath), memberPath);

    await expect(
      manager.removeWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    expect(await realpath(memberPath)).toBe(await realpath(otherPath));
    await expect(manager.searchWorkspaces({ query: workspace.name })).resolves.toEqual([updated]);
  });

  it("creates independent worktree members on existing branches", async () => {
    const repositoryPath = join(sandbox, "repositories", "branching");
    await execFileAsync("git", ["init", "-q", "-b", "main", repositoryPath]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
    await writeFile(join(repositoryPath, "README.md"), "initial\n");
    await execFileAsync("git", ["-C", repositoryPath, "add", "README.md"]);
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "initial"]);
    await execFileAsync("git", ["-C", repositoryPath, "branch", "feature/one"]);
    await execFileAsync("git", ["-C", repositoryPath, "branch", "feature/two"]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const first = await manager.createWorkspace({ name: "First Branch" });
    const second = await manager.createWorkspace({ name: "Second Branch" });

    const firstUpdated = await manager.addWorkspaceMember({
      workspaceId: first.id,
      repositoryId: repository.id,
      alias: "app",
      mode: "worktree",
      branch: "feature/one",
    });
    const secondUpdated = await manager.addWorkspaceMember({
      workspaceId: second.id,
      repositoryId: repository.id,
      alias: "app",
      mode: "worktree",
      branch: "feature/two",
    });

    expect(firstUpdated.members[0]).toMatchObject({ mode: "worktree", branch: "feature/one" });
    expect(secondUpdated.members[0]).toMatchObject({ mode: "worktree", branch: "feature/two" });
    const firstWorktree = join(repositoryPath, ".worktrees", first.name);
    const secondWorktree = join(repositoryPath, ".worktrees", second.name);
    expect(firstUpdated.members[0]).toMatchObject({ worktreePath: await realpath(firstWorktree) });
    expect(secondUpdated.members[0]).toMatchObject({
      worktreePath: await realpath(secondWorktree),
    });
    expect((await lstat(join(first.absolutePath, "app"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(first.absolutePath, "app"))).toBe(await realpath(firstWorktree));
    expect((await lstat(join(second.absolutePath, "app"))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(second.absolutePath, "app"))).toBe(await realpath(secondWorktree));
    expect(
      (
        await execFileAsync("git", [
          "-C",
          join(first.absolutePath, "app"),
          "branch",
          "--show-current",
        ])
      ).stdout.trim(),
    ).toBe("feature/one");
    expect(
      (
        await execFileAsync("git", [
          "-C",
          join(second.absolutePath, "app"),
          "branch",
          "--show-current",
        ])
      ).stdout.trim(),
    ).toBe("feature/two");
    expect(
      (await execFileAsync("git", ["-C", repositoryPath, "status", "--porcelain"])).stdout,
    ).toBe("");
    expect(await readFile(join(repositoryPath, ".git", "info", "exclude"), "utf8")).toContain(
      "/.worktrees/",
    );
  });

  it("tracks an existing remote branch when explicitly creating a worktree branch", async () => {
    const remotePath = join(sandbox, "remote.git");
    const repositoryPath = join(sandbox, "repositories", "new-branch");
    await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", remotePath]);
    await execFileAsync("git", ["clone", "-q", `file://${remotePath}`, repositoryPath]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
    await writeFile(join(repositoryPath, "README.md"), "initial\n");
    await execFileAsync("git", ["-C", repositoryPath, "add", "README.md"]);
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "initial"]);
    await execFileAsync("git", ["-C", repositoryPath, "push", "-q", "-u", "origin", "main"]);
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "push",
      "-q",
      "origin",
      "main:refs/heads/feature/exact-name",
    ]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Exact Branch" });

    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      mode: "worktree",
      branch: "feature/exact-name",
      createBranch: true,
    });

    expect(
      (
        await execFileAsync("git", [
          "-C",
          repositoryPath,
          "show-ref",
          "--verify",
          "refs/heads/feature/exact-name",
        ])
      ).stdout,
    ).not.toBe("");
    expect(
      (
        await execFileAsync("git", [
          "-C",
          join(workspace.absolutePath, repository.name),
          "for-each-ref",
          "--format=%(upstream:short)",
          "refs/heads/feature/exact-name",
        ])
      ).stdout.trim(),
    ).toBe("origin/feature/exact-name");
  });

  it("syncs development and dirty reference branches while preserving rebase conflicts", async () => {
    async function createRemoteRepository(name: string) {
      const remotePath = join(sandbox, `${name}.git`);
      const repositoryPath = join(sandbox, "repositories", name);
      await execFileAsync("git", ["init", "-q", "--bare", "-b", "main", remotePath]);
      await execFileAsync("git", ["clone", "-q", `file://${remotePath}`, repositoryPath]);
      await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
      await execFileAsync("git", [
        "-C",
        repositoryPath,
        "config",
        "user.email",
        "test@example.com",
      ]);
      await writeFile(join(repositoryPath, "README.md"), "initial\n");
      await execFileAsync("git", ["-C", repositoryPath, "add", "README.md"]);
      await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "initial"]);
      await execFileAsync("git", ["-C", repositoryPath, "push", "-q", "-u", "origin", "main"]);
      return repositoryPath;
    }

    const developmentPath = await createRemoteRepository("development");
    const referencePath = await createRemoteRepository("reference");
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const development = await manager.register({ path: developmentPath });
    const reference = await manager.register({ path: referencePath });
    const workspace = await manager.createWorkspace({ name: "Batch Sync" });
    const withDevelopment = await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: development.id,
      mode: "worktree",
      branch: "feature/batch-sync",
      createBranch: true,
    });
    const withReference = await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: reference.id,
      mode: "worktree",
      startPoint: "origin/main",
      detached: true,
    });
    const developmentMember = withDevelopment.members[0]!;
    const referenceMember = withReference.members[1]!;
    if (developmentMember.mode !== "worktree" || referenceMember.mode !== "worktree") {
      throw new Error("Expected managed worktrees.");
    }
    const developmentWorktree = developmentMember.worktreePath;
    const referenceWorktree = referenceMember.worktreePath;

    await execFileAsync("git", [
      "-C",
      developmentWorktree,
      "push",
      "-q",
      "-u",
      "origin",
      "feature/batch-sync",
    ]);
    const emptyBranchStatus = await manager.getWorkspaceStatus(workspace.id, true);
    expect(
      emptyBranchStatus.members.find((status) => status.repositoryId === development.id),
    ).toMatchObject({ mergedIntoDefault: false });

    await writeFile(join(developmentWorktree, "feature.txt"), "feature\n");
    await execFileAsync("git", ["-C", developmentWorktree, "add", "feature.txt"]);
    await execFileAsync("git", ["-C", developmentWorktree, "commit", "-q", "-m", "feature"]);
    await writeFile(join(developmentPath, "main.txt"), "main\n");
    await execFileAsync("git", ["-C", developmentPath, "add", "main.txt"]);
    await execFileAsync("git", ["-C", developmentPath, "commit", "-q", "-m", "main update"]);
    await execFileAsync("git", ["-C", developmentPath, "push", "-q", "origin", "main"]);
    await writeFile(join(referencePath, "reference.txt"), "reference\n");
    await execFileAsync("git", ["-C", referencePath, "add", "reference.txt"]);
    await execFileAsync("git", ["-C", referencePath, "commit", "-q", "-m", "reference update"]);
    await execFileAsync("git", ["-C", referencePath, "push", "-q", "origin", "main"]);

    const synced = await manager.syncWorkspaceBranches(workspace.id);

    expect(synced.items).toEqual([
      expect.objectContaining({ repositoryId: development.id, outcome: "synced" }),
      expect.objectContaining({ repositoryId: reference.id, outcome: "synced" }),
    ]);
    await expect(readFile(join(developmentWorktree, "main.txt"), "utf8")).resolves.toBe("main\n");
    await expect(readFile(join(referenceWorktree, "reference.txt"), "utf8")).resolves.toBe(
      "reference\n",
    );
    await expect(
      execFileAsync("git", ["-C", referenceWorktree, "branch", "--show-current"]),
    ).resolves.toMatchObject({ stdout: "" });
    const [localFeature, remoteFeature] = await Promise.all([
      execFileAsync("git", ["-C", developmentWorktree, "rev-parse", "HEAD"]),
      execFileAsync("git", [
        "-C",
        developmentPath,
        "ls-remote",
        "origin",
        "refs/heads/feature/batch-sync",
      ]),
    ]);
    expect(remoteFeature.stdout.split("\t")[0]).toBe(localFeature.stdout.trim());

    await writeFile(join(developmentWorktree, "shared.txt"), "feature\n");
    await execFileAsync("git", ["-C", developmentWorktree, "add", "shared.txt"]);
    await execFileAsync("git", [
      "-C",
      developmentWorktree,
      "commit",
      "-q",
      "-m",
      "feature conflict",
    ]);
    await writeFile(join(developmentPath, "shared.txt"), "main\n");
    await execFileAsync("git", ["-C", developmentPath, "add", "shared.txt"]);
    await execFileAsync("git", ["-C", developmentPath, "commit", "-q", "-m", "main conflict"]);
    await execFileAsync("git", ["-C", developmentPath, "push", "-q", "origin", "main"]);
    await writeFile(join(referenceWorktree, "local-draft.txt"), "keep\n");

    const conflicted = await manager.syncWorkspaceBranches(workspace.id);

    expect(conflicted.items[0]).toMatchObject({
      repositoryId: development.id,
      outcome: "conflict",
    });
    expect(conflicted.items[1]).toMatchObject({
      repositoryId: reference.id,
      outcome: "synced",
      backup: { restored: true },
    });
    await expect(readFile(join(referenceWorktree, "local-draft.txt"), "utf8")).resolves.toBe(
      "keep\n",
    );
    await expect(
      execFileAsync("git", ["-C", developmentWorktree, "diff", "--name-only", "--diff-filter=U"]),
    ).resolves.toMatchObject({ stdout: "shared.txt\n" });
  }, 30_000);

  it("validates clone workspace selection before creating a target", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const source = await manager.createWorkspace({ name: "source" });

    await expect(
      manager.cloneWorkspace({ sourceWorkspaceId: source.id, name: "empty", repositoryIds: [] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(manager.searchWorkspaces({ query: "empty" })).resolves.toEqual([]);

    const foreignPath = join(sandbox, "repositories", "foreign");
    await execFileAsync("git", ["init", "-q", foreignPath]);
    const foreign = await manager.register({ path: foreignPath });
    await expect(
      manager.cloneWorkspace({
        sourceWorkspaceId: source.id,
        name: "duplicate-branches",
        repositoryIds: [foreign.id],
        repositoryBranches: [
          { repositoryId: foreign.id, branch: "feat/one" },
          { repositoryId: foreign.id, branch: "feat/two" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(manager.searchWorkspaces({ query: "duplicate-branches" })).resolves.toEqual([]);

    await expect(
      manager.cloneWorkspace({
        sourceWorkspaceId: source.id,
        name: "foreign",
        repositoryIds: [foreign.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(manager.searchWorkspaces({ query: "foreign" })).resolves.toEqual([]);
  });

  it("rejects overlapping legacy worktrees before moving either path", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repositories = [];
    for (const name of ["parent-repository", "child-repository"]) {
      const repositoryPath = join(sandbox, "repositories", name);
      await execFileAsync("git", ["init", "-q", "-b", "main", repositoryPath]);
      await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
      await execFileAsync("git", [
        "-C",
        repositoryPath,
        "config",
        "user.email",
        "test@example.com",
      ]);
      await execFileAsync("git", [
        "-C",
        repositoryPath,
        "commit",
        "--allow-empty",
        "-q",
        "-m",
        "initial",
      ]);
      await execFileAsync("git", ["-C", repositoryPath, "branch", "legacy"]);
      repositories.push(await manager.register({ path: repositoryPath }));
    }
    const parent = await manager.createWorkspace({ name: "Parent" });
    const parentPath = join(parent.absolutePath, repositories[0]!.name);
    await execFileAsync("git", [
      "-C",
      repositories[0]!.absolutePath,
      "worktree",
      "add",
      "-q",
      parentPath,
      "legacy",
    ]);
    const child = await manager.createWorkspace({
      name: "Child",
      path: join(parentPath, "nested"),
    });
    const childPath = join(child.absolutePath, repositories[1]!.name);
    await execFileAsync("git", [
      "-C",
      repositories[1]!.absolutePath,
      "worktree",
      "add",
      "-q",
      childPath,
      "legacy",
    ]);
    const paths = createStoragePaths(dataDir);
    const registry = await readWorkspaceRegistry(paths.workspaces);
    for (const [index, workspace] of [parent, child].entries()) {
      registry.workspaces.find((item) => item.id === workspace.id)!.members = [
        {
          repositoryId: repositories[index]!.id,
          alias: repositories[index]!.name,
          mode: "worktree",
          branch: "legacy",
          worktreePath: index === 0 ? parentPath : childPath,
        },
      ];
    }
    await writeFile(paths.workspaces, `${JSON.stringify(registry, undefined, 2)}\n`);

    await expect(manager.migrateWorkspaces()).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await lstat(parentPath)).isDirectory()).toBe(true);
    expect((await lstat(childPath)).isDirectory()).toBe(true);
  });

  it("surfaces a conflict when a branch is already checked out elsewhere", async () => {
    const repositoryPath = join(sandbox, "repositories", "branch-conflict");
    await execFileAsync("git", ["init", "-q", "-b", "main", repositoryPath]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
    await writeFile(join(repositoryPath, "README.md"), "initial\n");
    await execFileAsync("git", ["-C", repositoryPath, "add", "README.md"]);
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "initial"]);
    await execFileAsync("git", ["-C", repositoryPath, "branch", "shared"]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const first = await manager.createWorkspace({ name: "Uses Shared" });
    const second = await manager.createWorkspace({ name: "Also Shared" });
    await manager.addWorkspaceMember({
      workspaceId: first.id,
      repositoryId: repository.id,
      mode: "worktree",
      branch: "shared",
    });

    await expect(
      manager.addWorkspaceMember({
        workspaceId: second.id,
        repositoryId: repository.id,
        mode: "worktree",
        branch: "shared",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(manager.searchWorkspaces({ query: second.name })).resolves.toMatchObject([
      { members: [] },
    ]);
  });

  it("refuses dirty worktree removal and deletion, then deletes it when clean", async () => {
    const repositoryPath = join(sandbox, "repositories", "dirty-guard");
    await execFileAsync("git", ["init", "-q", "-b", "main", repositoryPath]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
    await writeFile(join(repositoryPath, "README.md"), "initial\n");
    await execFileAsync("git", ["-C", repositoryPath, "add", "README.md"]);
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "initial"]);
    await execFileAsync("git", ["-C", repositoryPath, "branch", "workspace-branch"]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Dirty Guard" });
    const updated = await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      mode: "worktree",
      branch: "workspace-branch",
    });
    const worktreePath = join(workspace.absolutePath, repository.name);
    await writeFile(join(worktreePath, "uncommitted.txt"), "do not lose\n");

    await expect(
      manager.removeWorkspaceMember({
        workspaceId: workspace.id,
        repositoryId: repository.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(manager.deleteWorkspace(workspace.id)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(readFile(join(worktreePath, "uncommitted.txt"), "utf8")).resolves.toBe(
      "do not lose\n",
    );
    await expect(manager.searchWorkspaces({ query: workspace.name })).resolves.toEqual([updated]);
    await manager.getWorkspaceStatus(workspace.id);
    await expect(manager.getWorkspaceStatuses()).resolves.toHaveLength(1);

    await unlink(join(worktreePath, "uncommitted.txt"));
    await manager.deleteWorkspace(workspace.id);

    await expect(access(worktreePath)).rejects.toThrow();
    await expect(access(join(repositoryPath, ".git"))).resolves.toBeUndefined();
    await expect(manager.getWorkspaceStatuses()).resolves.toEqual([]);
  });

  it("reports unresolved files for manual conflict handling", async () => {
    const repositoryPath = join(sandbox, "repositories", "conflicted");
    await execFileAsync("git", ["init", "-q", "-b", "main", repositoryPath]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
    await writeFile(join(repositoryPath, "shared.txt"), "base\n");
    await execFileAsync("git", ["-C", repositoryPath, "add", "shared.txt"]);
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "base"]);
    await execFileAsync("git", ["-C", repositoryPath, "branch", "development"]);
    await writeFile(join(repositoryPath, "shared.txt"), "main\n");
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-am", "main"]);

    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Conflict Status" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      mode: "worktree",
      branch: "development",
    });
    const worktreePath = join(workspace.absolutePath, repository.name);
    await writeFile(join(worktreePath, "shared.txt"), "development\n");
    await execFileAsync("git", ["-C", worktreePath, "commit", "-q", "-am", "development"]);
    await execFileAsync("git", ["-C", worktreePath, "merge", "main"]).catch(() => undefined);

    const status = await manager.getWorkspaceStatus(workspace.id);

    expect(status.members[0]).toMatchObject({
      branch: "development",
      conflicts: ["shared.txt"],
      changes: ["UU shared.txt"],
    });
    const reloadedManager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await expect(reloadedManager.getWorkspaceStatuses()).resolves.toEqual([status]);
  });

  it("repairs a missing worktree link during an in-progress rebase", async () => {
    const repositoryPath = join(sandbox, "repositories", "rebasing");
    await execFileAsync("git", ["init", "-q", "-b", "main", repositoryPath]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
    await writeFile(join(repositoryPath, "shared.txt"), "base\n");
    await execFileAsync("git", ["-C", repositoryPath, "add", "shared.txt"]);
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "base"]);
    await execFileAsync("git", ["-C", repositoryPath, "branch", "development"]);

    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Rebase Link" });
    const updated = await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      mode: "worktree",
      branch: "development",
    });
    const member = updated.members[0]!;
    if (member.mode !== "worktree") throw new Error("Expected a managed worktree.");
    await writeFile(join(member.worktreePath, "shared.txt"), "development\n");
    await execFileAsync("git", ["-C", member.worktreePath, "commit", "-q", "-am", "development"]);
    await writeFile(join(repositoryPath, "shared.txt"), "main\n");
    await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-am", "main"]);
    await execFileAsync("git", ["-C", member.worktreePath, "rebase", "main"]).catch(
      () => undefined,
    );
    const memberPath = join(workspace.absolutePath, member.alias);
    await unlink(memberPath);

    const result = await manager.syncWorkspace(workspace.id);

    expect(result).toMatchObject({ repaired: [repository.id], issues: [] });
    expect((await lstat(memberPath)).isSymbolicLink()).toBe(true);
    expect(await realpath(memberPath)).toBe(await realpath(member.worktreePath));
    await expect(
      execFileAsync("git", ["-C", member.worktreePath, "diff", "--name-only", "--diff-filter=U"]),
    ).resolves.toMatchObject({ stdout: "shared.txt\n" });
    await expect(
      execFileAsync("git", ["-C", member.worktreePath, "status"]),
    ).resolves.toMatchObject({ stdout: expect.stringContaining("rebase in progress") });
  });

  it("repairs link members after organizing the canonical repository", async () => {
    const repositoryPath = join(sandbox, "legacy", "linked-before-move");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Move Aware" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    const memberPath = join(workspace.absolutePath, repository.name);

    const organized = await manager.organize(await manager.planOrganize(repository.id));

    expect(await realpath(memberPath)).toBe(organized.absolutePath);
    expect(await readlink(memberPath)).toBe(organized.absolutePath);
  });

  it("keeps an organized repository when a workspace link path has a conflict", async () => {
    const repositoryPath = join(sandbox, "legacy", "conflicted-link");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Conflict After Move" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    const memberPath = join(workspace.absolutePath, repository.name);
    await unlink(memberPath);
    await writeFile(memberPath, "do not overwrite\n");
    const plan = await manager.planOrganize(repository.id);

    await expect(manager.organize(plan)).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(access(plan.source)).rejects.toThrow();
    await expect(access(join(plan.target, ".git"))).resolves.toBeUndefined();
    await expect(readFile(memberPath, "utf8")).resolves.toBe("do not overwrite\n");
    await expect(manager.search({ query: repository.name })).resolves.toMatchObject([
      { absolutePath: await realpath(plan.target) },
    ]);
  });
});
