import type {
  ManagerConfig,
  RepositoryRecord,
  WorkspaceRecord,
  WorkspaceStatusResult,
} from "../types.js";
import type { DevtoolPreferences } from "../devtool-preferences.js";

export interface DevtoolWorkspace extends WorkspaceRecord {
  cdCommand: string;
}

export interface DevtoolState {
  preferences?: DevtoolPreferences;
  config: ManagerConfig;
  repositories: RepositoryRecord[];
  workspaces: DevtoolWorkspace[];
  workspaceStatuses: WorkspaceStatusResult[];
}
