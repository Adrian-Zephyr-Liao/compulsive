import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createRepositoryManager } from "../src/manager.js";
import { parseGitRemote } from "../src/git-url.js";

const execFileAsync = promisify(execFile);

describe("RepositoryManager state", () => {
  let sandbox: string;
  let dataDir: string;
  let rootDir: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "compulsive-manager-"));
    dataDir = join(sandbox, "app-data");
    rootDir = join(sandbox, "Desktop", "源码");
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("initializes versioned state without overwriting an existing root", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });

    const first = await manager.initialize();
    const second = await manager.initialize({ rootDir: join(sandbox, "different") });

    expect(first).toEqual({
      schemaVersion: 1,
      rootDir,
      workspaceRoot: join(dirname(rootDir), "Workspaces"),
      scanRoots: [],
    });
    expect(second).toEqual(first);
    await expect(readFile(join(dataDir, "config.json"), "utf8")).resolves.toContain(
      '"schemaVersion": 1',
    );
    await expect(readFile(join(dataDir, "repositories.json"), "utf8")).resolves.toContain(
      '"repositories": []',
    );
    await expect(readFile(join(dataDir, "workspaces.json"), "utf8")).resolves.toContain(
      '"workspaces": []',
    );
  });

  it("registers a local repository in place and persists it", async () => {
    const repositoryPath = join(sandbox, "散落项目", "my-tool");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    const record = await manager.register({ path: repositoryPath });
    const reloadedManager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });

    expect(record).toMatchObject({
      kind: "local",
      name: "my-tool",
      classificationPath: "local/my-tool",
      absolutePath: await realpath(repositoryPath),
      isManaged: false,
    });
    await expect(reloadedManager.search({ query: "my-tool" })).resolves.toEqual([record]);
  });

  it("classifies a repository from its origin and makes registration idempotent", async () => {
    const repositoryPath = join(sandbox, "checkout");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "remote",
      "add",
      "origin",
      "git@github.com:vuejs/core.git",
    ]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    const first = await manager.register({ path: repositoryPath });
    const second = await manager.register({ path: join(repositoryPath, ".git") });

    expect(first).toMatchObject({
      kind: "remote",
      classificationPath: "github.com/vuejs/core",
      canonicalRemote: "github.com/vuejs/core",
    });
    expect(second).toEqual(first);
    await expect(manager.search({ query: "github.com/vuejs" })).resolves.toEqual([first]);
  });

  it("ranks an exact repository name before substring matches", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    for (const name of ["core-utils", "core"]) {
      const repositoryPath = join(sandbox, name);
      await execFileAsync("git", ["init", "-q", repositoryPath]);
      await manager.register({ path: repositoryPath });
    }

    const results = await manager.search({ query: "core" });

    expect(results.map((record) => record.name)).toEqual(["core", "core-utils"]);
  });

  it("clones into the classified root and returns the existing record on retry", async () => {
    const bareRemote = join(sandbox, "remotes", "acme", "project.git");
    await execFileAsync("git", ["init", "--bare", "-q", bareRemote]);
    const remote = pathToFileURL(bareRemote).toString();
    const classification = parseGitRemote(remote);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    const first = await manager.clone({ remote, depth: 1 });
    const second = await manager.clone({ remote });

    expect(first.absolutePath).toBe(
      await realpath(join(rootDir, ...classification.relativePath.split("/"))),
    );
    expect(first.isManaged).toBe(true);
    expect(second).toEqual(first);
  });

  it("refuses to clone into an occupied classification path", async () => {
    const bareRemote = join(sandbox, "remotes", "acme", "occupied.git");
    await execFileAsync("git", ["init", "--bare", "-q", bareRemote]);
    const remote = pathToFileURL(bareRemote).toString();
    const classification = parseGitRemote(remote);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await execFileAsync("mkdir", ["-p", join(rootDir, ...classification.relativePath.split("/"))]);

    await expect(manager.clone({ remote })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("never persists credentials from an origin URL", async () => {
    const repositoryPath = join(sandbox, "credential-test");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "remote",
      "add",
      "origin",
      "https://secret-user:secret-token@github.com/acme/private.git",
    ]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    const record = await manager.register({ path: repositoryPath });
    const persisted = await readFile(join(dataDir, "repositories.json"), "utf8");

    expect(record.remoteUrl).toBe("github.com/acme/private");
    expect(persisted).not.toContain("secret-user");
    expect(persisted).not.toContain("secret-token");
  });

  it("discovers repositories without registering them or descending into heavy folders", async () => {
    const scanRoot = join(sandbox, "scan-root");
    const outerRepository = join(scanRoot, "outer");
    const ignoredRepository = join(scanRoot, "node_modules", "ignored");
    await execFileAsync("git", ["init", "-q", outerRepository]);
    await execFileAsync("git", ["init", "-q", join(outerRepository, "nested")]);
    await execFileAsync("git", ["init", "-q", ignoredRepository]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    const result = await manager.discover({ paths: [scanRoot] });

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toMatchObject({
      absolutePath: await realpath(outerRepository),
      classificationPath: "local/outer",
      isRegistered: false,
    });
    await expect(manager.search()).resolves.toEqual([]);
  });

  it("discovers a Git worktree whose .git marker is a file", async () => {
    const mainRepository = join(sandbox, "main-repository");
    const worktreePath = join(sandbox, "linked-worktree");
    await execFileAsync("git", ["init", "-q", mainRepository]);
    await execFileAsync("git", ["-C", mainRepository, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", mainRepository, "config", "user.email", "test@example.com"]);
    await writeFile(join(mainRepository, "README.md"), "test\n");
    await execFileAsync("git", ["-C", mainRepository, "add", "README.md"]);
    await execFileAsync("git", ["-C", mainRepository, "commit", "-q", "-m", "initial"]);
    await execFileAsync("git", ["-C", mainRepository, "worktree", "add", "-q", worktreePath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    const result = await manager.discover({ paths: [worktreePath] });

    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]?.absolutePath).toBe(await realpath(worktreePath));
  });

  it("forgets only the index record and leaves repository files untouched", async () => {
    const repositoryPath = join(sandbox, "keep-me");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });

    await manager.forget(record.id);

    await expect(manager.search()).resolves.toEqual([]);
    await expect(access(join(repositoryPath, ".git"))).resolves.toBeUndefined();
  });

  it("previews and safely organizes a local repository into the managed root", async () => {
    const repositoryPath = join(sandbox, "散落项目", "local-app");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });

    const plan = await manager.planOrganize(record.id);
    expect(plan).toMatchObject({
      source: await realpath(repositoryPath),
      target: join(await realpath(rootDir), "local", "local-app"),
      isNoop: false,
    });
    await expect(access(repositoryPath)).resolves.toBeUndefined();

    const organized = await manager.organize(plan);

    expect(organized.absolutePath).toBe(await realpath(join(rootDir, "local", "local-app")));
    expect(organized.isManaged).toBe(true);
    await expect(access(repositoryPath)).rejects.toThrow();
  });

  it("reclassifies a registered repository from its current origin only after organizing", async () => {
    const repositoryPath = join(rootDir, "local", "promoted-repository");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "remote",
      "add",
      "origin",
      "git@github.com:acme/promoted-repository.git",
    ]);

    const plan = await manager.planOrganize(record.id);

    expect(plan).toMatchObject({
      source: await realpath(repositoryPath),
      target: join(await realpath(rootDir), "github.com", "acme", "promoted-repository"),
      isNoop: false,
    });
    await expect(manager.search({ query: "promoted-repository" })).resolves.toEqual([record]);

    const organized = await manager.organize(plan);

    expect(organized).toMatchObject({
      id: record.id,
      kind: "remote",
      name: "promoted-repository",
      classificationPath: "github.com/acme/promoted-repository",
      canonicalRemote: "github.com/acme/promoted-repository",
      remoteUrl: "github.com/acme/promoted-repository",
      host: "github.com",
      ownerPath: ["acme"],
    });
    await expect(access(repositoryPath)).rejects.toThrow();
    await expect(access(join(plan.target, ".git"))).resolves.toBeUndefined();
    await expect(manager.planOrganize(record.id)).resolves.toMatchObject({ isNoop: true });
  });

  it("removes empty source directories after the last repository is organized", async () => {
    const legacyRoot = join(sandbox, "legacy-source");
    const firstRepository = join(legacyRoot, "team", "first-app");
    const secondRepository = join(legacyRoot, "team", "second-app");
    await execFileAsync("git", ["init", "-q", firstRepository]);
    await execFileAsync("git", ["init", "-q", secondRepository]);
    await writeFile(join(legacyRoot, ".DS_Store"), "Finder metadata");
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const firstRecord = await manager.register({ path: firstRepository });
    const secondRecord = await manager.register({ path: secondRepository });

    await manager.organize(await manager.planOrganize(firstRecord.id));
    await expect(access(legacyRoot)).resolves.toBeUndefined();

    await manager.organize(await manager.planOrganize(secondRecord.id));

    await expect(access(legacyRoot)).rejects.toThrow();
  });

  it("stops source cleanup when an ancestor contains user files", async () => {
    const legacyRoot = join(sandbox, "legacy-with-notes");
    const repositoryPath = join(legacyRoot, "team", "keep-notes-safe");
    const notesPath = join(legacyRoot, "notes.txt");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await writeFile(notesPath, "do not delete\n");
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });

    await manager.organize(await manager.planOrganize(record.id));

    await expect(access(join(legacyRoot, "team"))).rejects.toThrow();
    await expect(readFile(notesPath, "utf8")).resolves.toBe("do not delete\n");
  });

  it("refuses to plan an organization when the target is occupied", async () => {
    const repositoryPath = join(sandbox, "external", "conflict");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await mkdir(join(rootDir, "local", "conflict"), { recursive: true });
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });

    await expect(manager.planOrganize(record.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("rejects a tampered index whose classification escapes the managed root", async () => {
    const repositoryPath = join(sandbox, "external", "tampered");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });
    const registryPath = join(dataDir, "repositories.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8"));
    registry.repositories[0].classificationPath = "../../outside";
    await writeFile(registryPath, JSON.stringify(registry));

    await expect(manager.planOrganize(record.id)).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
    });
  });

  it("rolls a move back when the updated index cannot be persisted", async () => {
    const repositoryPath = join(sandbox, "external", "rollback-me");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });
    const plan = await manager.planOrganize(record.id);
    await chmod(dataDir, 0o500);

    try {
      await expect(manager.organize(plan)).rejects.toMatchObject({ code: "FILESYSTEM_FAILED" });
      await expect(access(repositoryPath)).resolves.toBeUndefined();
      await expect(access(plan.target)).rejects.toThrow();
    } finally {
      await chmod(dataDir, 0o700);
    }
  });
});
