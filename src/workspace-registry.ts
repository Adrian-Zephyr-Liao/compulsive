import {
  type WorkspaceRecord,
  type CreateWorkspaceInput,
  type SearchWorkspacesInput,
  type WorkspaceId,
  type RepositoryRecord,
  type WorkspaceStatusResult,
  type WorkspaceMemberStatus,
} from "./types.js";
import {
  type StoragePaths,
  readConfig,
  readWorkspaceRegistry,
  fileExists,
  writeJsonAtomic,
  readRegistry,
  readWorkspaceStatusRegistry,
} from "./storage.js";
import { assertSafeWorkspaceSegment, canonicalPath } from "./workspace-paths.js";
import { resolve, join } from "node:path";
import { CompulsiveError } from "./errors.js";
import { stat, mkdir, realpath, rmdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { readWorkspaceMemberStatus } from "./workspace-status.js";

function matchRank(workspace: WorkspaceRecord, query: string): number {
  const values = [workspace.id, workspace.name, workspace.absolutePath];
  if (values.some((value) => value.toLowerCase() === query)) return 0;
  if (values.some((value) => value.toLowerCase().startsWith(query))) return 1;
  return 2;
}

export async function createWorkspace(
  paths: StoragePaths,
  input: CreateWorkspaceInput,
): Promise<WorkspaceRecord> {
  const name = input.name.trim();
  assertSafeWorkspaceSegment(name, "Workspace name");
  const config = await readConfig(paths.config);
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const requestedPath = resolve(input.path ?? join(config.workspaceRoot, name));
  const absolutePath = await canonicalPath(requestedPath);

  if (
    registry.workspaces.some((workspace) => workspace.name.toLowerCase() === name.toLowerCase())
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace name already exists: ${name}`);
  }
  if (
    registry.workspaces.some(
      (workspace) => resolve(workspace.absolutePath) === resolve(absolutePath),
    )
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace path is already registered: ${absolutePath}`);
  }

  const existed = await fileExists(requestedPath);
  if (existed && !(await stat(requestedPath)).isDirectory()) {
    throw new CompulsiveError("CONFLICT", `Workspace path is not a directory: ${requestedPath}`);
  }
  await mkdir(requestedPath, { recursive: true });
  const createdPath = await realpath(requestedPath);
  const now = new Date().toISOString();
  const workspace: WorkspaceRecord = {
    id: `workspace:${randomUUID()}` as WorkspaceRecord["id"],
    name,
    absolutePath: createdPath,
    members: [],
    createdAt: now,
    updatedAt: now,
  };
  registry.workspaces.push(workspace);
  try {
    await writeJsonAtomic(paths.workspaces, registry);
  } catch (error) {
    if (!existed) {
      try {
        await rmdir(createdPath);
      } catch {
        // The directory is no longer empty or removable, so preserve it.
      }
    }
    throw error;
  }
  return workspace;
}

export async function searchWorkspaces(
  paths: StoragePaths,
  input: SearchWorkspacesInput = {},
): Promise<WorkspaceRecord[]> {
  await readConfig(paths.config);
  const registry = await readWorkspaceRegistry(paths.workspaces);
  const query = input.query?.trim().toLowerCase() ?? "";
  if (!query) return [...registry.workspaces];
  return registry.workspaces
    .filter((workspace) =>
      [workspace.id, workspace.name, workspace.absolutePath].some((value) =>
        value.toLowerCase().includes(query),
      ),
    )
    .sort((left, right) => matchRank(left, query) - matchRank(right, query));
}

export function findWorkspace(
  registry: Awaited<ReturnType<typeof readWorkspaceRegistry>>,
  id: WorkspaceId,
) {
  const index = registry.workspaces.findIndex((workspace) => workspace.id === id);
  if (index === -1) throw new CompulsiveError("NOT_FOUND", "Workspace is not registered.");
  return { index, workspace: registry.workspaces[index]! };
}

export function findRepository(repositories: RepositoryRecord[], id: RepositoryRecord["id"]) {
  const repository = repositories.find((record) => record.id === id);
  if (!repository) throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
  return repository;
}

export async function getWorkspaceStatus(
  paths: StoragePaths,
  id: WorkspaceId,
  fetchRemote = false,
): Promise<WorkspaceStatusResult> {
  const [workspaceRegistry, repositoryRegistry, statusRegistry] = await Promise.all([
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
    readWorkspaceStatusRegistry(paths.workspaceStatuses),
  ]);
  const { workspace } = findWorkspace(workspaceRegistry, id);
  const previousStatus = statusRegistry.statuses.find(({ workspaceId }) => workspaceId === id);
  const members = await Promise.all(
    workspace.members.map(async (member): Promise<WorkspaceMemberStatus> => {
      const repository = findRepository(repositoryRegistry.repositories, member.repositoryId);
      const previousMemberStatus = previousStatus?.members.find(
        (candidate) =>
          candidate.repositoryId === member.repositoryId &&
          candidate.branch === (member.mode === "worktree" ? member.branch : ""),
      );
      return readWorkspaceMemberStatus(member, repository, previousMemberStatus, fetchRemote);
    }),
  );
  const result = { workspaceId: workspace.id, checkedAt: new Date().toISOString(), members };
  statusRegistry.statuses = [
    ...statusRegistry.statuses.filter(({ workspaceId }) => workspaceId !== workspace.id),
    result,
  ];
  await writeJsonAtomic(paths.workspaceStatuses, statusRegistry);
  return result;
}
