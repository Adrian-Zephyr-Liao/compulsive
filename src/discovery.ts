import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { CompulsiveError } from "./errors.js";

const skippedDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "vendor",
  ".cache",
]);

async function isRepositoryRoot(path: string): Promise<boolean> {
  try {
    const marker = await lstat(join(path, ".git"));
    return marker.isDirectory() || marker.isFile();
  } catch {
    return false;
  }
}

async function walk(path: string, repositories: string[]): Promise<void> {
  if (await isRepositoryRoot(path)) {
    repositories.push(await realpath(path));
    return;
  }

  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to scan ${path}.`, { cause: error });
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || skippedDirectories.has(entry.name)) {
      continue;
    }
    await walk(join(path, entry.name), repositories);
  }
}

export async function discoverRepositoryRoots(paths: string[]): Promise<string[]> {
  const repositories: string[] = [];
  for (const path of paths) {
    await walk(await realpath(path), repositories);
  }
  return [...new Set(repositories)];
}
