import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositoryManager } from "../src/manager.js";
import { createStoragePaths, readWorkspaceRegistry } from "../src/storage.js";

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
});
