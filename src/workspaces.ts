import { randomUUID } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  readFile,
  readlink,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { CompulsiveError } from "./errors.js";
import { runGit } from "./git.js";
import {
  fileExists,
  readConfig,
  readRegistry,
  readWorkspaceRegistry,
  readWorkspaceStatusRegistry,
  writeJsonAtomic,
  type StoragePaths,
} from "./storage.js";
import type {
  AddWorkspaceMemberInput,
  CloneWorkspaceInput,
  ConvertWorkspaceToReferenceInput,
  CreateWorkspaceInput,
  PromoteWorkspaceReferenceInput,
  RemoveWorkspaceMemberInput,
  RepositoryRecord,
  SearchWorkspacesInput,
  WorkspaceId,
  WorkspaceGitActionInput,
  WorkspaceMember,
  WorkspaceMigrationResult,
  WorkspaceMemberStatus,
  WorkspaceRecord,
  WorkspaceStatusResult,
  WorkspaceSyncIssue,
  WorkspaceSyncResult,
} from "./types.js";

const worktreeDirectoryName = ".worktrees";
const worktreeExcludePattern = "/.worktrees/";

export function assertSafeWorkspaceSegment(value: string, label: string): void {
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes("\0")
  ) {
    throw new CompulsiveError("INVALID_INPUT", `${label} must be one safe path segment.`);
  }
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

function matchRank(workspace: WorkspaceRecord, query: string): number {
  const values = [workspace.id, workspace.name, workspace.absolutePath];
  if (values.some((value) => value.toLowerCase() === query)) return 0;
  if (values.some((value) => value.toLowerCase().startsWith(query))) return 1;
  return 2;
}

export async function createWorkspace(
  paths: StoragePaths,
  input: CreateWorkspaceInput,
): Promise<WorkspaceRecord> {
  const name = input.name.trim();
  assertSafeWorkspaceSegment(name, "Workspace name");
  const config = await readConfig(paths.config);
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const requestedPath = resolve(input.path ?? join(config.workspaceRoot, name));
  const absolutePath = await canonicalPath(requestedPath);

  if (
    registry.workspaces.some((workspace) => workspace.name.toLowerCase() === name.toLowerCase())
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace name already exists: ${name}`);
  }
  if (
    registry.workspaces.some(
      (workspace) => resolve(workspace.absolutePath) === resolve(absolutePath),
    )
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace path is already registered: ${absolutePath}`);
  }

  const existed = await fileExists(requestedPath);
  if (existed && !(await stat(requestedPath)).isDirectory()) {
    throw new CompulsiveError("CONFLICT", `Workspace path is not a directory: ${requestedPath}`);
  }
  await mkdir(requestedPath, { recursive: true });
  const createdPath = await realpath(requestedPath);
  const now = new Date().toISOString();
  const workspace: WorkspaceRecord = {
    id: `workspace:${randomUUID()}` as WorkspaceRecord["id"],
    name,
    absolutePath: createdPath,
    members: [],
    createdAt: now,
    updatedAt: now,
  };
  registry.workspaces.push(workspace);
  try {
    await writeJsonAtomic(paths.workspaces, registry);
  } catch (error) {
    if (!existed) {
      try {
        await rmdir(createdPath);
      } catch {
        // The directory is no longer empty or removable, so preserve it.
      }
    }
    throw error;
  }
  return workspace;
}

export async function searchWorkspaces(
  paths: StoragePaths,
  input: SearchWorkspacesInput = {},
): Promise<WorkspaceRecord[]> {
  await readConfig(paths.config);
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const query = input.query?.trim().toLowerCase() ?? "";
  if (!query) return [...registry.workspaces];
  return registry.workspaces
    .filter((workspace) =>
      [workspace.id, workspace.name, workspace.absolutePath].some((value) =>
        value.toLowerCase().includes(query),
      ),
    )
    .sort((left, right) => matchRank(left, query) - matchRank(right, query));
}

function findWorkspace(
  registry: Awaited<ReturnType<typeof readWorkspaceRegistry>>,
  id: WorkspaceId,
) {
  const index = registry.workspaces.findIndex((workspace) => workspace.id === id);
  if (index === -1) throw new CompulsiveError("NOT_FOUND", "Workspace is not registered.");
  return { index, workspace: registry.workspaces[index]! };
}

function findRepository(repositories: RepositoryRecord[], id: RepositoryRecord["id"]) {
  const repository = repositories.find((record) => record.id === id);
  if (!repository) throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
  return repository;
}

