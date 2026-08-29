import { execFile } from "node:child_process";
import { access, mkdtemp, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import { createRepositoryManager } from "../src/manager.js";
import type { NavigationTarget } from "../src/terminal.js";
import type { RepositoryRecord, WorkspaceRecord } from "../src/types.js";

const execFileAsync = promisify(execFile);

describe("cpl workspace", () => {
  let sandbox: string;
  let dataDir: string;
  let rootDir: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "compulsive-workspace-cli-"));
    dataDir = join(sandbox, "data");
    rootDir = join(sandbox, "Code");
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("creates, inspects, links, navigates, removes, and deletes a workspace", async () => {
    const repositoryPath = join(sandbox, "repositories", "web app");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.register({ path: repositoryPath });
    const output: string[] = [];
    const errors: string[] = [];
    const copied: string[] = [];
    const context = {
      manager,
      stdout: (value: string) => output.push(value),
      stderr: (value: string) => errors.push(value),
      copyText: async (value: string) => {
        copied.push(value);
      },
      isTTY: false,
    };

    expect(await runCli(["workspace", "create", "Client Apps", "--json"], context)).toBe(0);
    const workspace = JSON.parse(output.pop()!) as WorkspaceRecord;
    expect(workspace.name).toBe("Client Apps");

    expect(
      await runCli(
        ["workspace", "add", "Client Apps", "web app", "--alias", "frontend", "--json"],
        context,
      ),
    ).toBe(0);
    expect((JSON.parse(output.pop()!) as WorkspaceRecord).members).toMatchObject([
      { alias: "frontend", mode: "link" },
    ]);

    expect(await runCli(["ws", "show", "Client Apps", "--json"], context)).toBe(0);
    expect((JSON.parse(output.pop()!) as WorkspaceRecord).id).toBe(workspace.id);
    expect(await runCli(["workspace", "list", "client", "--json"], context)).toBe(0);
    expect(JSON.parse(output.pop()!)).toHaveLength(1);

    expect(await runCli(["workspace", "list", "client", "--no-color"], context)).toBe(0);
    expect(output.pop()).toContain('cpl  workspaces matching "client"');

    expect(await runCli(["workspace", "go", "Client Apps"], context)).toBe(0);
    expect(copied.at(-1)).toBe(`cd -- '${workspace.absolutePath}'`);

    expect(
      await runCli(["workspace", "remove", "Client Apps", "web app", "--yes", "--json"], context),
    ).toBe(0);
    expect((JSON.parse(output.pop()!) as WorkspaceRecord).members).toEqual([]);
    expect(await runCli(["workspace", "delete", "Client Apps", "--yes", "--json"], context)).toBe(
      0,
    );
    expect(JSON.parse(output.pop()!)).toEqual({ deleted: workspace.id });
    await expect(access(repositoryPath)).resolves.toBeUndefined();
    expect(errors).toEqual([]);
  });

  it("filters repository search by workspace membership and member alias", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const records: RepositoryRecord[] = [];
    for (const name of ["api", "dashboard"]) {
      const path = join(sandbox, "repositories", name);
      await execFileAsync("git", ["init", "-q", path]);
      records.push(await manager.register({ path }));
    }
    const workspace = await manager.createWorkspace({ name: "Product" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: records[0]!.id,
      alias: "frontend-service",
    });
    const output: string[] = [];

    expect(
      await runCli(["search", "frontend", "--workspace", "Product", "--json"], {
        manager,
        stdout: (value) => output.push(value),
        stderr: () => undefined,
        copyText: async () => undefined,
        isTTY: false,
      }),
    ).toBe(0);

    expect(JSON.parse(output.join("\n"))).toMatchObject([{ name: "api" }]);
  });

  it("passes explicit worktree and branch flags to the workspace manager", async () => {
    const repositoryPath = join(sandbox, "repositories", "isolated");
    await execFileAsync("git", ["init", "-q", "-b", "main", repositoryPath]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
    await execFileAsync("git", ["-C", repositoryPath, "config", "user.email", "test@example.com"]);
    await execFileAsync("git", [
      "-C",
      repositoryPath,
      "commit",
      "--allow-empty",
      "-q",
      "-m",
      "initial",
    ]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.register({ path: repositoryPath });
    await manager.createWorkspace({ name: "Feature" });
    const output: string[] = [];

    expect(
      await runCli(
        [
          "workspace",
          "add",
          "Feature",
          "isolated",
          "--worktree",
          "--branch",
          "feature/exact",
          "--create-branch",
          "--json",
        ],
        {
          manager,
          stdout: (value) => output.push(value),
          stderr: () => undefined,
          copyText: async () => undefined,
          isTTY: false,
        },
      ),
    ).toBe(0);

    const updated = JSON.parse(output.join("\n")) as WorkspaceRecord;
    expect(updated.members).toMatchObject([{ mode: "worktree", branch: "feature/exact" }]);
  });

  it("prefers exact workspace names and returns exit code 4 for true ambiguity", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    await manager.createWorkspace({ name: "Client" });
    await manager.createWorkspace({ name: "Client Tools" });
    const output: string[] = [];
    const errors: string[] = [];

    expect(
      await runCli(["workspace", "show", "Client", "--json"], {
        manager,
        stdout: (value) => output.push(value),
        stderr: (value) => errors.push(value),
        copyText: async () => undefined,
        isTTY: false,
      }),
    ).toBe(0);
    expect((JSON.parse(output.pop()!) as WorkspaceRecord).name).toBe("Client");

    const exitCode = await runCli(["workspace", "show", "Clien"], {
      manager,
      stdout: () => undefined,
      stderr: (value) => errors.push(value),
      copyText: async () => undefined,
      isTTY: false,
    });

    expect(exitCode).toBe(4);
    expect(errors.join("\n")).toContain("AMBIGUOUS_MATCH");
  });

  it("opens workspace-only and combined searchable pickers in a TTY", async () => {
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const workspace = await manager.createWorkspace({ name: "Interactive" });
    const repositoryPath = join(sandbox, "repositories", "interactive-target");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const repository = await manager.register({ path: repositoryPath });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      alias: "前端's app",
    });
    const copied: string[] = [];
    const workspaceMessages: string[] = [];
    const destinationMessages: string[] = [];
    let destinationTargets: NavigationTarget[] = [];
    const context = {
      manager,
      stdout: () => undefined,
      stderr: () => undefined,
      copyText: async (value: string) => {
        copied.push(value);
      },
      chooseWorkspace: async (message: string) => {
        workspaceMessages.push(message);
        return workspace;
      },
      chooseDestination: async (message: string, targets: NavigationTarget[]) => {
        destinationMessages.push(message);
        destinationTargets = targets;
        return { kind: "workspace" as const, workspace };
      },
      isTTY: true,
    };

    expect(await runCli(["workspace"], context)).toBe(0);
    expect(await runCli([], context)).toBe(0);

    expect(workspaceMessages).toEqual(["Search workspaces"]);
    expect(destinationMessages).toEqual(["Search repositories and workspaces"]);
    expect(destinationTargets.find((target) => target.kind === "repository")?.aliases).toContain(
      "Interactive/前端's app",
    );
    expect(copied).toEqual([
      `cd -- '${await realpath(workspace.absolutePath)}'`,
      `cd -- '${await realpath(workspace.absolutePath)}'`,
    ]);
  });

  it("reports a broken workspace link through doctor without repairing it", async () => {
    const repositoryPath = join(sandbox, "repositories", "doctor-link");
    await execFileAsync("git", ["init", "-q", repositoryPath]);
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const repository = await manager.register({ path: repositoryPath });
    const workspace = await manager.createWorkspace({ name: "Doctor" });
    await manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    const memberPath = join(workspace.absolutePath, repository.name);
    await unlink(memberPath);
    const output: string[] = [];
    const errors: string[] = [];

    const exitCode = await runCli(["doctor", "--json"], {
      manager,
      stdout: (value) => output.push(value),
      stderr: (value) => errors.push(value),
      copyText: async () => undefined,
      isTTY: false,
    });

    expect(exitCode).toBe(5);
    expect(JSON.parse(output.join("\n"))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: `workspace:${workspace.name}/${repository.name}`,
          ok: false,
        }),
      ]),
    );
    await expect(access(memberPath)).rejects.toThrow();
    expect(errors.join("\n")).toContain("FILESYSTEM_FAILED");
  });
});
