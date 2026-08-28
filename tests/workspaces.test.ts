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

  it("repairs a missing managed link and reports an occupied-path conflict", async () => {
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
    await unlink(memberPath);

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

  it("deletes managed links but preserves unrelated workspace files and the directory", async () => {
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
    await expect(readFile(join(workspace.absolutePath, "notes.md"), "utf8")).resolves.toBe(
      "keep this\n",
    );
    await expect(access(join(repositoryPath, ".git"))).resolves.toBeUndefined();
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
});