async function pathEntryExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to inspect workspace path: ${path}`, {
      cause: error,
    });
  }
}

async function createVerifiedLink(memberPath: string, repositoryPath: string): Promise<void> {
  const target = await realpath(repositoryPath).catch((error: unknown) => {
    throw new CompulsiveError("NOT_FOUND", `Repository path no longer exists: ${repositoryPath}`, {
      cause: error,
    });
  });
  try {
    await symlink(target, memberPath);
  } catch (error) {
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      `Unable to create workspace link: ${memberPath}`,
      {
        cause: error,
      },
    );
  }
  if ((await realpath(memberPath)) !== target || (await readlink(memberPath)) !== target) {
    await unlinkExpectedLink(memberPath, target).catch(() => undefined);
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      `Unable to verify workspace link: ${memberPath}`,
    );
  }
}

async function unlinkExpectedLink(memberPath: string, target: string): Promise<void> {
  const entry = await lstat(memberPath);
  if (!entry.isSymbolicLink() || (await readlink(memberPath)) !== target) {
    throw new CompulsiveError(
      "CONFLICT",
      `Workspace link changed before it could be removed: ${memberPath}`,
    );
  }
  await unlink(memberPath);
}

async function runRollbacks(actions: Array<() => Promise<void>>): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const action of actions.reverse()) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

async function verifyManagedLink(memberPath: string, repositoryPath: string): Promise<string> {
  return verifyExpectedLink(memberPath, repositoryPath);
}

async function verifyExpectedLink(memberPath: string, expectedPath: string): Promise<string> {
  const entry = await lstat(memberPath).catch((error: unknown) => {
    throw new CompulsiveError("CONFLICT", `Managed workspace link is missing: ${memberPath}`, {
      cause: error,
    });
  });
  if (!entry.isSymbolicLink()) {
    throw new CompulsiveError("CONFLICT", `Workspace member path is not a link: ${memberPath}`);
  }
  const target = await readlink(memberPath);
  if (!isAbsolute(target)) {
    throw new CompulsiveError("CONFLICT", `Workspace member link is unexpected: ${memberPath}`);
  }
  const [resolvedMember, resolvedExpected] = await Promise.all([
    realpath(memberPath).catch(() => undefined),
    realpath(expectedPath).catch(() => undefined),
  ]);
  if (!resolvedMember || !resolvedExpected || resolvedMember !== resolvedExpected) {
    throw new CompulsiveError("CONFLICT", `Workspace member link is unexpected: ${memberPath}`);
  }
  return target;
}

function managedWorktreePath(repositoryPath: string, workspace: WorkspaceRecord): string {
  return join(repositoryPath, worktreeDirectoryName, workspace.name);
}

function workspaceMemberPath(workspace: WorkspaceRecord, member: WorkspaceMember): string {
  return join(workspace.absolutePath, member.alias);
}

function isLegacyWorktree(workspace: WorkspaceRecord, member: WorkspaceMember): boolean {
  return (
    member.mode === "worktree" &&
    resolve(member.worktreePath) === resolve(workspaceMemberPath(workspace, member))
  );
}

function pathContains(parent: string, child: string): boolean {
  const location = relative(resolve(parent), resolve(child));
  return (
    location === "" ||
    (!isAbsolute(location) && location !== ".." && !location.startsWith(`..${sep}`))
  );
}

async function ensureManagedWorktreeRoot(repositoryPath: string): Promise<void> {
  const root = join(repositoryPath, worktreeDirectoryName);
  if (await pathEntryExists(root)) {
    const entry = await lstat(root);
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new CompulsiveError("CONFLICT", `Managed worktree root is occupied: ${root}`);
    }
  }

  const excludeResult = await runGit(["rev-parse", "--git-path", "info/exclude"], {
    cwd: repositoryPath,
  });
  const excludePath = isAbsolute(excludeResult.stdout)
    ? excludeResult.stdout
    : resolve(repositoryPath, excludeResult.stdout);
  const content = await readFile(excludePath, "utf8").catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  if (!content.split(/\r?\n/).includes(worktreeExcludePattern)) {
    await appendFile(
      excludePath,
      `${content && !content.endsWith("\n") ? "\n" : ""}${worktreeExcludePattern}\n`,
    );
  }
  await mkdir(root, { recursive: true });
}

async function gitCommonDirectory(path: string): Promise<string> {
  const result = await runGit(["rev-parse", "--git-common-dir"], { cwd: path });
  return realpath(isAbsolute(result.stdout) ? result.stdout : resolve(path, result.stdout));
}

async function verifyManagedWorktree(
  worktreePath: string,
  repositoryPath: string,
  branch: string,
  detached = false,
): Promise<void> {
  if (!(await pathEntryExists(worktreePath))) {
    throw new CompulsiveError("CONFLICT", `Managed Git worktree is missing: ${worktreePath}`);
  }
  const entry = await lstat(worktreePath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new CompulsiveError(
      "CONFLICT",
      `Workspace member is not a Git worktree: ${worktreePath}`,
    );
  }
  try {
    const [memberRoot, memberCommon, repositoryCommon, currentBranch] = await Promise.all([
      runGit(["rev-parse", "--show-toplevel"], { cwd: worktreePath }),
      gitCommonDirectory(worktreePath),
      gitCommonDirectory(repositoryPath),
      runGit(["branch", "--show-current"], { cwd: worktreePath }),
    ]);
    if (
      (await realpath(memberRoot.stdout)) !== (await realpath(worktreePath)) ||
      memberCommon !== repositoryCommon ||
      currentBranch.stdout !== (detached ? "" : branch)
    ) {
      throw new CompulsiveError(
        "CONFLICT",
        `Workspace worktree identity is unexpected: ${worktreePath}`,
      );
    }
  } catch (error) {
    if (error instanceof CompulsiveError && error.code === "CONFLICT") throw error;
    throw new CompulsiveError(
      "CONFLICT",
      `Workspace member is not the expected worktree: ${worktreePath}`,
      {
        cause: error,
      },
    );
  }
}

async function verifyWorkspaceWorktree(
  workspace: WorkspaceRecord,
  member: Extract<WorkspaceMember, { mode: "worktree" }>,
  repositoryPath: string,
): Promise<{ memberPath: string; worktreePath: string; linked: boolean }> {
  const memberPath = workspaceMemberPath(workspace, member);
  const linked = !isLegacyWorktree(workspace, member);
  if (linked) {
    const expectedPath = managedWorktreePath(repositoryPath, workspace);
    if (resolve(member.worktreePath) !== resolve(expectedPath)) {
      throw new CompulsiveError(
        "CONFLICT",
        `Managed worktree path is unexpected: ${member.worktreePath}`,
      );
    }
    await verifyExpectedLink(memberPath, member.worktreePath);
  }
  await verifyManagedWorktree(member.worktreePath, repositoryPath, member.branch, member.detached);
  return { memberPath, worktreePath: member.worktreePath, linked };
}

async function assertCleanWorktree(memberPath: string): Promise<void> {
  const status = await runGit(["status", "--porcelain"], { cwd: memberPath });
  if (status.stdout) {
    throw new CompulsiveError("CONFLICT", `Git worktree has uncommitted changes: ${memberPath}`);
  }
}

async function addGitWorktree(
  repositoryPath: string,
  worktreePath: string,
  branch: string,
  createBranch: boolean,
  upstream?: string,
  startPoint?: string,
  detached = false,
): Promise<void> {
  const arguments_ = ["-C", repositoryPath, "worktree", "add"];
  if (detached) {
    arguments_.push("--detach", "--", worktreePath, startPoint ?? branch);
  } else if (createBranch) {
    arguments_.push("-b", branch, "--", worktreePath);
    if (startPoint) arguments_.push(startPoint);
  } else arguments_.push("--", worktreePath, branch);
  let added = false;
  try {
    await runGit(arguments_);
    added = true;
    if (createBranch && upstream) {
      await runGit(["branch", "--set-upstream-to", upstream, branch], { cwd: worktreePath });
    }
  } catch (error) {
    if (added) {
      await removeGitWorktree(repositoryPath, worktreePath).catch(() => undefined);
      if (createBranch) {
        await runGit(["branch", "-D", "--", branch], {
          cwd: repositoryPath,
          allowFailure: true,
        });
      }
    }
    if (error instanceof CompulsiveError && error.code === "GIT_FAILED") {
      throw new CompulsiveError("CONFLICT", error.message, error.details);
    }
    throw error;
  }
}

async function removeGitWorktree(repositoryPath: string, worktreePath: string): Promise<void> {
  await runGit(["-C", repositoryPath, "worktree", "remove", "--", worktreePath]);
}

interface InitializedSubmodule {
  relativePath: string;
  gitDirectory: string;
}

async function findInitializedSubmodules(
  worktreePath: string,
  rootPath = worktreePath,
): Promise<InitializedSubmodule[]> {
  const modulesFile = join(worktreePath, ".gitmodules");
  if (!(await fileExists(modulesFile))) return [];
  const keys = await runGit(
    ["config", "--file", modulesFile, "--name-only", "--get-regexp", "^submodule\\..*\\.path$"],
    { cwd: worktreePath, allowFailure: true },
  );
  if (keys.exitCode === 1) return [];
  if (keys.exitCode !== 0) throw new CompulsiveError("GIT_FAILED", keys.stderr);

  const submodules: InitializedSubmodule[] = [];
  for (const key of keys.stdout.split("\n").filter(Boolean)) {
    const pathResult = await runGit(["config", "--file", modulesFile, "--get", key], {
      cwd: worktreePath,
    });
    const submodulePath = resolve(worktreePath, pathResult.stdout);
    const location = relative(rootPath, submodulePath);
    if (location === ".." || location.startsWith(`..${sep}`) || isAbsolute(location)) {
      throw new CompulsiveError("CONFLICT", `Submodule path escapes worktree: ${submodulePath}`);
    }
    const gitFile = await lstat(join(submodulePath, ".git")).catch(() => undefined);
    if (!gitFile?.isFile()) continue;
    const gitDirectory = await runGit(["rev-parse", "--absolute-git-dir"], {
      cwd: submodulePath,
    });
    submodules.push({ relativePath: location, gitDirectory: gitDirectory.stdout });
    submodules.push(...(await findInitializedSubmodules(submodulePath, rootPath)));
  }
  return submodules;
}

async function repairMovedWorktree(
  repositoryPath: string,
  worktreePath: string,
  submodules: InitializedSubmodule[],
): Promise<void> {
  await runGit(["-C", repositoryPath, "worktree", "repair", "--", worktreePath]);
  for (const submodule of submodules) {
    const submodulePath = join(worktreePath, submodule.relativePath);
    await writeFile(join(submodulePath, ".git"), `gitdir: ${submodule.gitDirectory}\n`);
    await runGit([
      "--git-dir",
      submodule.gitDirectory,
      "--work-tree",
      submodulePath,
      "config",
      "core.worktree",
      submodulePath,
    ]);
  }
  await runGit(["status", "--porcelain"], { cwd: worktreePath });
}

async function renameAndRepairWorktree(
  repositoryPath: string,
  source: string,
  target: string,
): Promise<void> {
  const submodules = await findInitializedSubmodules(source);
  await rename(source, target);
  try {
    await repairMovedWorktree(repositoryPath, target, submodules);
  } catch (repairError) {
    await rename(target, source);
    await repairMovedWorktree(repositoryPath, source, submodules).catch(() => undefined);
    throw repairError;
  }
}

async function moveGitWorktree(
  repositoryPath: string,
  source: string,
  target: string,
): Promise<void> {
  if (await fileExists(join(source, ".gitmodules"))) {
    await renameAndRepairWorktree(repositoryPath, source, target);
    return;
  }
  try {
    await runGit(["-C", repositoryPath, "worktree", "move", "--", source, target]);
  } catch (error) {
    if (
      !(error instanceof CompulsiveError) ||
      error.code !== "GIT_FAILED" ||
      !error.message.includes("working trees containing submodules cannot be moved")
    ) {
      throw error;
    }
    await renameAndRepairWorktree(repositoryPath, source, target);
  }
}

async function currentUpstream(repositoryPath: string): Promise<string | undefined> {
  const result = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd: repositoryPath, allowFailure: true },
  );
  return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
}

async function cachedOriginDefaultBranch(repositoryPath: string): Promise<string | undefined> {
  const symbolic = await runGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { cwd: repositoryPath, allowFailure: true },
  );
  if (symbolic.exitCode === 0 && symbolic.stdout) return symbolic.stdout;
  for (const candidate of ["origin/main", "origin/master"]) {
    const result = await runGit(["rev-parse", "--verify", `${candidate}^{commit}`], {
      cwd: repositoryPath,
      allowFailure: true,
    });
    if (result.exitCode === 0) return candidate;
  }
  return undefined;
}

async function fetchOriginDefaultBranch(repositoryPath: string): Promise<string> {
  const remoteHead = await runGit(["ls-remote", "--symref", "origin", "HEAD"], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  const defaultRef = remoteHead.stdout
    .split("\n")
    .find((line) => line.startsWith("ref: refs/heads/") && line.endsWith("\tHEAD"))
    ?.slice("ref: ".length, -"\tHEAD".length);
  if (remoteHead.exitCode !== 0 || !defaultRef) {
    throw new CompulsiveError("CONFLICT", "Unable to resolve the default branch for origin.");
  }
  const remoteBranch = `origin/${defaultRef.slice("refs/heads/".length)}`;
  await runGit(["fetch", "origin", `+${defaultRef}:refs/remotes/${remoteBranch}`], {
    cwd: repositoryPath,
  });
  return remoteBranch;
}

async function originBranch(
  repositoryPath: string,
  branch: string,
  fetchRemote: boolean,
): Promise<string | undefined> {
  const remoteBranch = `origin/${branch}`;
  if (!fetchRemote) {
    const cached = await runGit(["rev-parse", "--verify", `${remoteBranch}^{commit}`], {
      cwd: repositoryPath,
      allowFailure: true,
    });
    return cached.exitCode === 0 ? remoteBranch : undefined;
  }
  const remoteRef = `refs/heads/${branch}`;
  const remote = await runGit(["ls-remote", "--heads", "origin", remoteRef], {
    cwd: repositoryPath,
  });
  if (!remote.stdout) return undefined;
  await runGit(["fetch", "origin", `+${remoteRef}:refs/remotes/${remoteBranch}`], {
    cwd: repositoryPath,
  });
  return remoteBranch;
}

export async function addWorkspaceMember(
  paths: StoragePaths,
  input: AddWorkspaceMemberInput,
): Promise<WorkspaceRecord> {
  await readConfig(paths.config);
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const repository = findRepository(repositoryRegistry.repositories, input.repositoryId);
  const alias = (input.alias ?? repository.name).trim();
  assertSafeWorkspaceSegment(alias, "Workspace member alias");
  if (workspace.members.some((member) => member.repositoryId === repository.id)) {
    throw new CompulsiveError("CONFLICT", "Repository is already a member of this workspace.");
  }
  if (workspace.members.some((member) => member.alias.toLowerCase() === alias.toLowerCase())) {
    throw new CompulsiveError("CONFLICT", `Workspace member alias already exists: ${alias}`);
  }
  const memberPath = join(workspace.absolutePath, alias);
  if (await pathEntryExists(memberPath)) {
    throw new CompulsiveError("CONFLICT", `Workspace member path already exists: ${memberPath}`);
  }

  let member: WorkspaceMember;
  let createdBranch: string | undefined;
  if (input.mode === "worktree") {
    const explicitBranch = input.branch?.trim();
    if (input.branch !== undefined && !explicitBranch) {
      throw new CompulsiveError("INVALID_INPUT", "Worktree branch is required.");
    }
    const startPoint = input.startPoint?.trim();
    if (input.startPoint !== undefined && !startPoint) {
      throw new CompulsiveError("INVALID_INPUT", "Worktree start point is required.");
    }
    const detached = input.detached === true;
    if (detached && !startPoint) {
      throw new CompulsiveError("INVALID_INPUT", "Detached worktree start point is required.");
    }
    if (detached && explicitBranch) {
      throw new CompulsiveError("INVALID_INPUT", "Detached worktree cannot use a local branch.");
    }
    const readableBranch = `workspace/${workspace.name}/${alias}`;
    const validReadableBranch = explicitBranch
      ? undefined
      : await runGit(["check-ref-format", "--branch", readableBranch], {
          cwd: repository.absolutePath,
          allowFailure: true,
        });
    const branch = detached
      ? startPoint!
      : (explicitBranch ??
        (validReadableBranch?.exitCode === 0
          ? readableBranch
          : `workspace/${workspace.id.split(":").at(-1)!}/${repository.id.split(":").at(-1)!}`));
    const worktreePath = managedWorktreePath(repository.absolutePath, workspace);
    if (await pathEntryExists(worktreePath)) {
      throw new CompulsiveError(
        "CONFLICT",
        `Managed worktree path already exists: ${worktreePath}`,
      );
    }
    await ensureManagedWorktreeRoot(repository.absolutePath);
    const createBranch = !detached && (explicitBranch === undefined || input.createBranch === true);
    if (createBranch) createdBranch = branch;
    const upstream = createBranch
      ? (startPoint ?? (await currentUpstream(repository.absolutePath)))
      : undefined;
    await addGitWorktree(
      repository.absolutePath,
      worktreePath,
      branch,
      createBranch,
      upstream,
      startPoint,
      detached,
    );
    try {
      await verifyManagedWorktree(worktreePath, repository.absolutePath, branch, detached);
      await createVerifiedLink(memberPath, worktreePath);
    } catch (error) {
      await unlinkExpectedLink(memberPath, await realpath(worktreePath)).catch(() => undefined);
      await removeGitWorktree(repository.absolutePath, worktreePath).catch(() => undefined);
      if (createBranch) {
        await runGit(["branch", "-D", "--", branch], {
          cwd: repository.absolutePath,
          allowFailure: true,
        });
      }
      throw error;
    }
    member = {
      repositoryId: repository.id,
      alias,
      mode: "worktree",
      branch,
      worktreePath: await realpath(worktreePath),
      ...(detached ? { detached: true as const } : {}),
    };
  } else {
    await createVerifiedLink(memberPath, repository.absolutePath);
    member = { repositoryId: repository.id, alias, mode: "link" };
  }
  const updated: WorkspaceRecord = {
    ...workspace,
    members: [...workspace.members, member],
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      if (member.mode === "worktree") {
        await unlinkExpectedLink(memberPath, member.worktreePath);
        await assertCleanWorktree(member.worktreePath);
        await removeGitWorktree(repository.absolutePath, member.worktreePath);
        if (createdBranch) {
          await runGit(["branch", "-D", "--", createdBranch], {
            cwd: repository.absolutePath,
            allowFailure: true,
          });
        }
      } else {
        await unlinkExpectedLink(memberPath, await realpath(repository.absolutePath));
      }
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the new member could not be rolled back.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
  return updated;
}

export async function cloneWorkspace(
  paths: StoragePaths,
  input: CloneWorkspaceInput,
): Promise<WorkspaceRecord> {
  const name = input.name.trim();
  assertSafeWorkspaceSegment(name, "Workspace name");
  if (input.repositoryIds.length === 0) {
    throw new CompulsiveError("INVALID_INPUT", "Select at least one repository to clone.");
  }
  if (new Set(input.repositoryIds).size !== input.repositoryIds.length) {
    throw new CompulsiveError("INVALID_INPUT", "Repository selection contains duplicates.");
  }
  const referenceRepositoryIds = input.referenceRepositoryIds ?? [];
  if (new Set(referenceRepositoryIds).size !== referenceRepositoryIds.length) {
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Reference repository selection contains duplicates.",
    );
  }
  const selectedIds = new Set(input.repositoryIds);
  if (referenceRepositoryIds.some((repositoryId) => !selectedIds.has(repositoryId))) {
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Every reference repository must be selected for cloning.",
    );
  }
  const branchName = input.branchName?.trim();
  if (input.branchName !== undefined && !branchName) {
    throw new CompulsiveError("INVALID_INPUT", "Clone branch name is required.");
  }
  const referenceIds = new Set(referenceRepositoryIds);

  const [config, workspaceRegistry, repositoryRegistry] = await Promise.all([
    readConfig(paths.config),
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { workspace: source } = findWorkspace(workspaceRegistry, input.sourceWorkspaceId);
  const targetPath = resolve(join(config.workspaceRoot, name));
  if (
    workspaceRegistry.workspaces.some(
      (workspace) => workspace.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace name already exists: ${name}`);
  }
  if (
    workspaceRegistry.workspaces.some((workspace) => resolve(workspace.absolutePath) === targetPath)
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace path is already registered: ${targetPath}`);
  }
  if (await fileExists(targetPath)) {
    throw new CompulsiveError("CONFLICT", `Workspace path already exists: ${targetPath}`);
  }

  const selected = input.repositoryIds.map((repositoryId) => {
    const member = source.members.find((candidate) => candidate.repositoryId === repositoryId);
    if (!member) {
      throw new CompulsiveError(
        "INVALID_INPUT",
        "Every selected repository must belong to the source Workspace.",
      );
    }
    return {
      member,
      repository: findRepository(repositoryRegistry.repositories, repositoryId),
      startPoint: "",
      reference: referenceIds.has(repositoryId),
    };
  });

  if (branchName) {
    const developmentRepository = selected.find((candidate) => !candidate.reference)?.repository;
    if (developmentRepository) {
      const validBranch = await runGit(["check-ref-format", "--branch", branchName], {
        cwd: developmentRepository.absolutePath,
        allowFailure: true,
      });
      if (validBranch.exitCode !== 0) {
        throw new CompulsiveError("INVALID_INPUT", `Invalid clone branch name: ${branchName}`);
      }
    }
  }

  for (const selectedRepository of selected) {
    const { repository } = selectedRepository;
    const origin = await runGit(["config", "--get", "remote.origin.url"], {
      cwd: repository.absolutePath,
      allowFailure: true,
    });
    if (origin.exitCode !== 0 || !origin.stdout) {
      throw new CompulsiveError("CONFLICT", `Repository has no origin remote: ${repository.name}`);
    }
    const remoteBranch = await fetchOriginDefaultBranch(repository.absolutePath).catch((error) => {
      throw new CompulsiveError(
        "CONFLICT",
        `Unable to resolve the default branch for origin: ${repository.name}`,
        { cause: error },
      );
    });
    const commit = await runGit(["rev-parse", "--verify", `${remoteBranch}^{commit}`], {
      cwd: repository.absolutePath,
      allowFailure: true,
    });
    if (commit.exitCode !== 0 || !commit.stdout) {
      throw new CompulsiveError(
        "CONFLICT",
        `Remote default branch ${remoteBranch} is unavailable: ${repository.name}`,
      );
    }
    selectedRepository.startPoint = remoteBranch;
  }

  const target = await createWorkspace(paths, { name });
  const createdBranches: Array<{ repositoryPath: string; branch: string }> = [];
  try {
    let current = target;
    for (const { member, repository, startPoint, reference } of selected) {
      current = await addWorkspaceMember(paths, {
        workspaceId: target.id,
        repositoryId: repository.id,
        alias: member.alias,
        mode: "worktree",
        ...(reference
          ? { detached: true }
          : { ...(branchName ? { branch: branchName } : {}), createBranch: true }),
        startPoint,
      });
      const created = current.members.at(-1);
      if (created?.mode === "worktree" && !created.detached) {
        createdBranches.push({ repositoryPath: repository.absolutePath, branch: created.branch });
      }
    }
    return current;
  } catch (error) {
    try {
      await deleteWorkspace(paths, target.id);
      for (const created of createdBranches) {
        await runGit(["branch", "-D", "--", created.branch], {
          cwd: created.repositoryPath,
          allowFailure: true,
        });
      }
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace clone failed and the partial target could not be fully removed.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
}

export async function removeWorkspaceMember(
  paths: StoragePaths,
  input: RemoveWorkspaceMemberInput,
): Promise<WorkspaceRecord> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const memberIndex = workspace.members.findIndex(
    (member) => member.repositoryId === input.repositoryId,
  );
  if (memberIndex === -1) {
    throw new CompulsiveError("NOT_FOUND", "Repository is not a member of this workspace.");
  }
  const member = workspace.members[memberIndex]!;
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  const memberPath = join(workspace.absolutePath, member.alias);
  let linkTarget: string | undefined;
  let worktreeState: { memberPath: string; worktreePath: string; linked: boolean } | undefined;
  if (member.mode === "worktree") {
    worktreeState = await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
    await assertCleanWorktree(worktreeState.worktreePath);
    if (worktreeState.linked) {
      await unlinkExpectedLink(worktreeState.memberPath, worktreeState.worktreePath);
    }
    try {
      await removeGitWorktree(repository.absolutePath, worktreeState.worktreePath);
    } catch (error) {
      if (worktreeState.linked) {
        await createVerifiedLink(worktreeState.memberPath, worktreeState.worktreePath);
      }
      throw error;
    }
  } else {
    linkTarget = await verifyManagedLink(memberPath, repository.absolutePath);
    await unlinkExpectedLink(memberPath, linkTarget);
  }
  const updated: WorkspaceRecord = {
    ...workspace,
    members: workspace.members.filter((_, candidateIndex) => candidateIndex !== memberIndex),
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      if (member.mode === "worktree") {
        await addGitWorktree(
          repository.absolutePath,
          member.worktreePath,
          member.branch,
          false,
          undefined,
          member.branch,
          member.detached,
        );
        if (worktreeState?.linked) {
          await createVerifiedLink(worktreeState.memberPath, member.worktreePath);
        }
      } else {
        await symlink(linkTarget!, memberPath);
      }
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the removed member could not be restored.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
  return updated;
}

export async function promoteWorkspaceReference(
  paths: StoragePaths,
  input: PromoteWorkspaceReferenceInput,
): Promise<WorkspaceRecord> {
  const branch = input.branch.trim();
  if (!branch) throw new CompulsiveError("INVALID_INPUT", "Development branch is required.");
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const memberIndex = workspace.members.findIndex(
    (member) => member.repositoryId === input.repositoryId,
  );
  if (memberIndex === -1) {
    throw new CompulsiveError("NOT_FOUND", "Repository is not a member of this workspace.");
  }
  const member = workspace.members[memberIndex]!;
  if (member.mode !== "worktree" || !member.detached) {
    throw new CompulsiveError("CONFLICT", "Workspace member is not a reference worktree.");
  }
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
  const validBranch = await runGit(["check-ref-format", "--branch", branch], {
    cwd: repository.absolutePath,
    allowFailure: true,
  });
  if (validBranch.exitCode !== 0) {
    throw new CompulsiveError("INVALID_INPUT", `Invalid development branch: ${branch}`);
  }
  const existingBranch = await runGit(["show-ref", "--verify", `refs/heads/${branch}`], {
    cwd: repository.absolutePath,
    allowFailure: true,
  });
  const createdBranch = existingBranch.exitCode !== 0;
  const originalCommit = (await runGit(["rev-parse", "HEAD"], { cwd: member.worktreePath })).stdout;
  const rollback = async () => {
    await runGit(["switch", "--detach", originalCommit], { cwd: member.worktreePath });
    if (createdBranch) {
      await runGit(["branch", "-D", "--", branch], { cwd: repository.absolutePath });
    }
  };
  try {
    await runGit(
      createdBranch ? ["switch", "-c", branch] : ["switch", "--ignore-other-worktrees", branch],
      { cwd: member.worktreePath },
    );
    const upstream = await runGit(["rev-parse", "--verify", `${member.branch}^{commit}`], {
      cwd: repository.absolutePath,
      allowFailure: true,
    });
    if (upstream.exitCode === 0) {
      await runGit(["branch", "--set-upstream-to", member.branch, branch], {
        cwd: member.worktreePath,
      });
    }
    await verifyManagedWorktree(member.worktreePath, repository.absolutePath, branch);
  } catch (error) {
    await rollback().catch(() => undefined);
    throw error;
  }

  const updatedMember: WorkspaceMember = {
    repositoryId: member.repositoryId,
    alias: member.alias,
    mode: "worktree",
    branch,
    worktreePath: member.worktreePath,
  };
  const updated: WorkspaceRecord = {
    ...workspace,
    members: workspace.members.map((candidate, candidateIndex) =>
      candidateIndex === memberIndex ? updatedMember : candidate,
    ),
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      await rollback();
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the reference could not be restored.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
  return updated;
}

export async function convertWorkspaceToReference(
  paths: StoragePaths,
  input: ConvertWorkspaceToReferenceInput,
): Promise<WorkspaceRecord> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const memberIndex = workspace.members.findIndex(
    (member) => member.repositoryId === input.repositoryId,
  );
  if (memberIndex === -1) {
    throw new CompulsiveError("NOT_FOUND", "Repository is not a member of this workspace.");
  }
  const member = workspace.members[memberIndex]!;
  if (member.mode !== "worktree" || member.detached) {
    throw new CompulsiveError("CONFLICT", "Workspace member is not a development worktree.");
  }
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  const state = await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
  await assertCleanWorktree(state.worktreePath);
  const remoteBranch = await fetchOriginDefaultBranch(repository.absolutePath);
  await runGit(["switch", "--detach", remoteBranch], { cwd: state.worktreePath });
  try {
    await verifyManagedWorktree(state.worktreePath, repository.absolutePath, remoteBranch, true);
  } catch (error) {
    await runGit(["switch", member.branch], { cwd: state.worktreePath }).catch(() => undefined);
    throw error;
  }

  const referenceMember: WorkspaceMember = {
    repositoryId: member.repositoryId,
    alias: member.alias,
    mode: "worktree",
    branch: remoteBranch,
    worktreePath: member.worktreePath,
    detached: true,
  };
  const updated: WorkspaceRecord = {
    ...workspace,
    members: workspace.members.map((candidate, candidateIndex) =>
      candidateIndex === memberIndex ? referenceMember : candidate,
    ),
    updatedAt: new Date().toISOString(),
  };
  workspaceRegistry.workspaces[index] = updated;
  try {
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    try {
      await runGit(["switch", member.branch], { cwd: state.worktreePath });
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace index update failed and the development branch could not be restored.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
  return updated;
}

async function getDevelopmentWorktree(
  paths: StoragePaths,
  input: WorkspaceGitActionInput,
): Promise<{
  member: Extract<WorkspaceMember, { mode: "worktree" }>;
  repository: RepositoryRecord;
}> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { workspace } = findWorkspace(workspaceRegistry, input.workspaceId);
  const member = workspace.members.find(({ repositoryId }) => repositoryId === input.repositoryId);
  if (!member)
    throw new CompulsiveError("NOT_FOUND", "Repository is not a member of this workspace.");
  if (member.mode !== "worktree" || member.detached) {
    throw new CompulsiveError("CONFLICT", "Workspace member is not a development worktree.");
  }
  const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
  await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
  await assertCleanWorktree(member.worktreePath);
  return { member, repository };
}

export async function rebaseWorkspaceMember(
  paths: StoragePaths,
  input: WorkspaceGitActionInput,
): Promise<void> {
  const { member, repository } = await getDevelopmentWorktree(paths, input);
  const remoteBranch = await fetchOriginDefaultBranch(repository.absolutePath);
  await runGit(["rebase", remoteBranch], { cwd: member.worktreePath });
}

export async function pushWorkspaceMember(
  paths: StoragePaths,
  input: WorkspaceGitActionInput,
): Promise<void> {
  const { member, repository } = await getDevelopmentWorktree(paths, input);
  const remoteBranch = await originBranch(repository.absolutePath, member.branch, true);
  if (remoteBranch) await runGit(["rebase", remoteBranch], { cwd: member.worktreePath });
  await runGit(["push", "-u", "origin", `HEAD:refs/heads/${member.branch}`], {
    cwd: member.worktreePath,
  });
}

export async function getWorkspaceStatus(
  paths: StoragePaths,
  id: WorkspaceId,
  fetchRemote = false,
): Promise<WorkspaceStatusResult> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { workspace } = findWorkspace(workspaceRegistry, id);
  const members = await Promise.all(
    workspace.members.map(async (member): Promise<WorkspaceMemberStatus> => {
      const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
      const path = member.mode === "worktree" ? member.worktreePath : repository.absolutePath;
      try {
        const [currentBranch, status, conflicts] = await Promise.all([
          runGit(["branch", "--show-current"], { cwd: path }),
          runGit(["status", "--porcelain=v1", "--untracked-files=all"], { cwd: path }),
          runGit(["diff", "--name-only", "--diff-filter=U", "--"], { cwd: path }),
        ]);
        const defaultBranch = fetchRemote
          ? await fetchOriginDefaultBranch(repository.absolutePath)
          : await cachedOriginDefaultBranch(repository.absolutePath);
        let ahead: number | undefined;
        let behind: number | undefined;
        const pushBranch =
          member.mode === "worktree" && !member.detached
            ? await originBranch(repository.absolutePath, member.branch, fetchRemote)
            : undefined;
        const upstream = pushBranch ?? (await currentUpstream(path));
        let unpushed: number | undefined;
        let comparisonError: string | undefined;
        if (defaultBranch) {
          const comparison = await runGit(
            ["rev-list", "--left-right", "--count", `HEAD...${defaultBranch}`],
            { cwd: path, allowFailure: true },
          );
          if (comparison.exitCode === 0) {
            [ahead, behind] = comparison.stdout.split(/\s+/).map(Number);
          } else
            comparisonError = comparison.stderr || "Unable to compare with the default branch.";
        } else comparisonError = "Origin default branch is unavailable.";
        if (upstream) {
          const pendingPush = await runGit(["rev-list", "--count", `${upstream}..HEAD`], {
            cwd: path,
            allowFailure: true,
          });
          if (pendingPush.exitCode === 0) unpushed = Number(pendingPush.stdout);
        }
        return {
          repositoryId: member.repositoryId,
          branch: currentBranch.stdout || (member.mode === "worktree" ? member.branch : "detached"),
          detached: member.mode === "worktree" && member.detached === true,
          ...(defaultBranch ? { defaultBranch } : {}),
          ...(ahead === undefined ? {} : { ahead }),
          ...(behind === undefined ? {} : { behind }),
          ...(upstream ? { upstream } : {}),
          ...(unpushed === undefined ? {} : { unpushed }),
          changes: status.stdout ? status.stdout.split("\n") : [],
          conflicts: conflicts.stdout ? conflicts.stdout.split("\n") : [],
          ...(comparisonError ? { comparisonError } : {}),
        };
      } catch (error) {
        return {
          repositoryId: member.repositoryId,
          branch: member.mode === "worktree" ? member.branch : "unknown",
          detached: member.mode === "worktree" && member.detached === true,
          changes: [],
          conflicts: [],
          comparisonError: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
  const result = { workspaceId: workspace.id, checkedAt: new Date().toISOString(), members };
  const statusRegistry = await readWorkspaceStatusRegistry(paths.workspaceStatuses);
  statusRegistry.statuses = [
    ...statusRegistry.statuses.filter(({ workspaceId }) => workspaceId !== workspace.id),
    result,
  ];
  await writeJsonAtomic(paths.workspaceStatuses, statusRegistry);
  return result;
}

export async function syncWorkspace(
  paths: StoragePaths,
  id: WorkspaceId,
): Promise<WorkspaceSyncResult> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, id);
  const repaired: RepositoryRecord["id"][] = [];
  const issues: WorkspaceSyncIssue[] = [];
  const rollbacks: Array<() => Promise<void>> = [];

  for (const member of workspace.members) {
    const repository = repositoryRegistry.repositories.find(
      (record) => record.id === member.repositoryId,
    );
    if (!repository) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "MISSING_REPOSITORY",
        message: "Referenced repository is not registered.",
      });
      continue;
    }
    if (member.mode === "worktree") {
      try {
        if (isLegacyWorktree(workspace, member)) {
          await verifyManagedWorktree(
            member.worktreePath,
            repository.absolutePath,
            member.branch,
            member.detached,
          );
          continue;
        }
        const expectedWorktreePath = managedWorktreePath(repository.absolutePath, workspace);
        if (resolve(member.worktreePath) !== resolve(expectedWorktreePath)) {
          throw new CompulsiveError(
            "CONFLICT",
            `Managed worktree path is unexpected: ${member.worktreePath}`,
          );
        }
        await verifyManagedWorktree(
          member.worktreePath,
          repository.absolutePath,
          member.branch,
          member.detached,
        );
        const memberPath = workspaceMemberPath(workspace, member);
        if (!(await pathEntryExists(memberPath))) {
          await createVerifiedLink(memberPath, member.worktreePath);
          rollbacks.push(() => unlinkExpectedLink(memberPath, member.worktreePath));
          repaired.push(member.repositoryId);
          continue;
        }
        await verifyExpectedLink(memberPath, member.worktreePath);
      } catch (error) {
        issues.push({
          repositoryId: member.repositoryId,
          alias: member.alias,
          code: "CONFLICT",
          message: error instanceof Error ? error.message : "Git worktree verification failed.",
        });
      }
      continue;
    }
    const memberPath = join(workspace.absolutePath, member.alias);
    const expectedTarget = await realpath(repository.absolutePath).catch(() => undefined);
    if (!expectedTarget) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "MISSING_REPOSITORY",
        message: `Repository path no longer exists: ${repository.absolutePath}`,
      });
      continue;
    }
    if (!(await pathEntryExists(memberPath))) {
      await createVerifiedLink(memberPath, expectedTarget);
      rollbacks.push(() => unlinkExpectedLink(memberPath, expectedTarget));
      repaired.push(member.repositoryId);
      continue;
    }
    const entry = await lstat(memberPath);
    if (!entry.isSymbolicLink()) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "CONFLICT",
        message: `Workspace member path is occupied: ${memberPath}`,
      });
      continue;
    }
    const previousTarget = await readlink(memberPath);
    const resolvedTarget = await realpath(memberPath).catch(() => undefined);
    if (resolvedTarget === expectedTarget) continue;
    if (resolvedTarget || !isAbsolute(previousTarget)) {
      issues.push({
        repositoryId: member.repositoryId,
        alias: member.alias,
        code: "CONFLICT",
        message: `Workspace member link points elsewhere: ${memberPath}`,
      });
      continue;
    }
    await unlinkExpectedLink(memberPath, previousTarget);
    await createVerifiedLink(memberPath, expectedTarget);
    rollbacks.push(async () => {
      await unlinkExpectedLink(memberPath, expectedTarget);
      await symlink(previousTarget, memberPath);
    });
    repaired.push(member.repositoryId);
  }

  let resultWorkspace = workspace;
  if (repaired.length > 0) {
    resultWorkspace = { ...workspace, updatedAt: new Date().toISOString() };
    workspaceRegistry.workspaces[index] = resultWorkspace;
    try {
      await writeJsonAtomic(paths.workspaces, workspaceRegistry);
    } catch (error) {
      const rollbackErrors = await runRollbacks(rollbacks);
      if (rollbackErrors.length > 0) {
        throw new CompulsiveError(
          "FILESYSTEM_FAILED",
          "Workspace sync failed and one or more repaired links could not be restored.",
          { cause: error, rollbackErrors },
        );
      }
      throw error;
    }
  }
  return { workspace: resultWorkspace, repaired, issues };
}

export async function migrateWorkspaces(
  paths: StoragePaths,
  ids?: WorkspaceId[],
): Promise<WorkspaceMigrationResult> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const selectedIds = ids ? new Set(ids) : undefined;
  if (selectedIds) {
    for (const id of selectedIds) findWorkspace(workspaceRegistry, id);
  }
  const selected = workspaceRegistry.workspaces.filter(
    (workspace) => !selectedIds || selectedIds.has(workspace.id),
  );
  const candidates = selected.flatMap((workspace) =>
    workspace.members.flatMap((member, memberIndex) => {
      if (member.mode !== "worktree" || !isLegacyWorktree(workspace, member)) return [];
      const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
      return [
        {
          workspace,
          workspaceIndex: workspaceRegistry.workspaces.indexOf(workspace),
          member,
          memberIndex,
          repositoryPath: repository.absolutePath,
          source: workspaceMemberPath(workspace, member),
          target: managedWorktreePath(repository.absolutePath, workspace),
        },
      ];
    }),
  );

  const legacyPaths = workspaceRegistry.workspaces.flatMap((workspace) =>
    workspace.members
      .filter(
        (member): member is Extract<WorkspaceMember, { mode: "worktree" }> =>
          member.mode === "worktree" && isLegacyWorktree(workspace, member),
      )
      .map((member) => workspaceMemberPath(workspace, member)),
  );
  const targets = new Set<string>();
  const inheritedUpstreams = new Map<string, string>();
  for (const candidate of candidates) {
    await verifyManagedWorktree(
      candidate.source,
      candidate.repositoryPath,
      candidate.member.branch,
      candidate.member.detached,
    );
    if (await pathEntryExists(candidate.target)) {
      throw new CompulsiveError(
        "CONFLICT",
        `Managed worktree path already exists: ${candidate.target}`,
      );
    }
    const normalizedTarget = resolve(candidate.target);
    if (targets.has(normalizedTarget)) {
      throw new CompulsiveError(
        "CONFLICT",
        `Managed worktree target is duplicated: ${candidate.target}`,
      );
    }
    targets.add(normalizedTarget);
    const [worktreeUpstream, repositoryUpstream] = await Promise.all([
      currentUpstream(candidate.source),
      currentUpstream(candidate.repositoryPath),
    ]);
    if (!worktreeUpstream && repositoryUpstream) {
      inheritedUpstreams.set(candidate.source, repositoryUpstream);
    }
    const overlappingPath = legacyPaths.find(
      (path) =>
        resolve(path) !== resolve(candidate.source) &&
        (pathContains(candidate.source, path) || pathContains(path, candidate.source)),
    );
    if (overlappingPath) {
      throw new CompulsiveError(
        "CONFLICT",
        `Nested legacy worktrees must be relocated before migration: ${candidate.source} and ${overlappingPath}`,
      );
    }
  }

  candidates.sort((left, right) => right.source.length - left.source.length);
  const rollbacks: Array<() => Promise<void>> = [];
  const changedWorkspaces = new Set<number>();
  try {
    for (const candidate of candidates) {
      await ensureManagedWorktreeRoot(candidate.repositoryPath);
      await moveGitWorktree(candidate.repositoryPath, candidate.source, candidate.target);
      let trackingSet = false;
      rollbacks.push(async () => {
        if (await pathEntryExists(candidate.source)) {
          await unlinkExpectedLink(candidate.source, await realpath(candidate.target));
        }
        if (trackingSet) {
          await runGit(["branch", "--unset-upstream", candidate.member.branch], {
            cwd: candidate.target,
          });
        }
        await moveGitWorktree(candidate.repositoryPath, candidate.target, candidate.source);
      });
      await createVerifiedLink(candidate.source, candidate.target);
      const upstream = inheritedUpstreams.get(candidate.source);
      if (upstream) {
        await runGit(["branch", "--set-upstream-to", upstream, candidate.member.branch], {
          cwd: candidate.target,
        });
        trackingSet = true;
      }
      const workspace = workspaceRegistry.workspaces[candidate.workspaceIndex]!;
      workspace.members[candidate.memberIndex] = {
        ...candidate.member,
        worktreePath: await realpath(candidate.target),
      };
      changedWorkspaces.add(candidate.workspaceIndex);
    }
    const now = new Date().toISOString();
    for (const index of changedWorkspaces) {
      workspaceRegistry.workspaces[index] = {
        ...workspaceRegistry.workspaces[index]!,
        updatedAt: now,
      };
    }
    if (candidates.length > 0) await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    const rollbackErrors = await runRollbacks(rollbacks);
    if (rollbackErrors.length > 0) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace migration failed and one or more worktrees could not be restored.",
        { cause: error, rollbackErrors },
      );
    }
    throw error;
  }

  return {
    workspaces: workspaceRegistry.workspaces.filter(
      (workspace) => !selectedIds || selectedIds.has(workspace.id),
    ),
    migrated: candidates.length,
  };
}

export async function deleteWorkspace(paths: StoragePaths, id: WorkspaceId): Promise<void> {
  const [workspaceRegistry, repositoryRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const { index, workspace } = findWorkspace(workspaceRegistry, id);
  const links: Array<{ path: string; target: string }> = [];
  const worktrees: Array<{
    memberPath: string;
    path: string;
    branch: string;
    detached?: true;
    repositoryPath: string;
    linked: boolean;
  }> = [];
  for (const member of workspace.members) {
    if (member.mode === "worktree") {
      const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
      const state = await verifyWorkspaceWorktree(workspace, member, repository.absolutePath);
      await assertCleanWorktree(state.worktreePath);
      worktrees.push({
        memberPath: state.memberPath,
        path: state.worktreePath,
        branch: member.branch,
        ...(member.detached ? { detached: true as const } : {}),
        repositoryPath: repository.absolutePath,
        linked: state.linked,
      });
      continue;
    }
    const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
    const path = join(workspace.absolutePath, member.alias);
    links.push({ path, target: await verifyManagedLink(path, repository.absolutePath) });
  }

  const removed: Array<{ path: string; target: string }> = [];
  const removedWorktrees: typeof worktrees = [];
  try {
    for (const link of links) {
      await unlinkExpectedLink(link.path, link.target);
      removed.push(link);
    }
    for (const worktree of worktrees) {
      if (worktree.linked) await unlinkExpectedLink(worktree.memberPath, worktree.path);
      try {
        await removeGitWorktree(worktree.repositoryPath, worktree.path);
      } catch (error) {
        if (worktree.linked) await createVerifiedLink(worktree.memberPath, worktree.path);
        throw error;
      }
      removedWorktrees.push(worktree);
    }
    workspaceRegistry.workspaces.splice(index, 1);
    await writeJsonAtomic(paths.workspaces, workspaceRegistry);
  } catch (error) {
    const rollbackErrors = await runRollbacks([
      ...removed.map((link) => () => symlink(link.target, link.path)),
      ...removedWorktrees.map((worktree) => async () => {
        await addGitWorktree(
          worktree.repositoryPath,
          worktree.path,
          worktree.branch,
          false,
          undefined,
          worktree.branch,
          worktree.detached,
        );
        if (worktree.linked) await createVerifiedLink(worktree.memberPath, worktree.path);
      }),
    ]);
    if (rollbackErrors.length > 0) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace deletion failed and one or more members could not be restored.",
        { cause: error, rollbackErrors },
      );
    }
    throw error;
  }

  const entries = await readdir(workspace.absolutePath);
  if (entries.length === 1 && entries[0] === ".DS_Store") {
    await unlink(join(workspace.absolutePath, ".DS_Store"));
    await rmdir(workspace.absolutePath);
  } else if (entries.length === 0) {
    await rmdir(workspace.absolutePath);
  }
  try {
    const statusRegistry = await readWorkspaceStatusRegistry(paths.workspaceStatuses);
    statusRegistry.statuses = statusRegistry.statuses.filter(
      ({ workspaceId }) => workspaceId !== workspace.id,
    );
    await writeJsonAtomic(paths.workspaceStatuses, statusRegistry);
  } catch {
    // Cache cleanup must not turn a completed workspace deletion into a failure.
  }
}
