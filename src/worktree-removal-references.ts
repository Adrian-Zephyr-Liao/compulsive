import { lstat, readlink, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { readWorkspaceRegistry, writeJsonAtomic, type StoragePaths } from "./storage.js";
import type { WorkspaceRecord } from "./types.js";

async function pointsTo(path: string, target: string): Promise<boolean> {
  try {
    return (await realpath(path)) === target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      return resolve(dirname(path), await readlink(path)) === target;
    } catch (error) {
      if (["ENOENT", "EINVAL"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
      throw error;
    }
  }
}

export async function findWorktreeReferences(workspaces: WorkspaceRecord[], target: string) {
  const references: Array<{ workspaceId: string; alias: string; link: string }> = [];
  for (const workspace of workspaces) {
    for (const member of workspace.members) {
      const link = join(workspace.absolutePath, member.alias);
      if (
        (member.mode === "worktree" &&
          (resolve(member.worktreePath) === target ||
            (await pointsTo(member.worktreePath, target)))) ||
        (await pointsTo(link, target))
      ) {
        references.push({ workspaceId: workspace.id, alias: member.alias, link });
      }
    }
  }
  return references;
}

export async function detachWorktreeReferences(paths: StoragePaths, target: string): Promise<void> {
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const references = await findWorktreeReferences(registry.workspaces, target);
  if (!references.length) return;
  for (const workspace of registry.workspaces) {
    const removed = references.filter((entry) => entry.workspaceId === workspace.id);
    if (!removed.length) continue;
    workspace.members = workspace.members.filter(
      (member) => !removed.some((entry) => entry.alias === member.alias),
    );
    workspace.updatedAt = new Date().toISOString();
  }
  await writeJsonAtomic(paths.workspaces, registry);
  for (const reference of references) {
    const entry = await lstat(reference.link).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    // Preserve unexpected normal files and links that now point somewhere else.
    if (entry?.isSymbolicLink() && (await pointsTo(reference.link, target)))
      await unlink(reference.link);
    else if (entry)
      throw new Error(
        `Worktree removed, but unexpected member path was retained: ${reference.link}`,
      );
  }
}
