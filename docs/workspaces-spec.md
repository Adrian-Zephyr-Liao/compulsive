# Spec: Workspace Management

Status: Approved

## Objective

Add first-class workspaces to Compulsive so one registered repository can participate in multiple
project groups without creating duplicate clones or abandoning the canonical
`<host>/<owner>/<repo>` repository layout.

A workspace is a named directory plus versioned metadata. Each member uses one of two modes:

- `link`: the workspace contains a symbolic link to the registered repository. Multiple workspaces
  may share the same checkout, branch, and uncommitted changes.
- `worktree`: the registered repository contains a physical Git worktree under `.worktrees/`; the
  workspace contains a symbolic link to it. Commits and objects are shared, while the checked-out
  branch, files, dependencies, and build output are isolated.

The feature targets a single-user macOS workflow and remains usable from scripts through stable JSON
output and exit codes.

## Assumptions

1. Repository storage remains authoritative. Adding a repository to a workspace never moves or
   clones its canonical checkout.
2. CLI additions default to isolated `worktree` members. Link members remain readable for backward
   compatibility and through the library API.
3. Without `--branch`, the CLI uses a workspace-specific branch. `--create-branch` creates the exact
   named branch, fetching and tracking a same-name `origin` branch when available; otherwise the new
   local branch has no upstream and starts at the requested start point or current commit. Existing
   local branches are reused. Legacy migration has its own upstream inheritance rule below.
4. The default workspace root is a `Workspaces` sibling of the configured repository root. For
   example, `/Users/your-name/Code` produces `/Users/your-name/Workspaces`.
5. `workspaceRoot` can be set during library initialization or through
   `cpl config set-workspace-root`.
6. Workspace deletion preflights managed links and clean Git worktrees, then removes the entire
   registered Workspace directory, including non-member files. Canonical repositories are preserved;
   protected roots and nested registered Workspaces block deletion.
7. IDE-specific project generation is outside this version. Workspace directories remain compatible
   with terminals and IDEs that can open folders containing links or Git worktrees.

## CLI Contract

`workspace` is the canonical command and `ws` is its exact alias.

```bash
cpl workspace create <name> [--path <path>] [--json]
cpl workspace list [query] [--json]
cpl workspace show <workspace-query> [--json]
cpl workspace add <workspace-query> <repository-query> [--branch <branch>] [--create-branch] [--alias <name>] [--json]
cpl workspace remove <workspace-query> <repository-query> [--yes] [--json]
cpl workspace sync [workspace-query] [--json]
cpl workspace migrate [workspace-query] [--yes] [--json]
cpl workspace go <workspace-query> [--json]
cpl workspace delete <workspace-query> [--yes] [--json]
```

Interactive behavior:

- `cpl` opens a searchable combined picker containing repositories and workspaces.
- `cpl workspace` and `cpl ws` open a searchable workspace picker in a TTY.
- Ambiguous workspace or repository queries use the existing searchable picker in a TTY.
- Non-interactive ambiguity returns exit code `4`.
- Interactive cancellation exits successfully without changing state.

Search integration:

```bash
cpl search <query> --workspace <workspace-query> [--json]
```

The filter searches only repositories that belong to the selected workspace. Workspace names and
member aliases are also searchable through the interactive combined picker.

## Configuration Contract

Persistent manager configuration includes `workspaceRoot` and is managed through
`cpl config set-workspace-root <path>`. Existing schema-version-1 configuration without this field
is accepted and derives the sibling default. The next configuration write stores the derived
absolute path; existing `rootDir` and `scanRoots` remain unchanged. No project-level configuration
file is loaded.

## Data Model

Workspace metadata is stored atomically at `CPL_HOME/workspaces.json` with `schemaVersion: 1`.
The core fields below are an orientation excerpt; [src/types.ts](../src/types.ts) owns complete public
types, including optional detached reference-checkout metadata and later API additions.

