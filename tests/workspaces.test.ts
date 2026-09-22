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

  it("creates the exact requested branch only with explicit authorization", async () => {
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
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{upstream}",
        ])
      ).stdout.trim(),
    ).toBe("origin/main");
  });

  it("clones only selected members from the remote default branch instead of canonical HEAD", async () => {
    async function createRemoteRepository(name: string, defaultBranch = "master") {
      const remotePath = join(sandbox, `${name}.git`);
      const repositoryPath = join(sandbox, "repositories", name);
      await execFileAsync("git", ["init", "-q", "--bare", "-b", defaultBranch, remotePath]);
      await execFileAsync("git", ["clone", "-q", `file://${remotePath}`, repositoryPath]);
      await execFileAsync("git", ["-C", repositoryPath, "config", "user.name", "Compulsive Test"]);
      await execFileAsync("git", [
        "-C",
        repositoryPath,
        "config",
        "user.email",
        "test@example.com",
      ]);
      await writeFile(join(repositoryPath, "origin.txt"), `${name} remote\n`);
      await execFileAsync("git", ["-C", repositoryPath, "add", "origin.txt"]);
      await execFileAsync("git", ["-C", repositoryPath, "commit", "-q", "-m", "remote"]);
      await execFileAsync("git", [
        "-C",
        repositoryPath,
        "push",
        "-q",
        "-u",
        "origin",
        defaultBranch,
      ]);
      return repositoryPath;
    }

    const selectedPath = await createRemoteRepository("selected");
    const selectedMainPath = await createRemoteRepository("selected-main", "main");
    const skippedPath = await createRemoteRepository("skipped");
    await execFileAsync("git", ["-C", selectedPath, "switch", "-q", "-c", "local-only"]);
    await writeFile(join(selectedPath, "local.txt"), "canonical only\n");
    await execFileAsync("git", ["-C", selectedPath, "add", "local.txt"]);
    await execFileAsync("git", ["-C", selectedPath, "commit", "-q", "-m", "local"]);

    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
    const selectedRepository = await manager.register({ path: selectedPath });
    const selectedMainRepository = await manager.register({ path: selectedMainPath });
    const skippedRepository = await manager.register({ path: skippedPath });
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

    const cloned = await manager.cloneWorkspace({
      sourceWorkspaceId: source.id,
      name: "cloned",
      repositoryIds: [selectedRepository.id, selectedMainRepository.id],
      branchName: "feat/custom-clone",
      referenceRepositoryIds: [selectedMainRepository.id],
    });

    expect(cloned.members).toHaveLength(2);
    expect(cloned.members[0]).toMatchObject({
      repositoryId: selectedRepository.id,
      alias: "selected",
      mode: "worktree",
      branch: "feat/custom-clone",
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
    expect(developmentBranch.stdout.trim()).toBe("feat/custom-clone");
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

    await writeFile(join(clonedMainPath, "draft.txt"), "local draft\n");
    const referenceStatus = await manager.getWorkspaceStatus(cloned.id);
    expect(
      referenceStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
    ).toMatchObject({
      branch: "origin/main",
      detached: true,
      ahead: 0,
      behind: 0,
      changes: ["?? draft.txt"],
    });

    const promoted = await manager.promoteWorkspaceReference({
      workspaceId: cloned.id,
      repositoryId: selectedMainRepository.id,
      branch: "feat/promoted-reference",
    });
    expect(promoted.members[1]).toMatchObject({
      repositoryId: selectedMainRepository.id,
      branch: "feat/promoted-reference",
      mode: "worktree",
    });
    expect(promoted.members[1]).not.toHaveProperty("detached");
    const [promotedBranch, promotedUpstream] = await Promise.all([
      execFileAsync("git", ["-C", clonedMainPath, "branch", "--show-current"]),
      execFileAsync("git", [
        "-C",
        clonedMainPath,
        "rev-parse",
        "--abbrev-ref",
        "--symbolic-full-name",
        "@{upstream}",
      ]),
    ]);
    expect(promotedBranch.stdout.trim()).toBe("feat/promoted-reference");
    expect(promotedUpstream.stdout.trim()).toBe("origin/main");

    await writeFile(join(selectedMainPath, "upstream.txt"), "new upstream commit\n");
    await execFileAsync("git", ["-C", selectedMainPath, "add", "upstream.txt"]);
    await execFileAsync("git", ["-C", selectedMainPath, "commit", "-q", "-m", "upstream"]);
    await execFileAsync("git", ["-C", selectedMainPath, "push", "-q", "origin", "main"]);
    const promotedStatus = await manager.getWorkspaceStatus(cloned.id, true);
    expect(
      promotedStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
    ).toMatchObject({
      branch: "feat/promoted-reference",
      detached: false,
      ahead: 0,
      behind: 1,
      changes: ["?? draft.txt"],
    });
    await expect(
      manager.convertWorkspaceToReference({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await unlink(join(clonedMainPath, "draft.txt"));

    await manager.rebaseWorkspaceMember({
      workspaceId: cloned.id,
      repositoryId: selectedMainRepository.id,
    });
    await writeFile(join(clonedMainPath, "feature.txt"), "feature commit\n");
    await execFileAsync("git", ["-C", clonedMainPath, "add", "feature.txt"]);
    await execFileAsync("git", ["-C", clonedMainPath, "commit", "-q", "-m", "feature"]);
    const rebasedStatus = await manager.getWorkspaceStatus(cloned.id);
    expect(
      rebasedStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
    ).toMatchObject({
      branch: "feat/promoted-reference",
      upstream: "origin/main",
      ahead: 1,
      behind: 0,
      unpushed: 1,
      changes: [],
    });
    await manager.pushWorkspaceMember({
      workspaceId: cloned.id,
      repositoryId: selectedMainRepository.id,
    });
    const pushedStatus = await manager.getWorkspaceStatus(cloned.id);
    expect(
      pushedStatus.members.find((status) => status.repositoryId === selectedMainRepository.id),
    ).toMatchObject({
      upstream: "origin/feat/promoted-reference",
      unpushed: 0,
    });

    await writeFile(join(clonedMainPath, "local-next.txt"), "local next\n");
    await execFileAsync("git", ["-C", clonedMainPath, "add", "local-next.txt"]);
    await execFileAsync("git", ["-C", clonedMainPath, "commit", "-q", "-m", "local next"]);
    const remoteWriterPath = join(sandbox, "remote-writer");
    await execFileAsync("git", [
      "clone",
      "-q",
      "--branch",
      "feat/promoted-reference",
      `file://${join(sandbox, "selected-main.git")}`,
      remoteWriterPath,
    ]);
    await execFileAsync("git", ["-C", remoteWriterPath, "config", "user.name", "Remote Writer"]);
    await execFileAsync("git", [
      "-C",
      remoteWriterPath,
      "config",
      "user.email",
      "remote@example.com",
    ]);
    await writeFile(join(remoteWriterPath, "remote-next.txt"), "remote next\n");
    await execFileAsync("git", ["-C", remoteWriterPath, "add", "remote-next.txt"]);
    await execFileAsync("git", ["-C", remoteWriterPath, "commit", "-q", "-m", "remote next"]);
    await execFileAsync("git", ["-C", remoteWriterPath, "push", "-q", "origin", "HEAD"]);

    await expect(
      manager.pushWorkspaceMember({
        workspaceId: cloned.id,
        repositoryId: selectedMainRepository.id,
      }),
    ).resolves.toBeUndefined();
    const remoteAdvancedStatus = await manager.getWorkspaceStatus(cloned.id);
    expect(
      remoteAdvancedStatus.members.find(
        (status) => status.repositoryId === selectedMainRepository.id,
      ),
    ).toMatchObject({
      upstream: "origin/feat/promoted-reference",
      unpushed: 0,
    });

    const convertedBack = await manager.convertWorkspaceToReference({
      workspaceId: cloned.id,
      repositoryId: selectedMainRepository.id,
    });
    expect(convertedBack.members[1]).toMatchObject({
      repositoryId: selectedMainRepository.id,
      branch: "origin/main",
      detached: true,
    });
    const [convertedBranch, preservedDevelopmentBranch] = await Promise.all([
      execFileAsync("git", ["-C", clonedMainPath, "branch", "--show-current"]),
      execFileAsync("git", [
        "-C",
        selectedMainPath,
        "show-ref",
        "--verify",
        "refs/heads/feat/promoted-reference",
      ]),
    ]);
    expect(convertedBranch.stdout.trim()).toBe("");
    expect(preservedDevelopmentBranch.stdout.trim()).not.toBe("");

    const switchedToExistingMain = await manager.promoteWorkspaceReference({
      workspaceId: cloned.id,
      repositoryId: selectedMainRepository.id,
      branch: "main",
    });
    expect(switchedToExistingMain.members[1]).toMatchObject({
      branch: "main",
      mode: "worktree",
    });
    const existingMainStatus = await manager.getWorkspaceStatus(cloned.id);
    expect(
      existingMainStatus.members.find(
        (status) => status.repositoryId === selectedMainRepository.id,
      ),
    ).toMatchObject({
      branch: "main",
      defaultBranch: "origin/main",
      ahead: 0,
      behind: 0,
    });
    await expect(
      manager.cloneWorkspace({
        sourceWorkspaceId: source.id,
        name: "cloned",
        repositoryIds: [selectedRepository.id],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  }, 15_000);

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
        name: "foreign",
        repositoryIds: [foreign.id],
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(manager.searchWorkspaces({ query: "foreign" })).resolves.toEqual([]);
  });

  it("migrates a dirty legacy worktree into the canonical repository and leaves a link", async () => {
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
    const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
    await manager.initialize();
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
