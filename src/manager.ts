import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import {
  type RepositoryRecord,
  type RepositoryManagerOptions,
  type RepositoryManager,
  type ManagerConfig,
  type RepositoryRegistry,
  type RepositoryBranch,
  type DiscoveryResult,
  type CreateWorkspaceInput,
  type CloneWorkspaceInput,
  type SearchWorkspacesInput,
  type AddWorkspaceMemberInput,
  type RemoveWorkspaceMemberInput,
  type PromoteWorkspaceReferenceInput,
  type ConvertWorkspaceToReferenceInput,
  type WorkspaceGitActionInput,
  type WorkspacePushInput,
  type WorkspaceId,
} from "./types.js";
import {
  createStoragePaths,
  fileExists,
  readConfig,
  writeJsonAtomic,
  readRegistry,
  readWorkspaceStatusRegistry,
} from "./storage.js";
import { createWorktreeAuditStore } from "./worktree-audit-store.js";
import { mkdir, realpath } from "node:fs/promises";
import { findRepositoryRoot, runGit } from "./git.js";
import { randomUUID } from "node:crypto";
import { CompulsiveError } from "./errors.js";
import { parseGitRemote } from "./git-url.js";
import { discoverRepositoryRoots } from "./discovery.js";
import { runDoctorChecks } from "./doctor.js";
import { scanWorktrees } from "./worktree-audit.js";
import { searchWorkspaces, createWorkspace, getWorkspaceStatus } from "./workspace-registry.js";
import { previewWorktreeRemoval, removeAuditedWorktree } from "./worktree-removal.js";
import { cloneWorkspace } from "./workspace-clone.js";
import {
  addWorkspaceMember,
  removeWorkspaceMember,
  promoteWorkspaceReference,
  convertWorkspaceToReference,
} from "./workspace-members.js";
import {
  rebaseWorkspaceMember,
  pushWorkspaceMember,
  syncWorkspaceBranches,
} from "./workspace-sync.js";
import { syncWorkspace, migrateWorkspaces } from "./workspace-maintenance.js";
import { deleteWorkspace } from "./workspace-deletion.js";
import { pathIsInside, readRepositoryMetadata } from "./repository-metadata.js";
import { planOrganize, organize } from "./repository-organize.js";

