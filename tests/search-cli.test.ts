import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { createRepositoryManager } from "../src/manager.js";

const execFileAsync = promisify(execFile);

describe("cpl search", () => {
  let sandbox: string;
  let dataDir: string;
  let rootDir: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "compulsive-search-cli-"));
    dataDir = join(sandbox, "data");
    rootDir = join(sandbox, "managed");
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("searches repositories by metadata through a dedicated command", async () => {
    const repositoryPath = join(sandbox, "checkout");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "remote",
      "add",
      "origin",
      "git@github.com:Acme/core.git",
    ]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.register({ path: repositoryPath });
    const output: string[] = [];
    const errors: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: (value: string) => errors.push(value),
      copyText: async () => undefined,
      isTTY: false,
    };

    expect(await runCli(["search", "ACME", "--json"], context)).toBe(0);
    expect(JSON.parse(output.join("\n"))).toEqual([
      expect.objectContaining({ classificationPath: "github.com/Acme/core" }),
    ]);

    output.length = 0;
    expect(await runCli(["search", "missing", "--json"], context)).toBe(0);
    expect(JSON.parse(output.join("\n"))).toEqual([]);

    expect(await runCli(["search"], context)).toBe(2);
    expect(errors.at(-1)).toContain("Repository query is required");

    output.length = 0;
    expect(await runCli(["help"], context)).toBe(0);
    expect(output.join("\n")).toContain(
      "cpl search <query> [--workspace <workspace-query>] [--json]",
    );
  });

  it("opens a searchable repository picker in interactive terminals", async () => {
    const repositoryPath = join(sandbox, "interactive-search");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const record = await manager.register({ path: repositoryPath });
    const output: string[] = [];
    const copied: string[] = [];
    const pickerMessages: string[] = [];
    const destinationMessages: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: () => undefined,
      copyText: async (value: string) => {
        copied.push(value);
      },
      chooseRepository: async (message: string) => {
        pickerMessages.push(message);
        return record;
      },
      chooseDestination: async (message: string) => {
        destinationMessages.push(message);
        return { kind: "repository" as const, repository: record };
      },
      isTTY: true,
    };

    expect(await runCli(["search"], context)).toBe(0);
    expect(await runCli([], context)).toBe(0);

    expect(pickerMessages).toEqual(["Search repositories"]);
    expect(destinationMessages).toEqual(["Search repositories and workspaces"]);
    expect(copied).toEqual([
      `cd -- '${await realpath(repositoryPath)}'`,
      `cd -- '${await realpath(repositoryPath)}'`,
    ]);
    expect(output.at(-1)).toBe(copied.at(-1));
  });
});
