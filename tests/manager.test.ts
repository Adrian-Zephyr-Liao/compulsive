import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

    expect(first).toEqual({ schemaVersion: 1, rootDir, scanRoots: [] });
    expect(second).toEqual(first);
    await expect(readFile(join(dataDir, "config.json"), "utf8")).resolves.toContain(
      '"schemaVersion": 1',
    );
    await expect(readFile(join(dataDir, "repositories.json"), "utf8")).resolves.toContain(
      '"repositories": []',
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
});
