import { randomUUID } from "node:crypto";
import { mkdir, realpath, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { discoverRepositoryRoots } from "./discovery.js";
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
  DiscoveryResult,
  OrganizePlan,
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
  const values = [record.id, record.name, record.classificationPath, record.absolutePath];
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

  async function getConfig(): Promise<ManagerConfig> {
    return readConfig(paths.config);
  }

  async function updateConfig(input: {
    rootDir?: string;
    scanRoots?: string[];
  }): Promise<ManagerConfig> {
    const current = await readConfig(paths.config);
    const updated: ManagerConfig = {
      ...current,
      rootDir: input.rootDir === undefined ? current.rootDir : resolve(input.rootDir),
      scanRoots:
        input.scanRoots === undefined
          ? current.scanRoots
          : input.scanRoots.map((path) => resolve(path)),
    };
    await mkdir(updated.rootDir, { recursive: true });
    await writeJsonAtomic(paths.config, updated);
    return updated;
  }

  async function search(input: { query?: string } = {}): Promise<RepositoryRecord[]> {
    await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const query = input.query?.trim().toLowerCase() ?? "";
    if (!query) return [...registry.repositories];
    return registry.repositories
      .filter((record) =>
        [record.id, record.name, record.classificationPath, record.absolutePath].some((value) =>
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

  async function discover(input: { paths?: string[] } = {}): Promise<DiscoveryResult> {
    const config = await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const scanPaths = input.paths ?? config.scanRoots;
    if (scanPaths.length === 0) {
      throw new CompulsiveError(
        "INVALID_INPUT",
        "Provide scan paths or configure at least one scan root.",
      );
    }

    const repositoryRoots = await discoverRepositoryRoots(scanPaths.map((path) => resolve(path)));
    const repositories = await Promise.all(
      repositoryRoots.map(async (repositoryRoot) => {
        const remoteUrl = await readOrigin(repositoryRoot);
        const classification = remoteUrl ? parseGitRemote(remoteUrl) : undefined;
        const name = classification?.name ?? basename(repositoryRoot);
        const classificationPath = classification?.relativePath ?? `local/${name}`;
        const isRegistered = registry.repositories.some(
          (record) =>
            record.absolutePath === repositoryRoot ||
            (classification && record.canonicalRemote === classification.canonicalRemote),
        );
        return {
          absolutePath: repositoryRoot,
          kind: classification ? ("remote" as const) : ("local" as const),
          name,
          classificationPath,
          ...(classification ? { canonicalRemote: classification.canonicalRemote } : {}),
          isRegistered,
        };
      }),
    );
    return { repositories };
  }

  async function forget(id: RepositoryRecord["id"]): Promise<void> {
    await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const index = registry.repositories.findIndex((record) => record.id === id);
    if (index === -1) {
      throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
    }
    registry.repositories.splice(index, 1);
    await writeJsonAtomic(paths.registry, registry);
  }

  async function findExistingAncestor(path: string): Promise<string> {
    let candidate = path;
    while (!(await fileExists(candidate))) {
      const parent = dirname(candidate);
      if (parent === candidate) {
        throw new CompulsiveError("FILESYSTEM_FAILED", `No existing ancestor for ${path}.`);
      }
      candidate = parent;
    }
    return candidate;
  }

  async function planOrganize(id: RepositoryRecord["id"]): Promise<OrganizePlan> {
    const config = await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const record = registry.repositories.find((item) => item.id === id);
    if (!record) {
      throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
    }
    if (!(await fileExists(record.absolutePath))) {
      throw new CompulsiveError(
        "NOT_FOUND",
        `Repository path no longer exists: ${record.absolutePath}`,
      );
    }

    const source = await realpath(record.absolutePath);
    const managedRoot = await realpath(config.rootDir);
    const target = join(managedRoot, ...record.classificationPath.split("/"));
    if (!pathIsInside(managedRoot, target)) {
      throw new CompulsiveError("FILESYSTEM_FAILED", "Repository classification escapes the root.");
    }
    const isNoop = source === target;
    if (!isNoop && (pathIsInside(source, target) || pathIsInside(target, source))) {
      throw new CompulsiveError("CONFLICT", "Source and target repositories cannot be nested.");
    }
    if (!isNoop && (await fileExists(target))) {
      throw new CompulsiveError("CONFLICT", `Organize target already exists: ${target}`);
    }

    const targetAncestor = await findExistingAncestor(dirname(target));
    if ((await stat(source)).dev !== (await stat(targetAncestor)).dev) {
      throw new CompulsiveError("CONFLICT", "Cross-volume repository moves are not supported.");
    }

    const status = await runGit(["status", "--porcelain"], { cwd: source, allowFailure: true });
    return {
      repositoryId: record.id,
      source,
      target,
      isNoop,
      warnings: status.stdout ? ["Repository has uncommitted changes; moving preserves them."] : [],
    };
  }

  async function organize(plan: OrganizePlan): Promise<RepositoryRecord> {
    const currentPlan = await planOrganize(plan.repositoryId);
    if (currentPlan.source !== plan.source || currentPlan.target !== plan.target) {
      throw new CompulsiveError("CONFLICT", "Organization plan is stale; create a new preview.");
    }
    const registry = await readRegistry(paths.registry);
    const recordIndex = registry.repositories.findIndex(
      (record) => record.id === plan.repositoryId,
    );
    if (recordIndex === -1) {
      throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
    }
    if (currentPlan.isNoop) return registry.repositories[recordIndex]!;

    await mkdir(dirname(currentPlan.target), { recursive: true });
    try {
      await rename(currentPlan.source, currentPlan.target);
    } catch (error) {
      throw new CompulsiveError("FILESYSTEM_FAILED", "Unable to move repository.", {
        cause: error,
      });
    }

    try {
      const verifiedRoot = await realpath(await findRepositoryRoot(currentPlan.target));
      if (verifiedRoot !== (await realpath(currentPlan.target))) {
        throw new CompulsiveError("GIT_FAILED", "Moved path is not the expected repository root.");
      }
    } catch (error) {
      try {
        await rename(currentPlan.target, currentPlan.source);
      } catch {
        throw new CompulsiveError(
          "FILESYSTEM_FAILED",
          "Repository verification failed and the move could not be rolled back.",
          { cause: error },
        );
      }
      throw error;
    }

    const updated: RepositoryRecord = {
      ...registry.repositories[recordIndex]!,
      absolutePath: await realpath(currentPlan.target),
      isManaged: true,
      lastSeenAt: new Date().toISOString(),
    };
    registry.repositories[recordIndex] = updated;
    try {
      await writeJsonAtomic(paths.registry, registry);
    } catch (error) {
      try {
        await rename(currentPlan.target, currentPlan.source);
      } catch (rollbackError) {
        throw new CompulsiveError(
          "FILESYSTEM_FAILED",
          "Index update failed and the repository move could not be rolled back.",
          { cause: error, rollbackError },
        );
      }
      throw error;
    }
    return updated;
  }

  return {
    initialize,
    getConfig,
    updateConfig,
    clone,
    discover,
    register,
    search,
    planOrganize,
    organize,
    forget,
  };
}
