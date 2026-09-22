import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { defineDevframe, defineRpcFunction } from "devframe";
import { createDevServer } from "devframe/adapters/dev";
import type { RpcDefinitionsToFunctionsWithNamespace } from "devframe/rpc";
import { s, type StandardSchemaV1 } from "devframe/utils/simple-schema";

import pkg from "../package.json" with { type: "json" };
import { CompulsiveError } from "./errors.js";
import { formatCdCommand } from "./shell.js";
import type {
  RepositoryId,
  RepositoryManager,
  RepositoryRecord,
  ManagerConfig,
  WorkspaceId,
  WorkspaceRecord,
  WorkspaceStatusResult,
  WorkspaceSyncResult,
} from "./types.js";

const execFileAsync = promisify(execFile);

export interface DevtoolWorkspace extends WorkspaceRecord {
  cdCommand: string;
}

export interface DevtoolState {
  config: ManagerConfig;
  repositories: RepositoryRecord[];
  workspaces: DevtoolWorkspace[];
  workspaceStatuses: WorkspaceStatusResult[];
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

export function createServerFunctions(manager: RepositoryManager) {
  const getState = defineRpcFunction({
    name: "get-state",
    type: "query",
    jsonSerializable: true,
    args: [],
    returns: objectResult<DevtoolState>(),
    handler: async (): Promise<DevtoolState> => {
      const [config, repositories, workspaces, workspaceStatuses] = await Promise.all([
        manager.getConfig(),
        manager.search(),
        manager.searchWorkspaces(),
        manager.getWorkspaceStatuses(),
      ]);
      const workspaceIds = new Set(workspaces.map(({ id }) => id));
      return {
        config,
        repositories,
        workspaces: workspaces.map((workspace) => ({
          ...workspace,
          cdCommand: formatCdCommand(workspace.absolutePath),
        })),
        workspaceStatuses: workspaceStatuses.filter(({ workspaceId }) =>
          workspaceIds.has(workspaceId),
        ),
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

  const cloneWorkspace = defineRpcFunction({
    name: "clone-workspace",
    type: "action",
    jsonSerializable: true,
    args: [
      s.object({
        sourceWorkspaceId: s.string(),
        name: s.string(),
        repositoryIds: s.array(s.string()),
        branchName: s.optional(s.string()),
        referenceRepositoryIds: s.optional(s.array(s.string())),
      }),
    ],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({ sourceWorkspaceId, name, repositoryIds, branchName, referenceRepositoryIds }) =>
      manager.cloneWorkspace({
        sourceWorkspaceId: sourceWorkspaceId as WorkspaceId,
        name,
        repositoryIds: repositoryIds as RepositoryId[],
        ...(branchName === undefined ? {} : { branchName }),
        ...(referenceRepositoryIds === undefined
          ? {}
          : { referenceRepositoryIds: referenceRepositoryIds as RepositoryId[] }),
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

  const promoteWorkspaceReference = defineRpcFunction({
    name: "promote-workspace-reference",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string(), branch: s.string() })],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({ workspaceId, repositoryId, branch }) =>
      manager.promoteWorkspaceReference({
        workspaceId: workspaceId as WorkspaceId,
        repositoryId: repositoryId as RepositoryId,
        branch,
      }),
  });

  const convertWorkspaceToReference = defineRpcFunction({
    name: "convert-workspace-to-reference",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string() })],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({ workspaceId, repositoryId }) =>
      manager.convertWorkspaceToReference({
        workspaceId: workspaceId as WorkspaceId,
        repositoryId: repositoryId as RepositoryId,
      }),
  });

  const rebaseWorkspaceMember = defineRpcFunction({
    name: "rebase-workspace-member",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string() })],
    returns: objectResult<{ rebased: string }>(),
    handler: async ({ workspaceId, repositoryId }): Promise<{ rebased: string }> => {
      await manager.rebaseWorkspaceMember({
        workspaceId: workspaceId as WorkspaceId,
        repositoryId: repositoryId as RepositoryId,
      });
      return { rebased: repositoryId };
    },
  });

  const pushWorkspaceMember = defineRpcFunction({
    name: "push-workspace-member",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string() })],
    returns: objectResult<{ pushed: string }>(),
    handler: async ({ workspaceId, repositoryId }): Promise<{ pushed: string }> => {
      await manager.pushWorkspaceMember({
        workspaceId: workspaceId as WorkspaceId,
        repositoryId: repositoryId as RepositoryId,
      });
      return { pushed: repositoryId };
    },
  });

  const getWorkspaceStatus = defineRpcFunction({
    name: "get-workspace-status",
    type: "query",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), fetchRemote: s.boolean() })],
    returns: objectResult<WorkspaceStatusResult>(),
    handler: ({ workspaceId, fetchRemote }) =>
      manager.getWorkspaceStatus(workspaceId as WorkspaceId, fetchRemote),
  });

  const openWorkspaceMemberInVscode = defineRpcFunction({
    name: "open-workspace-member-in-vscode",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string() })],
    returns: objectResult<{ opened: string }>(),
    handler: async ({ workspaceId, repositoryId }): Promise<{ opened: string }> => {
      const workspace = (await manager.searchWorkspaces()).find(({ id }) => id === workspaceId);
      const member = workspace?.members.find(({ repositoryId: id }) => id === repositoryId);
      if (!workspace || !member) {
        throw new CompulsiveError("NOT_FOUND", "Workspace member is not registered.");
      }
      const repository = (await manager.search()).find(({ id }) => id === repositoryId);
      if (!repository) throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
      const path = member.mode === "worktree" ? member.worktreePath : repository.absolutePath;
      try {
        await execFileAsync("/usr/bin/open", ["-a", "Visual Studio Code", path]);
      } catch (error) {
        throw new CompulsiveError("FILESYSTEM_FAILED", "Unable to open Visual Studio Code.", {
          cause: error,
        });
      }
      return { opened: path };
    },
  });

  const syncWorkspace = defineRpcFunction({
    name: "sync-workspace",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string() })],
    returns: objectResult<WorkspaceSyncResult>(),
    handler: ({ workspaceId }) => manager.syncWorkspace(workspaceId as WorkspaceId),
  });

  const openWorkspaceInChatgpt = defineRpcFunction({
    name: "open-workspace-in-chatgpt",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string() })],
    returns: objectResult<{ opened: string }>(),
    handler: async ({ workspaceId }): Promise<{ opened: string }> => {
      const workspace = (await manager.searchWorkspaces()).find(({ id }) => id === workspaceId);
      if (!workspace) throw new CompulsiveError("NOT_FOUND", "Workspace is not registered.");
      await execFileAsync("codex", ["app", workspace.absolutePath]);
      return { opened: workspace.absolutePath };
    },
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
    cloneWorkspace,
    addWorkspaceMember,
    removeWorkspaceMember,
    promoteWorkspaceReference,
    convertWorkspaceToReference,
    rebaseWorkspaceMember,
    pushWorkspaceMember,
    getWorkspaceStatus,
    openWorkspaceMemberInVscode,
    syncWorkspace,
    openWorkspaceInChatgpt,
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
