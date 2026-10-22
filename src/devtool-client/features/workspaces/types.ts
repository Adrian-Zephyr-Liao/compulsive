import type { DevframeScopedClientRpc } from "devframe/client";

import type { DevtoolWorkspace } from "../../../devtool.js";
import type { RepositoryRecord, WorkspaceMember } from "../../../types.js";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed";
export type WorkspaceRpc = DevframeScopedClientRpc<"compulsive">;
export type WorktreeMember = Extract<WorkspaceMember, { mode: "worktree" }>;

export interface WorkspaceFeedbackState {
  title: string;
  message: string;
  error: boolean;
}

export interface RepositoryStatusCounts {
  all: number;
  attention: number;
  conflicts: number;
  unpushed: number;
}

export type RunWorkspaceAction = (
  name: string,
  task: () => Promise<unknown>,
  success: string,
  preferredWorkspaceId?: string,
  refreshStatus?: boolean,
) => Promise<boolean>;

export interface ConfirmState {
  title: string;
  message: string;
  action: "delete-workspace" | "remove-member" | "convert-to-reference";
  workspace: DevtoolWorkspace;
  member?: WorkspaceMember;
  confirmLabel?: string;
  warning?: string;
}

export interface RequirementRepository {
  repository: RepositoryRecord;
  member?: WorkspaceMember;
}