```ts
type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
type WorkspaceMemberMode = "link" | "worktree";

interface WorkspaceRecord {
  id: WorkspaceId;
  name: string;
  absolutePath: string;
  members: WorkspaceMember[];
  createdAt: string;
  updatedAt: string;
}

type WorkspaceMember =
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
    };

interface WorkspaceRegistry {
  schemaVersion: 1;
  workspaces: WorkspaceRecord[];
}
```

Constraints:

- Workspace names are unique case-insensitively.
- Workspace paths are unique after canonical path resolution.
- A repository appears at most once in a workspace.
- Member aliases are unique case-insensitively within a workspace.
- Names and aliases are one safe path segment: no empty value, `.`, `..`, slash, backslash, or NUL.
- Repository references use `RepositoryId`, never remote credentials or copied repository records.
- New worktree paths equal `<repository.absolutePath>/.worktrees/<workspace.name>`; the Workspace
  member path is an absolute symbolic link to that directory. Legacy direct paths remain readable
  until migrated.

## Public Library API

The existing `RepositoryManager` is extended additively:

```ts
interface RepositoryManager {
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
  searchWorkspaces(input?: SearchWorkspacesInput): Promise<WorkspaceRecord[]>;
  addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<WorkspaceRecord>;
  removeWorkspaceMember(input: RemoveWorkspaceMemberInput): Promise<WorkspaceRecord>;
  syncWorkspace(id: WorkspaceId): Promise<WorkspaceSyncResult>;
  migrateWorkspaces(ids?: WorkspaceId[]): Promise<WorkspaceMigrationResult>;
  deleteWorkspace(id: WorkspaceId): Promise<void>;
}
```

Inputs use workspace and repository IDs. Query resolution, ambiguity prompts, confirmation, and
human-readable formatting remain CLI responsibilities.

## Link Mode Lifecycle

1. Resolve and validate the workspace and registered repository.
2. Reject duplicate membership or an occupied `<workspace>/<alias>` path.
3. Create an absolute symbolic link to the repository's current indexed path.
4. Verify the link resolves to that repository.
5. Atomically append the member to `workspaces.json`.

If persistence fails, remove the newly created link. Existing user files are never overwritten.

`syncWorkspace` verifies every link. A missing or broken managed link is recreated from the current
repository index. A path occupied by a normal file, directory, or unexpected link is reported as a
conflict and left untouched.

## Worktree Mode Lifecycle

1. Resolve the explicit branch or create a workspace-specific default branch, then validate both
   the Workspace member path and the repository-owned `<repository>/.worktrees/<workspace>` target.
2. Run Git with argument arrays only:
   - Existing branch: `git -C <repository> worktree add -- <target> <branch>`.
   - New branch: `git -C <repository> worktree add -b <branch> -- <target>`.
3. Add `/.worktrees/` to the repository-local Git exclude file.
4. Verify the target, then create an absolute symbolic link at `<workspace>/<alias>`.
5. Atomically persist the member.

Git rejects a branch already checked out by another worktree. Compulsive surfaces this as a conflict
and does not retry with a different branch.

### Development on the remote default branch

The DevTool's create/clone and add-repository forms allow a per-repository default-branch choice.
`AddWorkspaceMemberInput.useDefaultBranch` resolves origin's advertised HEAD server-side and uses
that local branch, creating it with the matching remote upstream only when it does not exist.
It cannot be combined with an explicit branch, start point or detached mode. Existing local commits
are not reset to the remote tip, and occupied branches retain Git's normal checkout protection.

`CloneWorkspaceInput.defaultBranchRepositoryIds` selects this behavior alongside independent
`repositoryBranches` and detached `referenceRepositoryIds`. These IDs must be unique selected
development repositories and cannot also have an explicit repository branch. All selected defaults
are fetched before creating the target, and existing clone rollback rules remain in force.
The resulting member is an ordinary non-detached worktree; no new registry format or CLI flag is
introduced. Neither path creates a requirement-specific branch for these repositories.

