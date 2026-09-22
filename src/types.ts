export type RepositoryId = string & { readonly __brand: "RepositoryId" };
export type RepositoryKind = "remote" | "local";
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type WorkspaceMemberMode = "link" | "worktree";

export interface RepositoryClassification {
  kind: "remote";
  host: string;
  ownerPath: string[];
  name: string;
  relativePath: string;
  canonicalRemote: string;
}

export interface ManagerConfig {
  schemaVersion: 1;
  rootDir: string;
  workspaceRoot: string;
  scanRoots: string[];
}

export type WorkspaceMember =
  | {
      repositoryId: RepositoryId;
      alias: string;
      mode: "link";
    }
  | {
      repositoryId: RepositoryId;
      alias: string;
      mode: "worktree";
      branch: string;
      worktreePath: string;
      detached?: true;
    };

export interface WorkspaceRecord {
  id: WorkspaceId;
  name: string;
  absolutePath: string;
  members: WorkspaceMember[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceRegistry {
  schemaVersion: 1;
  workspaces: WorkspaceRecord[];
}

export interface RepositoryRecord {
  id: RepositoryId;
  kind: RepositoryKind;
  name: string;
  classificationPath: string;
  absolutePath: string;
  isManaged: boolean;
  canonicalRemote?: string;
  remoteUrl?: string;
  host?: string;
  ownerPath?: string[];
  registeredAt: string;
  lastSeenAt: string;
}

export interface RepositoryRegistry {
  schemaVersion: 1;
  repositories: RepositoryRecord[];
}

export interface InitializeInput {
  rootDir?: string;
  workspaceRoot?: string;
  scanRoots?: string[];
}

export interface UpdateConfigInput {
  rootDir?: string;
  workspaceRoot?: string;
  scanRoots?: string[];
}

export interface RegisterRepositoryInput {
  path: string;
}

export interface CloneRepositoryInput {
  remote: string;
  depth?: number;
}

export interface DiscoverRepositoriesInput {
  paths?: string[];
}

export interface DiscoveredRepository {
  absolutePath: string;
  kind: RepositoryKind;
  name: string;
  classificationPath: string;
  canonicalRemote?: string;
  isRegistered: boolean;
}

export interface DiscoveryResult {
  repositories: DiscoveredRepository[];
}

export interface OrganizePlan {
  repositoryId: RepositoryId;
  source: string;
  target: string;
  isNoop: boolean;
  warnings: string[];
}

export interface SearchRepositoriesInput {
  query?: string;
}

export interface CreateWorkspaceInput {
  name: string;
  path?: string;
}

export interface SearchWorkspacesInput {
  query?: string;
}

export interface CloneWorkspaceInput {
  sourceWorkspaceId: WorkspaceId;
  name: string;
  repositoryIds: RepositoryId[];
  branchName?: string;
  referenceRepositoryIds?: RepositoryId[];
}

export type AddWorkspaceMemberInput = {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
  alias?: string;
} & (
  | { mode?: "link" }
  | {
      mode: "worktree";
      branch?: string;
      createBranch?: boolean;
      startPoint?: string;
      detached?: boolean;
    }
);

export interface RemoveWorkspaceMemberInput {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
}

export interface PromoteWorkspaceReferenceInput {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
  branch: string;
}

export interface ConvertWorkspaceToReferenceInput {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
}

export interface WorkspaceGitActionInput {
  workspaceId: WorkspaceId;
  repositoryId: RepositoryId;
}

export interface WorkspaceMemberStatus {
  repositoryId: RepositoryId;
  branch: string;
  detached: boolean;
  defaultBranch?: string;
  ahead?: number;
  behind?: number;
  upstream?: string;
  unpushed?: number;
  changes: string[];
  conflicts: string[];
  comparisonError?: string;
}

export interface WorkspaceStatusResult {
  workspaceId: WorkspaceId;
  checkedAt: string;
  members: WorkspaceMemberStatus[];
}

export interface WorkspaceStatusRegistry {
  schemaVersion: 1;
  statuses: WorkspaceStatusResult[];
}

export interface WorkspaceSyncIssue {
  repositoryId: RepositoryId;
  alias: string;
  code: "MISSING_REPOSITORY" | "CONFLICT";
  message: string;
}

export interface WorkspaceSyncResult {
  workspace: WorkspaceRecord;
  repaired: RepositoryId[];
  issues: WorkspaceSyncIssue[];
}

export interface WorkspaceMigrationResult {
  workspaces: WorkspaceRecord[];
  migrated: number;
}

export interface RepositoryManagerOptions {
  dataDir?: string;
  defaultRootDir?: string;
}

export interface RepositoryManager {
  initialize(input?: InitializeInput): Promise<ManagerConfig>;
  getConfig(): Promise<ManagerConfig>;
  updateConfig(input: UpdateConfigInput): Promise<ManagerConfig>;
  clone(input: CloneRepositoryInput): Promise<RepositoryRecord>;
  discover(input?: DiscoverRepositoriesInput): Promise<DiscoveryResult>;
  register(input: RegisterRepositoryInput): Promise<RepositoryRecord>;
  search(input?: SearchRepositoriesInput): Promise<RepositoryRecord[]>;
  planOrganize(id: RepositoryId): Promise<OrganizePlan>;
  organize(plan: OrganizePlan): Promise<RepositoryRecord>;
  forget(id: RepositoryId): Promise<void>;
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
  cloneWorkspace(input: CloneWorkspaceInput): Promise<WorkspaceRecord>;
  searchWorkspaces(input?: SearchWorkspacesInput): Promise<WorkspaceRecord[]>;
  addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<WorkspaceRecord>;
  removeWorkspaceMember(input: RemoveWorkspaceMemberInput): Promise<WorkspaceRecord>;
  promoteWorkspaceReference(input: PromoteWorkspaceReferenceInput): Promise<WorkspaceRecord>;
  convertWorkspaceToReference(input: ConvertWorkspaceToReferenceInput): Promise<WorkspaceRecord>;
  rebaseWorkspaceMember(input: WorkspaceGitActionInput): Promise<void>;
  pushWorkspaceMember(input: WorkspaceGitActionInput): Promise<void>;
  getWorkspaceStatus(id: WorkspaceId, fetchRemote?: boolean): Promise<WorkspaceStatusResult>;
  getWorkspaceStatuses(): Promise<WorkspaceStatusResult[]>;
  syncWorkspace(id: WorkspaceId): Promise<WorkspaceSyncResult>;
  migrateWorkspaces(ids?: WorkspaceId[]): Promise<WorkspaceMigrationResult>;
  deleteWorkspace(id: WorkspaceId): Promise<void>;
}
