import { constants } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
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
    !isAbsolute(value.rootDir) ||
    !("scanRoots" in value) ||
    !Array.isArray(value.scanRoots) ||
    !value.scanRoots.every((item) => typeof item === "string" && isAbsolute(item))
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Configuration has an unsupported format.");
  }
  return value as ManagerConfig;
}

function isSafeClassificationPath(value: unknown): value is string {
  if (typeof value !== "string" || isAbsolute(value)) return false;
  const segments = value.split("/");
  return (
    segments.length >= 2 &&
    segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function isRepositoryRecord(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    (record.kind === "remote" || record.kind === "local") &&
    typeof record.name === "string" &&
    record.name.length > 0 &&
    isSafeClassificationPath(record.classificationPath) &&
    typeof record.absolutePath === "string" &&
    isAbsolute(record.absolutePath) &&
    typeof record.isManaged === "boolean" &&
    typeof record.registeredAt === "string" &&
    typeof record.lastSeenAt === "string" &&
    (record.canonicalRemote === undefined || typeof record.canonicalRemote === "string") &&
    (record.remoteUrl === undefined ||
      (typeof record.remoteUrl === "string" &&
        !/^[a-z][a-z\d+.-]*:\/\/[^@/]+@/i.test(record.remoteUrl))) &&
    (record.host === undefined || typeof record.host === "string") &&
    (record.ownerPath === undefined ||
      (Array.isArray(record.ownerPath) &&
        record.ownerPath.every((item) => typeof item === "string")))
  );
}

export async function readRegistry(path: string): Promise<RepositoryRegistry> {
  const value = await readJson(path);
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("repositories" in value) ||
    !Array.isArray(value.repositories) ||
    !value.repositories.every(isRepositoryRecord)
  ) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Repository index has an unsupported format.");
  }
  return value as RepositoryRegistry;
}
