import { defineRpcFunction } from "devframe";
import { objectResult } from "./rpc-schema.js";
import { type DevtoolState } from "./types.js";
import { formatCdCommand } from "../shell.js";
import { s } from "devframe/utils/simple-schema";
import { type ManagerConfig, type DoctorCheck, type RepositoryManager } from "../types.js";
import { devtoolPreferences, type DevtoolPreferences } from "../devtool-preferences.js";

export function createStateFunctions(manager: RepositoryManager) {
  const getState = defineRpcFunction({
    name: "get-state",
    type: "query",
    jsonSerializable: true,
    args: [],
    returns: objectResult<DevtoolState>(),
    handler: async (): Promise<DevtoolState> => {
      const [config, repositories, workspaces, workspaceStatuses, preferences] = await Promise.all([
        manager.getConfig(),
        manager.search(),
        manager.searchWorkspaces(),
        manager.getWorkspaceStatuses(),
        devtoolPreferences(manager),
      ]);
      const workspaceIds = new Set(workspaces.map(({ id }) => id));
      return {
        preferences,
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

  const updateConfig = defineRpcFunction({
    name: "update-config",
    type: "action",
    jsonSerializable: true,
    args: [
      s.object({
        rootDir: s.string(),
        workspaceRoot: s.string(),
        scanRoots: s.array(s.string()),
      }),
    ],
    returns: objectResult<ManagerConfig>(),
    handler: ({ rootDir, workspaceRoot, scanRoots }): Promise<ManagerConfig> =>
      manager.updateConfig({ rootDir, workspaceRoot, scanRoots }),
  });

  const runDoctor = defineRpcFunction({
    name: "run-doctor",
    type: "query",
    jsonSerializable: true,
    args: [],
    returns: objectResult<{ checks: DoctorCheck[] }>(),
    handler: async (): Promise<{ checks: DoctorCheck[] }> => ({ checks: await manager.doctor() }),
  });
  const updatePreferences = defineRpcFunction({
    name: "update-devtool-preferences",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ dark: s.boolean() })],
    returns: objectResult<DevtoolPreferences>(),
    handler: (value) => devtoolPreferences(manager, value),
  });
  return [getState, updateConfig, runDoctor, updatePreferences] as const;
}