function defaultDataDir(): string {
  return process.env.CPL_HOME ?? join(homedir(), "Library", "Application Support", "compulsive");
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
  const worktreeAudit = createWorktreeAuditStore(paths);

  async function initialize(
    input: { rootDir?: string; workspaceRoot?: string; scanRoots?: string[] } = {},
  ) {
    if (await fileExists(paths.config)) {
      const existing = await readConfig(paths.config);
      await mkdir(existing.rootDir, { recursive: true });
      await mkdir(existing.workspaceRoot, { recursive: true });
      if (!(await fileExists(paths.registry))) {
        await writeJsonAtomic(paths.registry, { schemaVersion: 1, repositories: [] });
      }
      if (!(await fileExists(paths.workspaces))) {
        await writeJsonAtomic(paths.workspaces, { schemaVersion: 1, workspaces: [] });
      }
      if (!(await fileExists(paths.workspaceStatuses))) {
        await writeJsonAtomic(paths.workspaceStatuses, { schemaVersion: 1, statuses: [] });
      }
      return existing;
    }

    const rootDir = resolve(input.rootDir ?? defaultRootDir);
    const config: ManagerConfig = {
      schemaVersion: 1,
      rootDir,
      workspaceRoot: resolve(input.workspaceRoot ?? join(dirname(rootDir), "Workspaces")),
      scanRoots: (input.scanRoots ?? []).map((item) => resolve(item)),
    };
    const registry: RepositoryRegistry = { schemaVersion: 1, repositories: [] };
    await mkdir(config.rootDir, { recursive: true });
    await mkdir(config.workspaceRoot, { recursive: true });
    await writeJsonAtomic(paths.config, config);
    await writeJsonAtomic(paths.registry, registry);
    await writeJsonAtomic(paths.workspaces, { schemaVersion: 1, workspaces: [] });
    await writeJsonAtomic(paths.workspaceStatuses, { schemaVersion: 1, statuses: [] });
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

    const metadata = await readRepositoryMetadata(repositoryRoot);
    const existingByRemote =
      metadata.kind === "remote"
        ? registry.repositories.find(
            (record) => record.canonicalRemote === metadata.canonicalRemote,
          )
        : undefined;
    if (existingByRemote) return existingByRemote;

    const now = new Date().toISOString();
    const common = {
      id: `${metadata.kind}:${randomUUID()}` as RepositoryRecord["id"],
      absolutePath: repositoryRoot,
      isManaged: pathIsInside(canonicalManagedRoot, repositoryRoot),
      registeredAt: now,
      lastSeenAt: now,
    };
    const record: RepositoryRecord = { ...common, ...metadata };

    registry.repositories.push(record);
    await writeJsonAtomic(paths.registry, registry);
    return record;
  }

  async function getConfig(): Promise<ManagerConfig> {
    return readConfig(paths.config);
  }

  async function updateConfig(input: {
    rootDir?: string;
    workspaceRoot?: string;
    scanRoots?: string[];
  }): Promise<ManagerConfig> {
    const current = await readConfig(paths.config);
    const updated: ManagerConfig = {
      ...current,
      rootDir: input.rootDir === undefined ? current.rootDir : resolve(input.rootDir),
      workspaceRoot:
        input.workspaceRoot === undefined ? current.workspaceRoot : resolve(input.workspaceRoot),
      scanRoots:
        input.scanRoots === undefined
          ? current.scanRoots
          : input.scanRoots.map((path) => resolve(path)),
    };
    await mkdir(updated.rootDir, { recursive: true });
    await mkdir(updated.workspaceRoot, { recursive: true });
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

  async function getRepositoryBranches(id: RepositoryRecord["id"]): Promise<RepositoryBranch[]> {
    await readConfig(paths.config);
    const registry = await readRegistry(paths.registry);
    const repository = registry.repositories.find((record) => record.id === id);
    if (!repository) throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");

    const [local, remote, cachedRemote] = await Promise.all([
      runGit(["for-each-ref", "--format=%(refname:short)", "refs/heads"], {
        cwd: repository.absolutePath,
      }),
      runGit(["ls-remote", "--heads", "origin"], {
        cwd: repository.absolutePath,
        allowFailure: true,
      }),
      runGit(["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"], {
        cwd: repository.absolutePath,
        allowFailure: true,
      }),
    ]);
    const localNames = new Set(local.stdout.split("\n").filter(Boolean));
    const remoteNames = new Set(
      (remote.exitCode === 0
        ? remote.stdout
            .split("\n")
            .map((line) => line.split("\trefs/heads/")[1])
            .filter((name): name is string => Boolean(name))
        : cachedRemote.stdout
            .split("\n")
            .filter((name) => name && name !== "origin/HEAD")
            .map((name) => name.slice("origin/".length))) as string[],
    );
    return [...new Set([...localNames, ...remoteNames])]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => ({ name, local: localNames.has(name), remote: remoteNames.has(name) }));
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
        const metadata = await readRepositoryMetadata(repositoryRoot);
        const isRegistered = registry.repositories.some(
          (record) =>
            record.absolutePath === repositoryRoot ||
            (metadata.kind === "remote" && record.canonicalRemote === metadata.canonicalRemote),
        );
        return {
          absolutePath: repositoryRoot,
          kind: metadata.kind,
          name: metadata.name,
          classificationPath: metadata.classificationPath,
          ...(metadata.kind === "remote" ? { canonicalRemote: metadata.canonicalRemote } : {}),
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

  const manager: RepositoryManager = {
    initialize,
    getConfig,
    updateConfig,
    doctor: () => runDoctorChecks(manager),
    auditWorktrees: async (options) =>
      worktreeAudit.save(
        await scanWorktrees(await manager.search(), await manager.searchWorkspaces(), options),
      ),
    getWorktreeAudit: worktreeAudit.get,
    previewWorktreeRemoval: (id) => previewWorktreeRemoval(manager, id),
    removeAuditedWorktree: async (input) => {
      const result = await removeAuditedWorktree(manager, paths, input);
      try {
        return { ...result, report: await worktreeAudit.removeItem(input.id) };
      } catch (error) {
        return {
          ...result,
          report: null,
          warning: [
            result.warning,
            `Worktree removed, but the cached report could not be updated: ${String(error)}`,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }
    },
    setWorktreeAuditIgnored: worktreeAudit.setIgnored,
    clone,
    discover,
    register,
    search,
    getRepositoryBranches,
    planOrganize: (id) => planOrganize(paths, id),
    organize: (plan) => organize(paths, plan),
    forget,
    createWorkspace: (input: CreateWorkspaceInput) => createWorkspace(paths, input),
    cloneWorkspace: (input: CloneWorkspaceInput) => cloneWorkspace(paths, input),
    searchWorkspaces: (input?: SearchWorkspacesInput) => searchWorkspaces(paths, input),
    addWorkspaceMember: (input: AddWorkspaceMemberInput) => addWorkspaceMember(paths, input),
    removeWorkspaceMember: (input: RemoveWorkspaceMemberInput) =>
      removeWorkspaceMember(paths, input),
    promoteWorkspaceReference: (input: PromoteWorkspaceReferenceInput) =>
      promoteWorkspaceReference(paths, input),
    convertWorkspaceToReference: (input: ConvertWorkspaceToReferenceInput) =>
      convertWorkspaceToReference(paths, input),
    rebaseWorkspaceMember: (input: WorkspaceGitActionInput) => rebaseWorkspaceMember(paths, input),
    pushWorkspaceMember: (input: WorkspacePushInput) => pushWorkspaceMember(paths, input),
    syncWorkspaceBranches: (id: WorkspaceId) => syncWorkspaceBranches(paths, id),
    getWorkspaceStatus: (id: WorkspaceId, fetchRemote = false) =>
      getWorkspaceStatus(paths, id, fetchRemote),
    getWorkspaceStatuses: async () =>
      (await readWorkspaceStatusRegistry(paths.workspaceStatuses)).statuses,
    syncWorkspace: (id: WorkspaceId) => syncWorkspace(paths, id),
    migrateWorkspaces: (ids?: WorkspaceId[]) => migrateWorkspaces(paths, ids),
    deleteWorkspace: (id: WorkspaceId) => deleteWorkspace(paths, id),
  };
  return manager;
}
