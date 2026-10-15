import type { DevframeScopedClientRpc } from "devframe/client";

import type { DevtoolWorkspace } from "../../../devtool.js";
import type { RepositoryRecord, WorkspaceMember } from "../../../types.js";

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed";
export type WorkspaceRpc = DevframeScopedClientRpc<"compulsive">;
export type WorktreeMember = Extract<WorkspaceMember, { mode: "worktree" }>;

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