If persistence fails, Compulsive removes the newly created clean worktree through
`git worktree remove`; inability to roll back is a filesystem failure with both errors attached.

`workspace migrate` preflights every selected legacy worktree, moves deepest paths first with
`git worktree move`, preserves dirty state, replaces each old path with a link, and writes the
registry once. A legacy branch without an upstream inherits the canonical checkout's current
upstream. A move or persistence failure rolls completed moves and tracking changes back.
For worktrees declaring submodules, migration renames the verified worktree and runs
`git worktree repair`; other Git move failures are not bypassed.
Overlapping legacy worktree paths are rejected during preflight because replacing a nested Git
submodule checkout with a symbolic link can invalidate the parent worktree.

## Batch branch synchronization

`RepositoryManager.syncWorkspaceBranches` and its DevTool RPC operate on the verified physical
worktree of each member, not the canonical checkout. Legacy directory links are skipped. Managed
members are processed independently so one failure does not suppress another member's result.

1. Verify membership, repository identity, branch and managed link. Reject conflicts and unfinished
   merge/rebase/cherry-pick/revert operations before changing files.
2. Save staged, unstaged and untracked changes with `stash push --include-untracked`. Locate the
   backup by its unique message and immutable object ID; never assume it is `stash@{0}`.
3. Fetch the remote default branch and the exact same-name development branch. A detached reference
   checkout updates to the default branch. Development checkouts first rebase the same-name remote
   branch to retain remote work, then rebase the default branch. A branch already awaiting a reviewed
   force push keeps its original remote lease and does not replay old published history.
   Reject incoming paths that would overwrite ignored local files; ignored dependencies are not
   collected into the stash. Detached checkout updates also disable overwriting ignored paths.
4. Push only committed history with an ordinary push when fast-forward is possible. Otherwise return
   `push-required`, retain the original `forcePushBase`, and require explicit safe-force confirmation.
   Do not automatically force push. A completed development branch may still be skipped.
5. Restore saved work with `stash apply --index <oid>` after a safe completion or failure. Never
   restore over an unfinished Git operation or edits made while sync was running. Rebase conflicts
   retain their current Git state and stash backup, and do not push. A failed restore may be partial;
   inspect it before recovery rather than blindly reapplying the stash.

Successful restore leaves the backup in Git stash; no stash entry is dropped. Explicit safe force
push uses the same temporary-save/restore flow when local changes were restored by batch sync.
Ordinary individual push/rebase keeps its existing clean-worktree requirement. Per-worktree locks
cover sync/rebase/push calls in the current process only; external tools and other CPL processes are
not locked. Pause external edits during synchronization.

`WorkspaceBranchSyncItem` reports `synced`, `skipped`, `conflict`, `failed` or `push-required`, a
human-readable reason, an optional operation `phase`, and optional `backup: { oid, restored }`.
These are operation results, not a new on-disk journal. The DevTool refreshes membership and status,
lists non-success outcomes by alias, and keeps actionable results visible. Conflict handling uses
the existing VS Code / explicitly requested Codex paths; batch sync does not start an AI task itself.

## Remove and Delete Safety

Removing a `link` member:

- Verify the path is a symbolic link resolving to the indexed repository.
- Remove only that link, then update workspace metadata.
- Refuse unexpected files, directories, or links.

Removing a `worktree` member:

- Verify it belongs to the expected repository.
- Verify the Workspace link resolves to the recorded physical worktree.
- Require an empty `git status --porcelain` result.
- Run `git worktree remove -- <path>` without `--force`.
- Update metadata only after Git confirms removal.

Deleting a workspace:

- Preflight every member before changing anything.
- Refuse deletion when any worktree is dirty or any member path is unexpected.
- Remove managed members, then remove the workspace record atomically.
- Reject the filesystem root, home, configured repository/Workspace roots and their ancestors, and a
  directory containing any registered canonical repository or another registered Workspace before changing members.
