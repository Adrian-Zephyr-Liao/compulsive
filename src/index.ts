export { CompulsiveError } from "./errors.js";
export type { CompulsiveErrorCode } from "./errors.js";
export { parseGitRemote } from "./git-url.js";
export { createRepositoryManager } from "./manager.js";
export { formatCdCommand, quoteZsh } from "./shell.js";
export type {
  CloneRepositoryInput,
  DiscoveredRepository,
  DiscoverRepositoriesInput,
  DiscoveryResult,
  InitializeInput,
  ManagerConfig,
  OrganizePlan,
  RegisterRepositoryInput,
  RepositoryClassification,
  RepositoryId,
  RepositoryKind,
  RepositoryManager,
  RepositoryManagerOptions,
  RepositoryRecord,
  SearchRepositoriesInput,
  UpdateConfigInput,
} from "./types.js";
