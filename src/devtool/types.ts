import type {
  ManagerConfig,
  RepositoryRecord,
  WorkspaceRecord,
  WorkspaceStatusResult,
} from "../types.js";

export interface DevtoolWorkspace extends WorkspaceRecord {
  cdCommand: string;
}

export interface DevtoolState {
  config: ManagerConfig;
  repositories: RepositoryRecord[];
  workspaces: DevtoolWorkspace[];
  workspaceStatuses: WorkspaceStatusResult[];
}