- Resolve configured root aliases to their physical paths before checking protection; a symbolic-link
  setting does not permit deleting the underlying storage directory.
- Rename the registered directory to a sibling deletion path before committing the registry change;
  roll back the directory before restoring removed members if that transaction fails. Detached
  checkouts are restored at their captured commit, not a possibly advanced remote ref.
- Recursively remove the deletion directory, including non-member files. A failure after unregistering
  reports the retained deletion path; it does not claim full removal.
- Never delete a canonical repository, branch, commit, or remote.

The CLI requires confirmation unless `--yes` is supplied. JSON mode remains non-interactive.

## Repository Move Integration

After `organize` successfully moves and indexes a repository, Compulsive synchronizes all `link`
members referencing that repository.

If link synchronization encounters a conflict, the repository remains safely organized and the CLI
returns a filesystem/conflict diagnostic naming the affected workspace. `cpl workspace sync` and
`cpl doctor` provide recovery without another repository move.

## Doctor Checks

`cpl doctor` adds workspace checks for:

- readable and atomically valid workspace registry;
- writable configured workspace root;
- unique workspace names, paths, members, and aliases;
- missing repositories referenced by workspace members;
- broken or unexpected symbolic links;
- missing, dirty, or mismatched Git worktrees.

Doctor is read-only and never repairs state automatically.

### Worktree inventory and explicit removal

`cpl doctor worktrees [--all] [--json]` is a separate on-demand inventory. Its schema-version-1 report
does not replace the existing `cpl doctor --json` check array. It compares all CPL member references
(including legacy/link paths), Git's linked worktrees and immediate `.worktrees` directories of
managed repositories. Primary checkouts are excluded. Missing, external and unregistered paths are
not evidence that CPL owns disposable data. Cached reports and fingerprint-specific ignores live
beside configuration in `worktree-audit.json` and `worktree-audit-ignores.json`. No fetch or automatic
cleanup is performed. Cancelled/failed inspections retain an incomplete-report marker.

The DevTool's explicit removal action re-inspects the selected target and requires its complete
path and fresh fingerprint. All candidates can be selected. References, tracked/untracked changes,
conflicts, unfinished operations, locks, submodules, detached HEADs without local retention, missing
registrations and unregistered directories are overridable only by a separate `force: true`
confirmation. Primary/canonical repositories, protected roots, nested registered paths and identity
changes remain hard blockers. An unpublished commit on a retained local branch is only a warning.
Ignored paths still require a separate opt-in; ignored directories are summarized, not individually
audited or fingerprinted.

Ordinary removal uses `git worktree remove`; explicit force uses two force flags to include locked
worktrees. Missing registrations are removed one at a time, never by bulk prune. Explicitly confirmed
unregistered directories use recursive removal; leaf symlinks are unlinked without following them.
Deletion verifies both directory and Git registration are absent and preserves branches. Detached
HEAD commits are retained under `refs/cpl/removed-worktrees/` before force removal. Affected member
records and matching managed symlinks are removed afterward; unexpected paths remain untouched.
Metadata/cache cleanup failures after disk deletion are returned as successful deletion with a
warning, not as a deletion to blindly retry. Deletion is permanent, not Trash-backed; stop concurrent
editing/tasks before confirmation. This explicit Doctor action does not weaken ordinary Workspace
member deletion's existing clean-worktree rules.

## Project Structure

