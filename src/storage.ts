import { constants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { CompulsiveError } from "./errors.js";
import type { ManagerConfig, RepositoryRegistry } from "./types.js";

export interface StoragePaths {
  config: string;
  registry: string;
}

export function createStoragePaths(dataDir: string): StoragePaths {
  return {
    config: join(dataDir, "config.json"),
    registry: join(dataDir, "repositories.json"),
  };
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, undefined, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, path);
  } catch (error) {
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to write ${path}.`, { cause: error });
  }
}

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to read ${path}.`, { cause: error });
  }
}

export async function readConfig(path: string): Promise<ManagerConfig> {
  if (!(await fileExists(path))) {
    throw new CompulsiveError("NOT_INITIALIZED", "Run `cpl init` before using this command.");
  }
  const value = await readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("rootDir" in value) ||
    typeof value.rootDir !== "string" ||
    !("scanRoots" in value) ||
    !Array.isArray(value.scanRoots) ||
    !value.scanRoots.every((item) => typeof item === "string")
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Configuration has an unsupported format.");
  }
  return value as ManagerConfig;
}

export async function readRegistry(path: string): Promise<RepositoryRegistry> {
  const value = await readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("repositories" in value) ||
    !Array.isArray(value.repositories)
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Repository index has an unsupported format.");
  }
  return value as RepositoryRegistry;
}
