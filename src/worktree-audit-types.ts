export type WorktreeCategory =
  | "referenced"
  | "unreferenced"
  | "external"
  | "missing"
  | "unregistered";

export interface WorktreeAuditItem {
  id: string;
  repositoryId: string;
  repositoryName: string;
  repositoryPath: string;
  commonDirectory: string;
  path: string;
  branch: string | null;
  head: string | null;
  category: WorktreeCategory;
  references: string[];
  exists: boolean | null;
  locked: string | null;
  prunable: string | null;
  upstream: string | null;
  ahead: number | null;
  unpublished: number | null;
  operations: string[];
  risks: string[];
  changes: Array<{ status: string; path: string; from?: string }>;
  error: string | null;
  fingerprint: string;
  ignored: boolean;
}

export interface WorktreeAuditReport {
  schemaVersion: 1;
  startedAt: string;
  checkedAt: string;
  complete: boolean;
  cancelled: boolean;
  repositoryTotal: number;
  repositoriesScanned: number;
  items: WorktreeAuditItem[];
  errors: Array<{ repository: string; message: string }>;
}

export interface WorktreeAuditOptions {
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}

export interface WorktreeRemovalPlan {
  item: WorktreeAuditItem;
  blockers: string[];
  forceReasons: string[];
}

export interface WorktreeRemovalInput {
  id: string;
  fingerprint: string;
  confirmedPath: string;
  includeIgnored?: boolean;
  force?: boolean;
}

export interface WorktreeRemovalResult {
  retainedCommitRef: string | null;
  removedPath: string;
  report: WorktreeAuditReport | null;
  warning: string | null;
}

export interface WorktreeAuditJob {
  id: string;
  revision: number;
  status: "running" | "completed" | "cancelled" | "failed";
  completed: number;
  total: number;
  report: WorktreeAuditReport | null;
  error: string | null;
}
