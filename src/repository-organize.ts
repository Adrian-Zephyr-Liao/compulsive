import { realpath, readdir, unlink, rmdir, stat, mkdir, rename } from "node:fs/promises";
import { resolve, relative, join, dirname } from "node:path";
import { type ManagerConfig, type RepositoryRecord, type OrganizePlan } from "./types.js";
import { homedir, tmpdir } from "node:os";
import { CompulsiveError } from "./errors.js";
import { fileExists, readConfig, readRegistry, writeJsonAtomic } from "./storage.js";
import { runGit, findRepositoryRoot } from "./git.js";
import { searchWorkspaces } from "./workspace-registry.js";
import { syncWorkspace } from "./workspace-maintenance.js";
import type { StoragePaths } from "./storage.js";
import { pathIsInside, readRepositoryMetadata } from "./repository-metadata.js";

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
}

async function cleanupBoundary(source: string, config: ManagerConfig): Promise<string> {
  const configuredPaths = await Promise.all(
    [config.rootDir, ...config.scanRoots].map((path) => canonicalPath(path)),
  );
  const configuredBoundary = configuredPaths
    .filter((path) => path !== source && pathIsInside(path, source))
    .sort((left, right) => right.length - left.length)[0];
  if (configuredBoundary) return configuredBoundary;

  const home = await canonicalPath(homedir());
  if (source !== home && pathIsInside(home, source)) {
    const topLevelDirectory = relative(home, source).split(/[\\/]/, 1)[0];
    if (topLevelDirectory) return join(home, topLevelDirectory);
  }

  const temporaryRoot = await canonicalPath(tmpdir());
  if (source !== temporaryRoot && pathIsInside(temporaryRoot, source)) return temporaryRoot;
  return dirname(source);
}

function hasErrorCode(error: unknown, ...codes: string[]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.includes(error.code)
  );
}

async function removeEmptySourceDirectories(source: string, config: ManagerConfig): Promise<void> {
  const boundary = await cleanupBoundary(source, config);
  let candidate = dirname(source);

  while (candidate !== boundary && pathIsInside(boundary, candidate)) {
    let entries: string[];
    try {
      entries = await readdir(candidate);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        candidate = dirname(candidate);
        continue;
      }
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        `Repository moved, but the source directory could not be inspected: ${candidate}`,
        { cause: error },
      );
    }

    if (entries.length === 1 && entries[0] === ".DS_Store") {
      try {
        await unlink(join(candidate, ".DS_Store"));
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
          throw new CompulsiveError(
            "FILESYSTEM_FAILED",
            `Repository moved, but Finder metadata could not be removed: ${candidate}`,
            { cause: error },
          );
        }
      }
    } else if (entries.length > 0) {
      return;
    }

    try {
      await rmdir(candidate);
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        candidate = dirname(candidate);
        continue;
      }
      if (hasErrorCode(error, "ENOTEMPTY")) return;
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        `Repository moved, but the empty source directory could not be removed: ${candidate}`,
        { cause: error },
      );
    }
    candidate = dirname(candidate);
  }
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

export async function planOrganize(
  paths: StoragePaths,
  id: RepositoryRecord["id"],
): Promise<OrganizePlan> {
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
  const storedTarget = join(managedRoot, ...record.classificationPath.split("/"));
  if (!pathIsInside(managedRoot, storedTarget)) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Repository classification escapes the root.");
  }
  const metadata = await readRepositoryMetadata(source);
  const target = join(managedRoot, ...metadata.classificationPath.split("/"));
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

export async function organize(paths: StoragePaths, plan: OrganizePlan): Promise<RepositoryRecord> {
  const currentPlan = await planOrganize(paths, plan.repositoryId);
  if (currentPlan.source !== plan.source || currentPlan.target !== plan.target) {
    throw new CompulsiveError("CONFLICT", "Organization plan is stale; create a new preview.");
  }
  const registry = await readRegistry(paths.registry);
  const recordIndex = registry.repositories.findIndex((record) => record.id === plan.repositoryId);
  if (recordIndex === -1) {
    throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
  }
  if (currentPlan.isNoop) return registry.repositories[recordIndex]!;

  const config = await readConfig(paths.config);
  await mkdir(dirname(currentPlan.target), { recursive: true });
  try {
    await rename(currentPlan.source, currentPlan.target);
  } catch (error) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "Unable to move repository.", {
      cause: error,
    });
  }

  const movedRepository = await (async () => {
    try {
      const absolutePath = await realpath(await findRepositoryRoot(currentPlan.target));
      if (absolutePath !== (await realpath(currentPlan.target))) {
        throw new CompulsiveError("GIT_FAILED", "Moved path is not the expected repository root.");
      }
      const metadata = await readRepositoryMetadata(absolutePath);
      const managedRoot = await realpath(config.rootDir);
      const currentTarget = join(managedRoot, ...metadata.classificationPath.split("/"));
      if (currentTarget !== currentPlan.target) {
        throw new CompulsiveError(
          "CONFLICT",
          "Repository classification changed while it was being organized.",
        );
      }
      return { absolutePath, metadata };
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
  })();

  const updated: RepositoryRecord = {
    id: registry.repositories[recordIndex]!.id,
    registeredAt: registry.repositories[recordIndex]!.registeredAt,
    ...movedRepository.metadata,
    absolutePath: movedRepository.absolutePath,
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
  await removeEmptySourceDirectories(currentPlan.source, config);
  const workspaceIssues = [];
  const workspaces = await searchWorkspaces(paths);
  for (const workspace of workspaces) {
    if (
      workspace.members.some(
        (member) => member.mode === "link" && member.repositoryId === updated.id,
      )
    ) {
      const result = await syncWorkspace(paths, workspace.id);
      workspaceIssues.push(...result.issues.map((issue) => ({ workspace: workspace.name, issue })));
    }
  }
  if (workspaceIssues.length > 0) {
    throw new CompulsiveError(
      "CONFLICT",
      "Repository was organized, but one or more workspace links could not be synchronized.",
      workspaceIssues,
    );
  }
  return updated;
}
