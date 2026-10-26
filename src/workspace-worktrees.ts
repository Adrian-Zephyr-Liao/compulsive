import { runGit, readWorktreeBranch } from "./git.js";
import { realpath, lstat, writeFile, rename } from "node:fs/promises";
import { isAbsolute, resolve, join, relative, sep } from "node:path";
import {
  pathEntryExists,
  workspaceMemberPath,
  isLegacyWorktree,
  managedWorktreePath,
  verifyExpectedLink,
} from "./workspace-paths.js";
import { CompulsiveError } from "./errors.js";
import { type WorkspaceRecord, type WorkspaceMember } from "./types.js";
import { fileExists } from "./storage.js";

async function gitCommonDirectory(path: string): Promise<string> {
  const result = await runGit(["rev-parse", "--git-common-dir"], { cwd: path });
  return realpath(isAbsolute(result.stdout) ? result.stdout : resolve(path, result.stdout));
}

export async function verifyManagedWorktree(
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
      readWorktreeBranch(worktreePath),
    ]);
    if (
      (await realpath(memberRoot.stdout)) !== (await realpath(worktreePath)) ||
      memberCommon !== repositoryCommon ||
      currentBranch.branch !== (detached ? "" : branch)
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

export async function verifyWorkspaceWorktree(
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

export async function assertCleanWorktree(memberPath: string): Promise<void> {
  const status = await runGit(["status", "--porcelain"], { cwd: memberPath });
  if (status.stdout) {
    throw new CompulsiveError("CONFLICT", `Git worktree has uncommitted changes: ${memberPath}`);
  }
}

export async function addGitWorktree(
  repositoryPath: string,
  worktreePath: string,
  branch: string,
  createBranch: boolean,
  startPoint?: string,
  detached = false,
  track = false,
): Promise<void> {
  const arguments_ = ["-C", repositoryPath, "worktree", "add"];
  if (detached) {
    arguments_.push("--detach", "--", worktreePath, startPoint ?? branch);
  } else if (createBranch) {
    arguments_.push(track ? "--track" : "--no-track");
    arguments_.push("-b", branch, "--", worktreePath);
    if (startPoint) arguments_.push(startPoint);
  } else arguments_.push("--", worktreePath, branch);
  try {
    await runGit(arguments_);
  } catch (error) {
    if (error instanceof CompulsiveError && error.code === "GIT_FAILED") {
      throw new CompulsiveError("CONFLICT", error.message, error.details);
    }
    throw error;
  }
}

export async function removeGitWorktree(
  repositoryPath: string,
  worktreePath: string,
): Promise<void> {
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

export async function moveGitWorktree(
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
