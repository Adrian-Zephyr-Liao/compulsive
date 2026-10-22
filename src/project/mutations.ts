import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, opendir, realpath, rename, unlink, rmdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { CompulsiveError } from "../errors.js";
import { projectTextLimit, readProjectFile } from "./files.js";
import {
  assertProjectRelativePath,
  resolveProjectPath,
  withProjectLock,
  type ProjectFileInput,
} from "./paths.js";
import type { RepositoryManager } from "../types.js";
import { moveProjectItemToTrash } from "./trash.js";

function identity(value: Awaited<ReturnType<typeof lstat>>): string {
  return createHash("sha256")
    .update(`${value.dev}:${value.ino}:${value.birthtimeMs}:${value.mtimeMs}:${value.size}`)
    .digest("hex");
}

export async function inspectProjectItem(manager: RepositoryManager, input: ProjectFileInput) {
  assertProjectRelativePath(input.path, false);
  const { target } = await resolveProjectPath(manager, input);
  const info = await lstat(target);
  return { path: input.path, directory: info.isDirectory(), identity: identity(info) };
}

export async function saveProjectFile(
  manager: RepositoryManager,
  input: ProjectFileInput & { content: string; expectedVersion: string },
) {
  assertProjectRelativePath(input.path, false);
  if (Buffer.byteLength(input.content, "utf8") > projectTextLimit || input.content.includes("\0"))
    throw new CompulsiveError("INVALID_INPUT", "Only UTF-8 text files up to 4 MiB can be saved.");
  const { root } = await resolveProjectPath(manager, input);
  return withProjectLock(root, async () => {
    const { target } = await resolveProjectPath(manager, input);
    const current = await readProjectFile(manager, input);
    if (current.version !== input.expectedVersion)
      throw new CompulsiveError(
        "CONFLICT",
        "This file changed on disk. Compare or reload it before saving; no file was overwritten.",
      );
    const mode = (await lstat(target)).mode & 0o777;
    const temporary = join(dirname(target), `.cpl-save-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", mode);
      try {
        await handle.writeFile(input.content, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      if (
        (await realpath(dirname(target))) !== dirname(target) ||
        (await readProjectFile(manager, input)).version !== input.expectedVersion
      )
        throw new CompulsiveError(
          "CONFLICT",
          "The file or its directory changed while saving. No file was overwritten.",
        );
      await rename(temporary, target);
      return await readProjectFile(manager, input);
    } finally {
      await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
    }
  });
}

export async function createProjectItem(
  manager: RepositoryManager,
  input: ProjectFileInput & { directory: boolean },
) {
  assertProjectRelativePath(input.path, false);
  const { root } = await resolveProjectPath(manager, { ...input, path: "" });
  return withProjectLock(root, async () => {
    const { target } = await resolveProjectPath(manager, input, true);
    if (input.directory) await mkdir(target);
    else {
      const handle = await open(target, "wx", 0o644);
      await handle.close();
    }
    return inspectProjectItem(manager, input);
  });
}

async function assertNotRepositoryTree(target: string): Promise<void> {
  if (!(await lstat(target)).isDirectory()) return;
  const pending = [target];
  let examined = 0;
  while (pending.length) {
    const next = pending.pop()!;
    const directory = await opendir(next);
    for await (const entry of directory) {
      if (++examined > 10000)
        throw new CompulsiveError(
          "CONFLICT",
          "This directory is too large to check safely. Manage it in an external editor.",
        );
      if (entry.name.toLowerCase() === ".git")
        throw new CompulsiveError(
          "CONFLICT",
          "A directory containing a Git repository cannot be renamed or trashed here.",
        );
      if (entry.isDirectory()) pending.push(join(next, entry.name));
    }
  }
}

export async function renameProjectItem(
  manager: RepositoryManager,
  input: ProjectFileInput & { destination: string; expectedIdentity: string },
) {
  assertProjectRelativePath(input.path, false);
  assertProjectRelativePath(input.destination, false);
  const { root } = await resolveProjectPath(manager, input);
  return withProjectLock(root, async () => {
    const { target } = await resolveProjectPath(manager, input);
    if ((await inspectProjectItem(manager, input)).identity !== input.expectedIdentity)
      throw new CompulsiveError("CONFLICT", "This item changed. Refresh before renaming it.");
    await assertNotRepositoryTree(target);
    const destination = (
      await resolveProjectPath(manager, { ...input, path: input.destination }, true)
    ).target;
    const source = await lstat(target);
    // Reserve the destination exclusively so another normal creator cannot win a check/rename race.
    try {
      if (source.isDirectory()) await mkdir(destination);
      else {
        const handle = await open(destination, "wx", source.mode & 0o777);
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new CompulsiveError("CONFLICT", "The destination already exists.");
      throw error;
    }
    const reserved = identity(await lstat(destination));
    let moved = false;
    try {
      if (
        identity(await lstat(destination)) !== reserved ||
        (await inspectProjectItem(manager, input)).identity !== input.expectedIdentity
      )
        throw new CompulsiveError(
          "CONFLICT",
          "An item changed while renaming. Refresh before retrying.",
        );
      await rename(target, destination);
      moved = true;
      return await inspectProjectItem(manager, { ...input, path: input.destination });
    } finally {
      if (!moved && identity(await lstat(destination)) === reserved) {
        if (source.isDirectory()) await rmdir(destination);
        else await unlink(destination);
      }
    }
  });
}

export async function trashProjectItem(
  manager: RepositoryManager,
  input: ProjectFileInput & { expectedIdentity: string; confirmedPath: string },
  moveToTrash: (path: string) => Promise<void> = moveProjectItemToTrash,
) {
  assertProjectRelativePath(input.path, false);
  if (input.confirmedPath !== input.path)
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Confirm the exact relative path before moving it to Trash.",
    );
  const { root } = await resolveProjectPath(manager, input);
  return withProjectLock(root, async () => {
    const { target } = await resolveProjectPath(manager, input);
    if ((await inspectProjectItem(manager, input)).identity !== input.expectedIdentity)
      throw new CompulsiveError(
        "CONFLICT",
        "This item changed. Refresh before moving it to Trash.",
      );
    await assertNotRepositoryTree(target);
    await moveToTrash(target);
    return { path: input.path, name: basename(target), trashed: true };
  });
}
