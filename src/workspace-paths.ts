import { CompulsiveError } from "./errors.js";
import {
  realpath,
  lstat,
  symlink,
  readlink,
  unlink,
  readFile,
  appendFile,
  mkdir,
} from "node:fs/promises";
import { resolve, isAbsolute, join, relative, sep } from "node:path";
import { type WorkspaceRecord, type WorkspaceMember } from "./types.js";
import { runGit } from "./git.js";

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

export async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

export async function pathEntryExists(path: string): Promise<boolean> {
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

export async function createVerifiedLink(
  memberPath: string,
  repositoryPath: string,
): Promise<void> {
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

export async function unlinkExpectedLink(memberPath: string, target: string): Promise<void> {
  const entry = await lstat(memberPath);
  if (!entry.isSymbolicLink() || (await readlink(memberPath)) !== target) {
    throw new CompulsiveError(
      "CONFLICT",
      `Workspace link changed before it could be removed: ${memberPath}`,
    );
  }
  await unlink(memberPath);
}

export async function runRollbacks(actions: Array<() => Promise<void>>): Promise<unknown[]> {
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

export async function verifyManagedLink(
  memberPath: string,
  repositoryPath: string,
): Promise<string> {
  return verifyExpectedLink(memberPath, repositoryPath);
}

export async function verifyExpectedLink(
  memberPath: string,
  expectedPath: string,
): Promise<string> {
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

export function managedWorktreePath(repositoryPath: string, workspace: WorkspaceRecord): string {
  return join(repositoryPath, worktreeDirectoryName, workspace.name);
}

export function workspaceMemberPath(workspace: WorkspaceRecord, member: WorkspaceMember): string {
  return join(workspace.absolutePath, member.alias);
}

export function isLegacyWorktree(workspace: WorkspaceRecord, member: WorkspaceMember): boolean {
  return (
    member.mode === "worktree" &&
    resolve(member.worktreePath) === resolve(workspaceMemberPath(workspace, member))
  );
}

export function pathContains(parent: string, child: string): boolean {
  const location = relative(resolve(parent), resolve(child));
  return (
    location === "" ||
    (!isAbsolute(location) && location !== ".." && !location.startsWith(`..${sep}`))
  );
}

export async function ensureManagedWorktreeRoot(repositoryPath: string): Promise<void> {
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
