import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { CompulsiveError } from "./errors.js";
import { findRepositoryRoot, readOrigin, runGit } from "./git.js";
import { parseGitRemote } from "./git-url.js";
import {
  createStoragePaths,
  fileExists,
  readConfig,
  readRegistry,
  writeJsonAtomic,
} from "./storage.js";
import type {
  ManagerConfig,
  RepositoryManager,
  RepositoryManagerOptions,
  RepositoryRecord,
  RepositoryRegistry,
} from "./types.js";

function defaultDataDir(): string {
  return process.env.CPL_HOME ?? join(homedir(), "Library", "Application Support", "compulsive");
}

function pathIsInside(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

function matchRank(record: RepositoryRecord, query: string): number {
  const values = [record.name, record.classificationPath, record.absolutePath];
  if (values.some((value) => value.toLowerCase() === query)) return 0;
  if (values.some((value) => value.toLowerCase().startsWith(query))) return 1;
  return 2;
}

export function createRepositoryManager(options: RepositoryManagerOptions = {}): RepositoryManager {
  const dataDir = resolve(options.dataDir ?? defaultDataDir());
  const defaultRootDir = resolve(options.defaultRootDir ?? join(homedir(), "Desktop", "源码"));
  const paths = createStoragePaths(dataDir);

  async function initialize(input: { rootDir?: string; scanRoots?: string[] } = {}) {
    if (await fileExists(paths.config)) {
      const existing = await readConfig(paths.config);
      await mkdir(existing.rootDir, { recursive: true });
      if (!(await fileExists(paths.registry))) {
        await writeJsonAtomic(paths.registry, { schemaVersion: 1, repositories: [] });
      }
      return existing;
    }

    const config: ManagerConfig = {
      schemaVersion: 1,
      rootDir: resolve(input.rootDir ?? defaultRootDir),
      scanRoots: (input.scanRoots ?? []).map((item) => resolve(item)),
    };
    const registry: RepositoryRegistry = { schemaVersion: 1, repositories: [] };
    await mkdir(config.rootDir, { recursive: true });
    await writeJsonAtomic(paths.config, config);
    await writeJsonAtomic(paths.registry, registry);
    return config;
  }

  async function register(input: { path: string }): Promise<RepositoryRecord> {
    const config = await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const repositoryRoot = await realpath(await findRepositoryRoot(resolve(input.path)));
    const canonicalManagedRoot = await realpath(config.rootDir);
    const existingByPath = registry.repositories.find(
      (record) => record.absolutePath === repositoryRoot,
    );
    if (existingByPath) return existingByPath;

    const remoteUrl = await readOrigin(repositoryRoot);
    const classification = remoteUrl ? parseGitRemote(remoteUrl) : undefined;
    const existingByRemote = classification
      ? registry.repositories.find(
          (record) => record.canonicalRemote === classification.canonicalRemote,
        )
      : undefined;
    if (existingByRemote) return existingByRemote;

    const now = new Date().toISOString();
    const common = {
      id: `${classification ? "remote" : "local"}:${randomUUID()}` as RepositoryRecord["id"],
      absolutePath: repositoryRoot,
      isManaged: pathIsInside(canonicalManagedRoot, repositoryRoot),
      registeredAt: now,
      lastSeenAt: now,
    };
    const record: RepositoryRecord =
      classification && remoteUrl
        ? {
            ...common,
            kind: "remote",
            name: classification.name,
            classificationPath: classification.relativePath,
            canonicalRemote: classification.canonicalRemote,
            remoteUrl: classification.canonicalRemote,
            host: classification.host,
            ownerPath: classification.ownerPath,
          }
        : {
            ...common,
            kind: "local",
            name: basename(repositoryRoot),
            classificationPath: `local/${basename(repositoryRoot)}`,
          };

    registry.repositories.push(record);
    await writeJsonAtomic(paths.registry, registry);
    return record;
  }

  async function search(input: { query?: string } = {}): Promise<RepositoryRecord[]> {
    await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const query = input.query?.trim().toLowerCase() ?? "";
    if (!query) return [...registry.repositories];
    return registry.repositories
      .filter((record) =>
        [record.name, record.classificationPath, record.absolutePath].some((value) =>
          value.toLowerCase().includes(query),
        ),
      )
      .sort((left, right) => matchRank(left, query) - matchRank(right, query));
  }

  async function clone(input: { remote: string; depth?: number }): Promise<RepositoryRecord> {
    const config = await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const classification = parseGitRemote(input.remote);
    const existing = registry.repositories.find(
      (record) => record.canonicalRemote === classification.canonicalRemote,
    );
    if (existing) return existing;

    if (input.depth !== undefined && (!Number.isInteger(input.depth) || input.depth < 1)) {
      throw new CompulsiveError("INVALID_INPUT", "Clone depth must be a positive integer.");
    }

    const target = join(config.rootDir, ...classification.relativePath.split("/"));
    if (!pathIsInside(config.rootDir, target)) {
      throw new CompulsiveError("INVALID_REMOTE", "Classified target escapes the managed root.");
    }
    if (await fileExists(target)) {
      throw new CompulsiveError("CONFLICT", `Clone target already exists: ${target}`);
    }

    await mkdir(dirname(target), { recursive: true });
    const arguments_ = ["clone"];
    if (input.depth !== undefined) arguments_.push("--depth", String(input.depth));
    arguments_.push("--", input.remote, target);
    await runGit(arguments_);
    return register({ path: target });
  }

  return { initialize, clone, register, search };
}
