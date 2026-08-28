import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { createRepositoryManager } from "../src/manager.js";

const execFileAsync = promisify(execFile);

describe("cpl CLI", () => {
  let sandbox: string;
  let dataDir: string;
  let rootDir: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "compulsive-cli-"));
    dataDir = join(sandbox, "data");
    rootDir = join(sandbox, "Desktop", "源码");
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("initializes, registers, lists, and copies a safe cd command", async () => {
    const repositoryPath = join(sandbox, "My Repo's Source");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const copied: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => stdout.push(value),
      stderr: (value: string) => stderr.push(value),
      copyText: async (value: string) => {
        copied.push(value);
      },
      isTTY: false,
    };

    expect(await runCli(["init", "--root", rootDir], context)).toBe(0);
    expect(await runCli(["add", repositoryPath], context)).toBe(0);
    stdout.length = 0;
    expect(await runCli(["list", "--json"], context)).toBe(0);
    expect(JSON.parse(stdout.join("\n"))).toHaveLength(1);
    stdout.length = 0;
    expect(await runCli(["go", "My Repo's Source"], context)).toBe(0);

    expect(copied.at(-1)).toBe(`cd -- '${(await realpath(repositoryPath)).replace("'", "'\\''")}'`);
    expect(stdout.at(-1)).toBe(copied.at(-1));
    expect(stderr).toEqual([]);
  });

  it("keeps scan read-only unless --register is provided", async () => {
    const scanRoot = join(sandbox, "scan");
    const repositoryPath = join(scanRoot, "found-repo");
    const secondRepositoryPath = join(scanRoot, "second-repo");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await execFileAsync("git", ["init", "-q", secondRepositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const output: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: () => undefined,
      copyText: async () => undefined,
      isTTY: false,
    };

    expect(await runCli(["scan", scanRoot, "--json"], context)).toBe(0);
    await expect(manager.search()).resolves.toEqual([]);
    output.length = 0;
    expect(await runCli(["scan", scanRoot, "--register", "--json"], context)).toBe(0);

    expect(JSON.parse(output.join("\n"))).toHaveLength(2);
    await expect(manager.search()).resolves.toHaveLength(2);
  });

  it("previews organize, applies only with --yes, and forgets without deleting", async () => {
    const repositoryPath = join(sandbox, "external", "move-me");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.register({ path: repositoryPath });
    const copied: string[] = [];
    const context = {
      manager,
      stdout: () => undefined,
      stderr: () => undefined,
      copyText: async (value: string) => {
        copied.push(value);
      },
      isTTY: false,
    };

    expect(await runCli(["organize", "move-me", "--dry-run"], context)).toBe(0);
    await expect(access(repositoryPath)).resolves.toBeUndefined();
    expect(await runCli(["organize", "move-me", "--yes"], context)).toBe(0);
    expect(copied).toHaveLength(1);
    expect(await runCli(["forget", "move-me", "--yes"], context)).toBe(0);

    await expect(manager.search()).resolves.toEqual([]);
    await expect(access(join(rootDir, "local", "move-me", ".git"))).resolves.toBeUndefined();
  });

  it("previews and organizes all registered repositories without replacing the clipboard", async () => {
    const sourceRoot = join(sandbox, "external");
    const repositoryPaths = [join(sourceRoot, "alpha"), join(sourceRoot, "beta")];
    for (const repositoryPath of repositoryPaths) {
      await execFileAsync("git", ["init", "-q", repositoryPath]);
    }
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    for (const repositoryPath of repositoryPaths) {
      await manager.register({ path: repositoryPath });
    }
    const output: string[] = [];
    const copied: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: () => undefined,
      copyText: async (value: string) => {
        copied.push(value);
      },
      isTTY: false,
    };

    expect(await runCli(["organize", "--all", "--dry-run", "--json"], context)).toBe(0);
    expect(JSON.parse(output.join("\n"))).toHaveLength(2);
    for (const repositoryPath of repositoryPaths) {
      await expect(access(repositoryPath)).resolves.toBeUndefined();
    }

    output.length = 0;
    expect(await runCli(["organize", "--all", "--yes", "--json"], context)).toBe(0);
    expect(JSON.parse(output.join("\n"))).toHaveLength(2);
    await expect(access(join(rootDir, "local", "alpha", ".git"))).resolves.toBeUndefined();
    await expect(access(join(rootDir, "local", "beta", ".git"))).resolves.toBeUndefined();
    expect(copied).toEqual([]);
  });

  it("preflights every repository before an organize-all move", async () => {
    const goodRepository = join(sandbox, "external", "good");
    const conflictingRepository = join(sandbox, "external", "conflict");
    await execFileAsync("git", ["init", "-q", goodRepository]);
    await execFileAsync("git", ["init", "-q", conflictingRepository]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.register({ path: goodRepository });
    await manager.register({ path: conflictingRepository });
    await mkdir(join(rootDir, "local", "conflict"), { recursive: true });

    const exitCode = await runCli(["organize", "--all", "--yes"], {
      manager,
      stdout: () => undefined,
      stderr: () => undefined,
      copyText: async () => undefined,
      isTTY: false,
    });

    expect(exitCode).toBe(4);
    await expect(access(goodRepository)).resolves.toBeUndefined();
    await expect(access(conflictingRepository)).resolves.toBeUndefined();
    await expect(access(join(rootDir, "local", "good"))).rejects.toThrow();
  });

  it("confirms an interactive organize-all operation only once", async () => {
    const repositoryPath = join(sandbox, "external", "interactive");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.register({ path: repositoryPath });
    let confirmationCount = 0;

    const exitCode = await runCli(["organize", "--all"], {
      manager,
      stdout: () => undefined,
      stderr: () => undefined,
      copyText: async () => undefined,
      confirm: async () => {
        confirmationCount += 1;
        return true;
      },
      runTask: async (_message, task) => task(),
      isTTY: true,
    });

    expect(exitCode).toBe(0);
    expect(confirmationCount).toBe(1);
    await expect(access(join(rootDir, "local", "interactive", ".git"))).resolves.toBeUndefined();
  });

  it("rejects combining organize --all with a repository query", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();

    await expect(
      runCli(["organize", "repo", "--all", "--dry-run"], {
        manager,
        stdout: () => undefined,
        stderr: () => undefined,
        copyText: async () => undefined,
        isTTY: false,
      }),
    ).resolves.toBe(2);
  });

  it("prefers an exact repository name and maps true ambiguity to exit code 4", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    for (const name of ["tool", "tool-extra"]) {
      const path = join(sandbox, name);
      await execFileAsync("git", ["init", "-q", path]);
      await manager.register({ path });
    }
    const errors: string[] = [];

    expect(
      await runCli(["go", "tool"], {
        manager,
        stdout: () => undefined,
        stderr: (value) => errors.push(value),
        copyText: async () => undefined,
        isTTY: false,
      }),
    ).toBe(0);

    const exitCode = await runCli(["go", "too"], {
      manager,
      stdout: () => undefined,
      stderr: (value) => errors.push(value),
      copyText: async () => undefined,
      isTTY: false,
    });

    expect(exitCode).toBe(4);
    expect(errors.join("\n")).toContain("AMBIGUOUS_MATCH");
  });

  it("updates configuration and reports doctor checks as JSON", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const output: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: () => undefined,
      copyText: async () => undefined,
      isTTY: false,
    };
    const alternateRoot = join(sandbox, "alternate-source");
    const alternateWorkspaceRoot = join(sandbox, "team-workspaces");
    const scanRoot = join(sandbox, "projects");

    expect(await runCli(["config", "set-root", alternateRoot], context)).toBe(0);
    expect(await runCli(["config", "set-workspace-root", alternateWorkspaceRoot], context)).toBe(0);
    expect(await runCli(["config", "add-scan-root", scanRoot], context)).toBe(0);
    expect(await manager.getConfig()).toMatchObject({
      rootDir: alternateRoot,
      workspaceRoot: alternateWorkspaceRoot,
      scanRoots: [scanRoot],
    });
    output.length = 0;
    expect(await runCli(["doctor", "--json"], context)).toBe(0);

    expect(JSON.parse(output.join("\n"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "git", ok: true }),
        expect.objectContaining({ name: "storage", ok: true }),
        expect.objectContaining({ name: "clipboard", ok: true }),
      ]),
    );
  });

  it("accepts modern global flags while rejecting unknown options", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    const output: string[] = [];
    const errors: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: (value: string) => errors.push(value),
      copyText: async () => undefined,
      isTTY: false,
    };

    expect(await runCli(["--no-color", "init", "--root", rootDir], context)).toBe(0);
    expect(output.at(-1)).toContain("Initialized");
    expect(await runCli(["list", "--unknown"], context)).toBe(2);
    expect(errors.at(-1)).toContain("Unknown flag");
    expect(await runCli(["init", "--root"], context)).toBe(2);
    expect(errors.at(-1)).toContain("requires a value");
  });

  it("rejects removed project config entry points", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    const output: string[] = [];
    const errors: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: (value: string) => errors.push(value),
      isTTY: false,
    };

    expect(await runCli(["--config", "compulsive.config.ts", "init"], context)).toBe(2);
    expect(errors.at(-1)).toContain("Unknown flag: --config");

    expect(await runCli(["init", "--root", rootDir], context)).toBe(0);
    expect(await runCli(["config", "file"], context)).toBe(2);
    expect(errors.at(-1)).toContain("Unknown config action: file");

    output.length = 0;
    expect(await runCli(["config", "show", "--json"], context)).toBe(0);
    expect(JSON.parse(output.join("\n"))).toMatchObject({ rootDir });
  });
});