```text
src/types.ts             Public workspace contracts
src/storage.ts           Workspace registry validation and atomic persistence
src/workspace-registry.ts Workspace creation/search, lookup and status persistence
src/workspace-members.ts Member lifecycle and branch/reference conversion
src/workspace-clone.ts    Selected-repository Workspace clone orchestration
src/workspace-sync.ts     Rebase, push and batch branch synchronization
src/workspace-sync-stash.ts Sync locks, stash recovery and ignored-path collision protection
src/workspace-maintenance.ts Link repair and legacy migration
src/workspace-deletion.ts Workspace deletion preflight and transaction
src/workspace-paths.ts    Shared link/path checks and rollback execution
src/workspace-worktrees.ts Physical worktree operations and identity/cleanliness checks
src/manager.ts           RepositoryManager integration and organize synchronization
src/cli.ts               workspace/ws commands and query resolution
src/terminal.ts          Combined repository/workspace interactive selectors
src/storage.ts           manager and workspace configuration persistence
tests/workspaces.test.ts Core lifecycle regression tests
tests/workspace-clone.test.ts Selected clone and rollback regression
tests/workspace-branches-integration.test.ts Independent reference/development Git scenarios
tests/workspace-migration.test.ts Dirty submodule migration regression
tests/workspace-cli.test.ts CLI and interactive contract tests
docs/workspaces-spec.md  Living feature specification
```

## Code Style

Use the project's existing explicit async API and discriminated unions:

```ts
if (member.mode === "worktree") {
  await assertCleanWorktree(member.worktreePath);
  await runGit(["worktree", "remove", "--", member.worktreePath], { cwd: repository.absolutePath });
}
```

Filesystem paths are absolute at persistence boundaries. Git commands always use argument arrays.
Errors use `CompulsiveError` and existing stable codes.

## Testing Strategy

Use Vitest with real temporary Git repositories and no network access.

Required coverage:

- one repository linked into multiple workspaces;
- link changes visible through both workspace paths;
- independent worktrees on different branches;
- Git rejection when the same branch is already checked out;
- alias and destination conflicts;
- link repair after repository organization;
- removal never deletes canonical repositories;
- dirty worktree removal and workspace deletion are rejected;
- unexpected member files/links block removal; non-member files are deleted with the Workspace;
- existing schema-version-1 config derives `workspaceRoot` safely;
- interactive and non-interactive ambiguity behavior;
- JSON stdout contains one value and diagnostics remain on stderr;
- paths containing spaces, Chinese characters, and single quotes.

Verification commands:

```bash
pnpm run check
pnpm run test tests/workspaces.test.ts tests/workspace-cli.test.ts
pnpm run prepack
npm pack --dry-run
```

## Boundaries

Always:

- preflight all destructive workspace operations;
- verify link/worktree identity before removing a path;
- use atomic JSON writes and preserve repository records;
- keep link mode and worktree mode explicit in structured output;
- keep existing CLI and library behavior backward compatible.

Ask first:

- adding a new runtime dependency;
- generating IDE-specific workspace files;
- introducing forced worktree deletion;
- changing the canonical repository classification layout.

Never:

- duplicate repositories with an implicit `git clone`;
- overwrite an occupied workspace member path;
- remove a dirty worktree;
- delete a canonical repository, protected root, or nested registered Workspace;
- store credentials in workspace metadata.

## Success Criteria

1. A registered repository can be linked into two workspaces without duplication.
2. Two worktree members can use different branches and retain independent uncommitted state.
3. Workspace creation, listing, inspection, navigation, synchronization, member removal, and deletion
   work through both human-readable and JSON CLI modes.
4. Direct `cpl` interaction can open either a repository or workspace through searchable selection.
5. Organizing a repository repairs every managed link that references it.
6. Dirty worktrees and unexpected member paths block removal without losing data; successful Workspace
   deletion removes its whole registered directory while preserving canonical repositories.
7. Existing installations initialize workspace storage without losing or rewriting repository data.
8. All verification commands pass, followed by a tarball-installed CLI smoke test using temporary
   repositories only.

## Resolved Decisions

1. `workspaceRoot` defaults to a sibling `Workspaces` directory.
2. `cpl workspace delete` removes clean managed worktrees automatically and refuses dirty ones.
3. `--create-branch` creates the exact branch name supplied through `--branch`.
