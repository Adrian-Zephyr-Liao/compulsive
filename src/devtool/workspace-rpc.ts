import { defineRpcFunction } from "devframe";
import { s } from "devframe/utils/simple-schema";
import { objectResult } from "./rpc-schema.js";
import {
  type WorkspaceRecord,
  type RepositoryBranch,
  type RepositoryId,
  type WorkspaceId,
  type WorkspaceBranchSyncResult,
  type WorkspaceStatusResult,
  type WorkspaceSyncResult,
  type RepositoryManager,
} from "../types.js";

export function createWorkspaceFunctions(manager: RepositoryManager) {
  const createWorkspace = defineRpcFunction({
    name: "create-workspace",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ name: s.string() })],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({ name }): Promise<WorkspaceRecord> => manager.createWorkspace({ name }),
  });

  const getRepositoryBranches = defineRpcFunction({
    name: "get-repository-branches",
    type: "query",
    jsonSerializable: true,
    args: [s.object({ repositoryId: s.string() })],
    returns: objectResult<{ branches: RepositoryBranch[] }>(),
    handler: async ({ repositoryId }): Promise<{ branches: RepositoryBranch[] }> => ({
      branches: await manager.getRepositoryBranches(repositoryId as RepositoryId),
    }),
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
        sourceWorkspaceId: s.optional(s.string()),
        name: s.string(),
        repositoryIds: s.array(s.string()),
        branchName: s.optional(s.string()),
        repositoryBranches: s.optional(
          s.array(s.object({ repositoryId: s.string(), branch: s.string() })),
        ),
        referenceRepositoryIds: s.optional(s.array(s.string())),
      }),
    ],
    returns: objectResult<WorkspaceRecord>(),
    handler: ({
      sourceWorkspaceId,
      name,
      repositoryIds,
      branchName,
      repositoryBranches,
      referenceRepositoryIds,
    }) =>
      manager.cloneWorkspace({
        name,
        repositoryIds: repositoryIds as RepositoryId[],
        ...(sourceWorkspaceId === undefined
          ? {}
          : { sourceWorkspaceId: sourceWorkspaceId as WorkspaceId }),
        ...(branchName === undefined ? {} : { branchName }),
        ...(repositoryBranches === undefined
          ? {}
          : {
              repositoryBranches: repositoryBranches.map(({ repositoryId, branch }) => ({
                repositoryId: repositoryId as RepositoryId,
                branch,
              })),
            }),
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

  const switchWorkspaceMemberBranch = defineRpcFunction({
    name: "switch-workspace-member-branch",
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
    args: [
      s.object({
        workspaceId: s.string(),
        repositoryId: s.string(),
        force: s.optional(s.boolean()),
      }),
    ],
    returns: objectResult<{ pushed: string }>(),
    handler: async ({ workspaceId, repositoryId, force }): Promise<{ pushed: string }> => {
      await manager.pushWorkspaceMember({
        workspaceId: workspaceId as WorkspaceId,
        repositoryId: repositoryId as RepositoryId,
        ...(force === undefined ? {} : { force }),
      });
      return { pushed: repositoryId };
    },
  });

  const syncWorkspaceBranches = defineRpcFunction({
    name: "sync-workspace-branches",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string() })],
    returns: objectResult<WorkspaceBranchSyncResult>(),
    handler: ({ workspaceId }) => manager.syncWorkspaceBranches(workspaceId as WorkspaceId),
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
    createWorkspace,
    getRepositoryBranches,
    addWorkspaceMember,
    cloneWorkspace,
    removeWorkspaceMember,
    promoteWorkspaceReference,
    switchWorkspaceMemberBranch,
    convertWorkspaceToReference,
    rebaseWorkspaceMember,
    pushWorkspaceMember,
    syncWorkspaceBranches,
    getWorkspaceStatus,
    syncWorkspace,
    deleteWorkspace,
  ] as const;
}
