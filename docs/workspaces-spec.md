# Spec: Workspace Management

Status: Approved

## Objective

Add first-class workspaces to Compulsive so one registered repository can participate in multiple
project groups without creating duplicate clones or abandoning the canonical
`<host>/<owner>/<repo>` repository layout.

A workspace is a named directory plus versioned metadata. Each member uses one of two modes:

- `link`: the workspace contains a symbolic link to the registered repository. Multiple workspaces
  may share the same checkout, branch, and uncommitted changes.
- `worktree`: the workspace contains a Git worktree backed by the registered repository. Commits and
  objects are shared, while the checked-out branch, files, dependencies, and build output are
  isolated.

The feature targets a single-user macOS workflow and remains usable from scripts through stable JSON
output and exit codes.

## Assumptions

1. Repository storage remains authoritative. Adding a repository to a workspace never moves or
   clones its canonical checkout.
2. `link` is the default because it is fast, transparent, and sufficient for organizational views.
3. `worktree` requires an explicit branch. Existing branches are reused only when Git allows it;
   creating a branch requires an explicit `--create-branch` flag.
4. The default workspace root is a `Workspaces` sibling of the configured repository root. For
   example, `/Users/your-name/Code` produces `/Users/your-name/Workspaces`.
5. `workspaceRoot` can be set during initialization, in `compulsive.config.*`, or through
   `cpl config set-workspace-root`.
6. Workspace deletion removes only Compulsive-managed links and clean Git worktrees. It never
   deletes a registered canonical repository or unrelated user files.
7. IDE-specific project generation is outside this version. Workspace directories remain compatible
   with terminals and IDEs that can open folders containing links or Git worktrees.

## CLI Contract

`workspace` is the canonical command and `ws` is its exact alias.

```bash
cpl workspace create <name> [--path <path>] [--json]
cpl workspace list [query] [--json]
cpl workspace show <workspace-query> [--json]
cpl workspace add <workspace-query> <repository-query> [--alias <name>] [--json]
cpl workspace add <workspace-query> <repository-query> --worktree --branch <branch> [--create-branch] [--alias <name>] [--json]
cpl workspace remove <workspace-query> <repository-query> [--yes] [--json]
cpl workspace sync [workspace-query] [--json]
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

Project configuration accepts an additive field:

```ts
import { defineConfig } from "@adrian-zephyr/compulsive";

export default defineConfig({
  rootDir: "/Users/your-name/Code",
  workspaceRoot: "/Users/your-name/Workspaces",
});
```

Persistent manager configuration gains `workspaceRoot`. Existing schema-version-1 configuration
without this field is accepted and derives the sibling default. The next configuration write stores
the derived absolute path; existing `rootDir` and `scanRoots` remain unchanged.

## Data Model

Workspace metadata is stored atomically at `CPL_HOME/workspaces.json` with `schemaVersion: 1`.

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
- Worktree paths must equal `<workspace.absolutePath>/<alias>` and cannot escape the workspace.

## Public Library API

The existing `RepositoryManager` is extended additively:

```ts
interface RepositoryManager {
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceRecord>;
  searchWorkspaces(input?: SearchWorkspacesInput): Promise<WorkspaceRecord[]>;
  addWorkspaceMember(input: AddWorkspaceMemberInput): Promise<WorkspaceRecord>;
  removeWorkspaceMember(input: RemoveWorkspaceMemberInput): Promise<WorkspaceRecord>;
  syncWorkspace(id: WorkspaceId): Promise<WorkspaceSyncResult>;
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

1. Require `--branch` and validate the target workspace member path.
2. Run Git with argument arrays only:
   - Existing branch: `git -C <repository> worktree add -- <path> <branch>`.
   - New branch: `git -C <repository> worktree add -b <branch> -- <path>`.
3. Verify the target is a Git worktree associated with the registered repository.
4. Atomically persist the member.

Git rejects a branch already checked out by another worktree. Compulsive surfaces this as a conflict
and does not retry with a different branch.

If persistence fails, Compulsive removes the newly created clean worktree through
`git worktree remove`; inability to roll back is a filesystem failure with both errors attached.

## Remove and Delete Safety

Removing a `link` member:

- Verify the path is a symbolic link resolving to the indexed repository.
- Remove only that link, then update workspace metadata.
- Refuse unexpected files, directories, or links.

Removing a `worktree` member:

- Verify it belongs to the expected repository.
- Require an empty `git status --porcelain` result.
- Run `git worktree remove -- <path>` without `--force`.
- Update metadata only after Git confirms removal.

Deleting a workspace:

- Preflight every member before changing anything.
- Refuse deletion when any worktree is dirty or any member path is unexpected.
- Remove managed members, then remove the workspace record atomically.
- Remove the workspace directory only when it is empty or contains only `.DS_Store`.
- Leave non-member user files and the directory itself untouched.
- Never delete a canonical repository, branch, commit, or remote.

The CLI requires confirmation unless `--yes` is supplied. JSON mode remains non-interactive.

## Repository Move Integration

After `organize` successfully moves and indexes a repository, Compulsive synchronizes all `link`
members referencing that repository. Worktree members require no path repair because they are
independent working directories.

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

## Project Structure

```text
src/types.ts             Public workspace contracts
src/storage.ts           Workspace registry validation and atomic persistence
src/workspaces.ts        Workspace lifecycle and filesystem/Git safety logic
src/manager.ts           RepositoryManager integration and organize synchronization
src/cli.ts               workspace/ws commands and query resolution
src/terminal.ts          Combined repository/workspace interactive selectors
src/file-config.ts       workspaceRoot configuration
tests/workspaces.test.ts Unit/integration lifecycle tests
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
- unexpected workspace files and links are preserved;
- existing schema-version-1 config derives `workspaceRoot` safely;
- interactive and non-interactive ambiguity behavior;
- JSON stdout contains one value and diagnostics remain on stderr;
- paths containing spaces, Chinese characters, and single quotes.

Verification commands:

```bash
vp check src tests docs/workspaces-spec.md vite.config.ts
vp test --run
vp pack --dts --publint --attw
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
- delete a canonical repository or unrelated workspace file;
- store credentials in workspace metadata.

## Success Criteria

1. A registered repository can be linked into two workspaces without duplication.
2. Two worktree members can use different branches and retain independent uncommitted state.
3. Workspace creation, listing, inspection, navigation, synchronization, member removal, and deletion
   work through both human-readable and JSON CLI modes.
4. Direct `cpl` interaction can open either a repository or workspace through searchable selection.
5. Organizing a repository repairs every managed link that references it.
6. Dirty worktrees and unexpected filesystem entries block removal without losing data.
7. Existing installations initialize workspace storage without losing or rewriting repository data.
8. All verification commands pass, followed by a tarball-installed CLI smoke test using temporary
   repositories only.

## Resolved Decisions

1. `workspaceRoot` defaults to a sibling `Workspaces` directory.
2. `cpl workspace delete` removes clean managed worktrees automatically and refuses dirty ones.
3. `--create-branch` creates the exact branch name supplied through `--branch`.
