import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import { CompulsiveError } from "../errors.js";
import type { RepositoryManager } from "../types.js";

export interface ProjectFileInput {
  workspaceId: string;
  repositoryId: string;
  path: string;
}

const hiddenNames = new Set([
  ".git",
  ".worktrees",
  "node_modules",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".ssh",
]);

export function restrictedProjectName(name: string): boolean {
  return (
    hiddenNames.has(name.toLowerCase()) ||
    /^\.env(?:\.|$)/i.test(name) ||
    /(?:\.(?:pem|key|p12|pfx)|^id_(?:rsa|ed25519|ecdsa))$/i.test(name)
  );
}

export function assertProjectRelativePath(path: string, allowRoot = true): void {
  if (
    (!allowRoot && !path) ||
    path.length > 4096 ||
    isAbsolute(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    (path !== "" &&
      path
        .split("/")
        .some((part) => !part || part === "." || part === ".." || restrictedProjectName(part)))
  )
    throw new CompulsiveError("INVALID_INPUT", "This path is not available in the local editor.");
}

export function projectContains(root: string, target: string): boolean {
  const child = relative(root, target);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

export async function resolveProjectPath(
  manager: RepositoryManager,
  input: ProjectFileInput,
  allowMissingLeaf = false,
) {
  assertProjectRelativePath(input.path);
  const workspace = (await manager.searchWorkspaces()).find(({ id }) => id === input.workspaceId);
  const member = workspace?.members.find(({ repositoryId }) => repositoryId === input.repositoryId);
  const repository = (await manager.search()).find(({ id }) => id === input.repositoryId);
  if (!member || !repository)
    throw new CompulsiveError("NOT_FOUND", "Repository is not a member of this requirement.");
  const registeredRoot = member.mode === "worktree" ? member.worktreePath : repository.absolutePath;
  if ((await lstat(registeredRoot)).isSymbolicLink())
    throw new CompulsiveError(
      "INVALID_INPUT",
      "The repository root was replaced by a symbolic link.",
    );
  const root = await realpath(registeredRoot);
  let target = root;
  const parts = input.path ? input.path.split("/") : [];
  for (const [index, part] of parts.entries()) {
    target = join(target, part);
    try {
      if ((await lstat(target)).isSymbolicLink())
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Symbolic links are not available in the local editor.",
        );
    } catch (error) {
      if (
        allowMissingLeaf &&
        index === parts.length - 1 &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return { root, target, member, repository };
      throw error;
    }
  }
  const canonical = await realpath(target);
  if (!projectContains(root, canonical))
    throw new CompulsiveError("INVALID_INPUT", "Path is outside the repository.");
  return { root, target: canonical, member, repository };
}

const locks = new Map<string, Promise<void>>();

export async function withProjectLock<T>(root: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(root) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(root, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(root) === current) locks.delete(root);
  }
}
