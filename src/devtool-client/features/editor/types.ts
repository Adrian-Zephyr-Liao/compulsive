import type { MessageKey } from "../../app/i18n.js";
import type { ProjectFile } from "../../../project/files.js";
import type { ProjectGitChange } from "../../../project/git.js";

export interface EditorScope {
  workspaceId: string;
  repositoryId: string;
}

export interface EditorDocument extends ProjectFile {
  asset?: string;
  saved: string;
  conflict: boolean;
}

export interface EditorNavigation {
  columnId: string;
  path: string;
  line: number;
  column: number;
  id: number;
}

export interface EditorCommand {
  id: string;
  label: MessageKey;
  shortcut: string;
  run: () => void;
}

export type FileAction = "newFile" | "newFolder" | "rename" | "trash" | "reveal";
export type EditorSidebarMode = "files" | "search" | "sourceControl";
export type EditorViewMode = "changes" | "files";
export interface EditorReviewEntry {
  id: string;
  group: "conflicts" | "staged" | "changes" | "untracked";
  staged: boolean;
  change: ProjectGitChange;
}
