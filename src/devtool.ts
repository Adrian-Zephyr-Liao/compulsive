import { fileURLToPath } from "node:url";

import { defineDevframe, defineRpcFunction } from "devframe";
import { createDevServer } from "devframe/adapters/dev";
import type { RpcDefinitionsToFunctionsWithNamespace } from "devframe/rpc";
import { s, type StandardSchemaV1 } from "devframe/utils/simple-schema";

import pkg from "../package.json" with { type: "json" };
import { formatCdCommand } from "./shell.js";
import type {
  RepositoryId,
  RepositoryManager,
  RepositoryRecord,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceSyncResult,
} from "./types.js";

export interface DevtoolWorkspace extends WorkspaceRecord {
  cdCommand: string;
}

export interface DevtoolState {
  repositories: RepositoryRecord[];
  workspaces: DevtoolWorkspace[];
}

function objectResult<T extends object>(): StandardSchemaV1<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "compulsive",
      validate(value) {
        return typeof value === "object" && value !== null && !Array.isArray(value)
          ? { value: value as T }
          : { issues: [{ message: "Expected an object" }] };
      },
    },
  };
}

function createServerFunctions(manager: RepositoryManager) {
  const getState = defineRpcFunction({
    name: "get-state",
    type: "query",
    jsonSerializable: true,
    args: [],
    returns: objectResult<DevtoolState>(),
    handler: async (): Promise<DevtoolState> => {
      const [repositories, workspaces] = await Promise.all([
        manager.search(),
        manager.searchWorkspaces(),
      ]);
      return {
        repositories,
        workspaces: workspaces.map((workspace) => ({
          ...workspace,
          cdCommand: formatCdCommand(workspace.absolutePath),
        })),
      };
    },
  });

  const createWorkspace = defineRpcFunction({
    name: "create-workspace",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ name: s.string() })],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({ name }): Promise<WorkspaceRecord> => manager.createWorkspace({ name }),
  });

  const addWorkspaceMember = defineRpcFunction({
    name: "add-workspace-member",
    type: "action",
    jsonSerializable: true,
    args: [
      s.object({
        workspaceId: s.string(),
        repositoryId: s.string(),
        alias: s.optional(s.string()),
        branch: s.optional(s.string()),
        createBranch: s.boolean(),
      }),
    ],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({ workspaceId, repositoryId, alias, branch, createBranch }) =>
      manager.addWorkspaceMember({
        workspaceId: workspaceId as WorkspaceId,
        repositoryId: repositoryId as RepositoryId,
        mode: "worktree",
        ...(alias === undefined ? {} : { alias }),
        ...(branch === undefined ? {} : { branch }),
        createBranch,
      }),
  });

  const removeWorkspaceMember = defineRpcFunction({
    name: "remove-workspace-member",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string() })],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({ workspaceId, repositoryId }) =>
      manager.removeWorkspaceMember({
        workspaceId: workspaceId as WorkspaceId,
        repositoryId: repositoryId as RepositoryId,
      }),
  });

  const syncWorkspace = defineRpcFunction({
    name: "sync-workspace",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string() })],
    returns: objectResult<WorkspaceSyncResult>(),
    handler: ({ workspaceId }) => manager.syncWorkspace(workspaceId as WorkspaceId),
  });

  const deleteWorkspace = defineRpcFunction({
    name: "delete-workspace",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string() })],
    returns: objectResult<{ deleted: string }>(),
    handler: async ({ workspaceId }): Promise<{ deleted: string }> => {
      await manager.deleteWorkspace(workspaceId as WorkspaceId);
      return { deleted: workspaceId };
    },
  });

  return [
    getState,
    createWorkspace,
    addWorkspaceMember,
    removeWorkspaceMember,
    syncWorkspace,
    deleteWorkspace,
  ] as const;
}

export function createCompulsiveDevframe(manager: RepositoryManager) {
  return defineDevframe({
    id: "compulsive",
    name: "Compulsive",
    version: pkg.version,
    packageName: pkg.name,
    importMetaUrl: import.meta.url,
    homepage: pkg.homepage,
    description: "Manage Compulsive workspaces and their Git worktrees.",
    icon: "ph:git-branch-duotone",
    clientAssets: fileURLToPath(new URL("../dist/devtool-client", import.meta.url)),
    cli: {
      command: "cpl ui",
      port: 7392,
      portRange: [7392, 7492],
      open: true,
    },
    setup(ctx) {
      const rpc = ctx.scope("compulsive").rpc;
      for (const fn of createServerFunctions(manager)) rpc.register(fn);
    },
  });
}

export interface CompulsiveDevtoolServer {
  origin: string;
  close(): Promise<void>;
}

export interface StartCompulsiveDevtoolOptions {
  openBrowser?: boolean;
}

export async function startCompulsiveDevtool(
  manager: RepositoryManager,
  options: StartCompulsiveDevtoolOptions = {},
): Promise<CompulsiveDevtoolServer> {
  return createDevServer(createCompulsiveDevframe(manager), {
    host: "localhost",
    openBrowser: options.openBrowser ?? true,
    auth: true,
    mcp: false,
  });
}

declare module "devframe" {
  interface DevframeRpcServerFunctions extends RpcDefinitionsToFunctionsWithNamespace<
    "compulsive",
    ReturnType<typeof createServerFunctions>
  > {}
}
