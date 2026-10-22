import { constants } from "node:fs";
import { lstat, open, opendir, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { CompulsiveError } from "../errors.js";
import type { RepositoryManager } from "../types.js";
import {
  resolveProjectPath as projectPath,
  restrictedProjectName as restricted,
  projectContains as contained,
  type ProjectFileInput,
} from "./paths.js";

export interface ProjectEntry {
  name: string;
  path: string;
  directory: boolean;
}

export interface ProjectDirectory {
  path: string;
  entries: ProjectEntry[];
  truncated: boolean;
}

export interface ProjectFile {
  path: string;
  content: string;
  bytes: number;
  version: string;
}

export const projectTextLimit = 4 * 1024 * 1024;
const maxBytes = projectTextLimit;
const maxEntries = 1000;

export async function listProjectDirectory(
  manager: RepositoryManager,
  input: ProjectFileInput,
): Promise<ProjectDirectory> {
  const { target } = await projectPath(manager, input);
  const entries: ProjectEntry[] = [];
  let truncated = false;
  const directory = await opendir(target);
  let scanned = 0;
  for await (const entry of directory) {
    // Bound work even when a directory contains thousands of excluded entries.
    if (++scanned > maxEntries) {
      truncated = true;
      break;
    }
    if (restricted(entry.name) || (!entry.isDirectory() && !entry.isFile())) continue;
    entries.push({
      name: entry.name,
      path: input.path ? `${input.path}/${entry.name}` : entry.name,
      directory: entry.isDirectory(),
    });
  }
  entries.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
  return { path: input.path, entries, truncated };
}

export async function readProjectFile(
  manager: RepositoryManager,
  input: ProjectFileInput,
): Promise<ProjectFile> {
  const { root, target } = await projectPath(manager, input);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile())
      throw new CompulsiveError("INVALID_INPUT", "Only regular text files can be previewed.");
    if (before.size > maxBytes)
      throw new CompulsiveError(
        "INVALID_INPUT",
        "The local editor accepts text files up to 4 MiB. Open this file in VS Code.",
      );
    const buffer = Buffer.alloc(maxBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const result = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!result.bytesRead) break;
      bytesRead += result.bytesRead;
    }
    const currentPath = await realpath(target);
    const after = await lstat(target);
    if (
      !contained(root, currentPath) ||
      currentPath !== resolve(target) ||
      after.ino !== before.ino ||
      after.dev !== before.dev
    ) {
      throw new CompulsiveError("CONFLICT", "The file changed location. Reload the directory.");
    }
    if (bytesRead > maxBytes)
      throw new CompulsiveError(
        "INVALID_INPUT",
        "The local editor accepts text files up to 4 MiB.",
      );
    const data = buffer.subarray(0, bytesRead);
    if (data.includes(0))
      throw new CompulsiveError("INVALID_INPUT", "Binary files cannot be previewed as code.");
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
    } catch {
      throw new CompulsiveError("INVALID_INPUT", "Only UTF-8 text files can be previewed.");
    }
    return {
      path: input.path,
      content,
      bytes: bytesRead,
      version: createHash("sha256").update(data).digest("hex"),
    };
  } finally {
    await file.close();
  }
}
