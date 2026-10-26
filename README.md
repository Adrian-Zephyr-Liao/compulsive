# Compulsive

English · [简体中文](./README.zh-CN.md)

**Your repository home for the AI era.**

AI has changed how software is built. One developer can now explore more frameworks, run more
experiments, and maintain more agent-generated projects than ever before. The bottleneck is no
longer creating a repository—it is remembering where every repository lives, finding it again, and
keeping related projects organized without duplicating or losing work.

Compulsive is a macOS-first local Git repository manager. Its `cpl` command gives every repository
a predictable canonical home, makes the entire collection searchable, and lets multiple Workspaces
reuse the same repository through links or isolated Git worktrees.

## Highlights

- Classify remote repositories as `<host>/<owner...>/<repo>`.
- Keep repositories without a remote under `local/<repo>`.
- Discover and register existing repositories without moving them unexpectedly.
- Preview every move and protect dirty repositories, nested repositories, and occupied targets.
- Search repositories and Workspaces from scripts or an interactive terminal picker.
- Reuse one canonical repository across multiple Workspaces without duplicate clones.
- Copy a safely quoted `cd -- 'path'` command after clone, navigation, or organization.

## Install

```bash
npm install --global @adrian-zephyr/compulsive
cpl init
```

Initialization also installs a marker-delimited CPL workflow section in `~/.codex/AGENTS.md`.
Existing content outside that section is preserved, and rerunning `cpl init` refreshes it safely.

Use a custom managed root during first initialization:

```bash
cpl init --root /Users/your-name/Code
```

Initialization is idempotent. Running it again does not replace the existing root or repository
index.

## Quick start

```bash
cpl clone https://github.com/vuejs/core.git
cpl add /Users/your-name/Projects/my-local-tool
cpl scan /Users/your-name/Projects
cpl scan /Users/your-name/Projects --register
cpl list
cpl search core
cpl go core
cpl organize my-local-tool --dry-run
cpl organize my-local-tool --yes
cpl doctor
```

Run `cpl` without a command in an interactive terminal to open a searchable repository and
Workspace picker.

### Local editor

Choose **Open editor** in a requirement's repository row to enter a local workbench inspired by
[Mayoi](https://github.com/sorrycc/Mayoi). It uses React, Ant Design, CodeMirror 6 and xterm.js;
it does not copy Mayoi's native runtime or connect SSH/cloud accounts.

- Edit and save files, create/rename folders and files, and move items to the OS Trash.
- Start in **Changes / Diff** to review saved local staged, unstaged and new files. Switch to
  **All files** when you need the full editor; unsaved buffers stay intact. This is not a comparison
  of the whole branch against the remote main branch.
- Open files with `Cmd/Ctrl+P`, commands with `Cmd/Ctrl+Shift+P`, save with `Cmd/Ctrl+S`,
  split with `Cmd/Ctrl+\\`, and search inside a file with `Cmd/Ctrl+F`.
- Use folder search with replacement previews, independent editor columns, Markdown/SVG/image
  previews, and on-demand Git status, staging, diffs, commit history and branch operations.
- **Discard all changes** clears staged, unstaged and untracked changes; ignored files and commits
  remain. **No backup is selected by default**, with a second permanent-loss confirmation. Select
  **Keep a Git stash backup** for a recovery command instead. Save buffers and pause external writes
  first. Conflicts, unfinished Git operations and unsafe/excluded files block either mode.
- **Generate with Codex** sends only the staged patch after confirmation and fills in the commit
  message for review. It uses the installed, signed-in CLI's default model without custom configuration
  or project context, and never stages, commits or pushes automatically.
- Start real local terminals explicitly. **A terminal is not a sandbox**: it runs with your system
  user's permissions. Shells start in the selected member, but can access other machine paths.
- Switch the **global dark/light mode** from the page header or editor preferences. Requirements,
  settings, editor and overlays share one theme, saved in `devtool-preferences.json` beside CPL config.
  Font, wrapping, Vim, opt-in auto save and layout remain in `editor-sessions.json`; source text and terminal output are not persisted.

Saves check the loaded file version and reject external changes instead of overwriting them.
Unsaved tabs require a choice before closing/leaving. Filesystem events refresh clean documents;
Git is checked on demand, not polled. Terminal sessions are bounded and end on close/server shutdown;
unattached sessions expire after 20 minutes. File content stays local except when you explicitly
confirm sending a staged patch to Codex for a commit message.

Filesystem queries are limited to current requirement members, exclude symlinks, Git metadata,
dependency/worktree directories and common environment/key files, and accept UTF-8 text/images
up to 4 MiB. A directory read examines at most 1,000 entries and reports truncation. These exclusions
are not a general secret detector. Use **Open in VS Code** for unsupported files and larger projects.
Recoverable deletion uses macOS's system `trash` command (macOS 15+); when unavailable, deletion is
blocked and the file manager remains the safe alternative.

### Worktree audit

Use **System settings → Environment diagnostics → Worktree audit**, or run:

```bash
cpl doctor worktrees
cpl doctor worktrees --all --json
```

The audit compares CPL requirement references, Git's linked-worktree registrations, and immediate
children of managed repositories' `.worktrees` directories. It excludes primary checkouts and
distinguishes referenced, unreferenced, external, missing, and unregistered paths. Details include
tracked/untracked/ignored files, conflicts, unfinished Git operations, locks, HEAD, and unpublished
commits based on **cached remote refs**. No fetch, deletion, or prune is performed. An unreferenced
or clean worktree is **not** proof that it is disposable; a missing path can be moved or offline.

Scans are manual and cancellable. Incomplete reports retain errors and never imply a healthy scan.
Reports and fingerprint-based ignore choices are stored beside CPL's `config.json`, in
`worktree-audit.json` and `worktree-audit-ignores.json`, not in browser storage. Ignored findings
resurface after relevant changes on a subsequent scan. The UI supports details, VS Code opening
for registered directories, and local JSON export (which includes local paths and file names).
The existing `cpl doctor --json` check-array format is unchanged.

To remove a reviewed worktree, choose **Delete worktree** in the audit table. CPL checks its live
state again and requires the complete path as confirmation. Every candidate can open this preview.
Dirty, conflicted, locked, referenced or unfinished worktrees, submodules, missing registrations and
unregistered directories require an additional **Force delete** confirmation. Git registrations are
removed individually; no bulk prune is used. Unregistered directories are recursively removed only
after this explicit confirmation, and symlinks are unlinked without following their targets.
Primary/canonical repositories, protected roots and changed identities remain non-overridable.

Local branches are retained. Detached HEAD commits receive a recovery ref under
`refs/cpl/removed-worktrees/` before force removal; create a branch from the displayed ref to recover
the commit. Affected requirement memberships and managed symlinks are cleaned after deletion.
Ignored files/directories require their own opt-in (they may contain local configuration or secrets);
ignored directories are summarized, not audited file by file. Force deletion permanently discards
uncommitted/untracked data and unfinished operations, without Trash. Stop editors/tasks in the target
before confirming. Ordinary requirement-member deletion keeps its existing clean-worktree checks.

Open the local Workspace DevTool to create Workspaces, add only the repositories a task needs,
sync worktrees, and copy the resulting `cd` command:

```bash
cpl ui
```

The DevTool is served on localhost with Devframe authentication and opens in the browser. Use
`cpl ui --no-open` to start it without opening a new tab.

## Workspace DevTool

The DevTool is the daily control plane for task-oriented Workspaces. It keeps the repository table
wide enough to scan, places common actions above the table, and runs remote status checks only when
requested.

![Compulsive Workspace DevTool with redacted example data](./docs/assets/compulsive-devtool-redacted.png)

_Every name, remote, branch, and filesystem path in this screenshot is synthetic._

Use it to:

- Create a Workspace or clone selected repositories from an existing Workspace.
- Add a repository as an isolated development worktree or a detached reference checkout.
- Choose, create, and later switch development branches; an existing remote branch is tracked
  automatically.
- Convert a reference checkout to a development worktree and back again when the task changes.
- Refresh reference checkouts from the remote default branch without creating local branches.
- Create/clone requirements and add repositories with per-repository default-branch development instead of a task branch. Origin's default is resolved automatically; a branch checked out elsewhere is not forcibly reused.
- Inspect uncommitted files, conflicts, ahead/behind counts, unpushed commits, and whether a remote
  development branch has been merged into the default branch.
- Batch-sync development branches with automatic stash, rebase and push; report skipped repositories,
  failures, conflicts and required safe force pushes by name.
- Open a member in VS Code, open the Workspace in ChatGPT, or hand a conflict to a dedicated Codex
  chat with full filesystem access.

Status is persisted with the rest of CPL's application data, so the last result survives a browser
or DevTool restart. There is no background polling; use **Check status** whenever fresh remote state
is needed.

### Rebase and push safety

Batch sync temporarily stashes staged, unstaged and untracked changes, including binary files. It
fetches the remote default branch (`origin/master` or `origin/main`), rebases onto the same-name remote
branch when needed to retain others' commits, then rebases onto the default branch and pushes. It
restores local changes with their staging state afterward; those changes are not committed or pushed.
Reference checkouts update while remaining detached. Existing unfinished Git operations block sync.
Rebase conflicts stop that repository before push; use **Handle conflicts** to open VS Code or
explicitly start Codex. The result includes the exact retained stash backup and its recovery state.
Inspect the working tree before recovering a pending backup; do not reapply a partially restored stash.
Backups remain in Git stash even after a successful restore; CPL does not drop existing or new stashes.

Normal branch divergence is synchronized with the exact same-name remote branch before a regular
push. When rebasing onto the remote default branch rewrites commits that were already pushed, the
DevTool records the pre-rebase remote commit, shows a red **Safe force push required** status, and
blocks a regular push. After confirmation it uses an explicit `--force-with-lease` bound to that
recorded commit. If the remote branch changed again, Git rejects the push instead of overwriting the
new work. Repeating a rebase or selecting the current branch does not refresh or clear this lease.
Batch sync never force-pushes automatically. Explicit safe force push temporarily stashes and restores
local changes too, so restoring work-in-progress does not block completing a reviewed push.
If the same-name remote branch contains commits absent from both the checkout and rebase destination,
synchronize that branch before rebasing; CPL will not authorize overwriting those unseen commits.

## Directory model

Remote repositories are classified by host, owner path, and repository name:

```text
/Users/your-name/Code/github.com/vuejs/core
/Users/your-name/Code/gitlab.com/group/subgroup/project
```

Repositories without an `origin` remote use the logical classification `local/<repository>` and
stay in their existing location until `cpl organize` is explicitly confirmed.

`clone`, `go`, and a completed `organize` copy a safely quoted `cd -- 'path'` command to the macOS
clipboard and print it. Clipboard failures are warnings and never turn a successful Git operation
into a failure.

## Search and migration

`scan` is read-only unless `--register` is present. Scan results include only newly discovered,
unregistered repositories, so rerunning a scan after migration does not list repositories that are
already organized. `forget` removes only the index entry and never deletes repository files.

To migrate a directory containing existing repositories, register the discoveries, preview every
target, and then confirm the batch:

```bash
cpl scan /Users/your-name/Projects --register
cpl organize --all --dry-run
cpl organize --all --yes
```

`organize --all` rereads each repository's current `origin` before planning, but outputs only
repositories whose canonical target has changed. A repository registered under `local/` is
automatically promoted to `github.com/...` after an `origin` is added. The dry run does not update
the index; classification changes are persisted only after the confirmed move succeeds. All
repositories are still preflighted, so a target conflict stops the batch before the first move.

## Workspaces

A Workspace groups related projects without changing their canonical storage locations. The
default Workspace root is a sibling of the repository root—for example,
`/Users/your-name/Workspaces` next to `/Users/your-name/Code`.

Workspace members use isolated Git worktrees by default. Without `--branch`, Compulsive creates a
`workspace/<workspace>/<alias>` branch from the canonical checkout's current commit:

```bash
cpl workspace create Product
cpl workspace create Platform
cpl workspace add Product api
cpl workspace add Platform api --alias shared-api
cpl workspace list
cpl workspace go Product
cpl search shared --workspace Platform
```

Use `--branch` to reuse an existing branch, or add `--create-branch` to create the exact branch:

```bash
cpl workspace add Product web --branch feature/product-web
cpl workspace add Product worker --branch feature/product-worker --create-branch
```

The physical worktree is stored at `<canonical-repository>/.worktrees/<workspace>`. The Workspace
member is an absolute symbolic link to it. With `--create-branch`, Compulsive fetches and tracks an
existing same-name branch on `origin`; otherwise it creates a local branch without an upstream from
the requested start point or the freshly fetched origin default branch. Only repositories without
origin fall back to the current commit. A remote lookup/fetch failure stops creation instead of using
a stale local baseline. Existing local branches are reused without rewriting their commits or
upstream. Migration only inherits an upstream for legacy branches that do not already have one.

Common maintenance commands:

```bash
cpl workspace sync Product
cpl workspace migrate --yes
cpl workspace remove Product api --yes
cpl workspace delete Product --yes
```

`workspace remove` deletes only the selected Compulsive-managed link or clean worktree.
`workspace delete` permanently deletes the entire registered Workspace directory after verifying
that managed worktrees are clean. Neither command deletes canonical repositories. Protected paths,
dirty worktrees, and nested registered Workspaces block deletion.

## Configuration

Compulsive keeps one persistent local configuration, managed through the CLI:

```bash
cpl config show
cpl config set-root /Users/your-name/Code
cpl config set-workspace-root /Users/your-name/Workspaces
cpl config add-scan-root /Users/your-name/Projects
cpl config remove-scan-root /Users/your-name/Projects
```

On macOS, `config.json` and repository state live under
`/Users/your-name/Library/Application Support/compulsive`. Set `CPL_HOME` to override the
application-data directory for isolated automation and tests.

## Terminal and automation

Human-readable output uses compact cards, status symbols, color-aware diagnostics, searchable
selection, confirmation prompts, and spinners. Colors automatically disable outside a TTY and
respect `NO_COLOR`; use `--color` or `--no-color` to override them.

Commands that support `--json` write one JSON value to stdout and diagnostics to stderr, without
prompts, spinners, or ANSI codes.

| Exit code | Meaning                                 |
| --------- | --------------------------------------- |
| `0`       | Success                                 |
| `2`       | Invalid input, remote, or configuration |
| `3`       | Repository not found                    |
| `4`       | Ambiguous match or path conflict        |
| `5`       | Git or filesystem failure               |

The CLI stays lightweight: `mri` handles argument parsing, `picocolors` handles ANSI styling, and
`@clack/prompts` provides interactive controls.

## Library API

```ts
import { createRepositoryManager } from "@adrian-zephyr/compulsive";

const manager = createRepositoryManager();
await manager.initialize({ rootDir: "/Users/your-name/Code" });

const repository = await manager.clone({
  remote: "git@github.com:vuejs/core.git",
});

console.log(repository.absolutePath);
```

The package publishes ESM and CommonJS entry points with TypeScript declarations. Public operations
throw `CompulsiveError`, whose `code` is stable and machine-readable.

## Safety model

- Git is launched with argument arrays, never interpolated shell commands.
- Credentials are removed before remote information reaches the index.
- Scanning does not descend into repositories, heavy build outputs, or symbolic links.
- Organization refuses occupied, nested, stale, and cross-volume targets.
- Moving linked worktrees, repositories with linked worktrees, or external Git directories is blocked;
  resolve their Git layout before organizing. Already correctly located repositories remain no-ops.
- A moved repository is revalidated before its index path changes.
- Workspace links follow organized repositories and refuse to overwrite user content.
- Rewritten remote branch history requires an explicit, SHA-bound `--force-with-lease` confirmation.
- `forget`, Workspace removal, and repository organization never delete canonical repositories.

## Development

Start with [AGENTS.md](./AGENTS.md) and the [development workflow](./docs/development.md) for architecture, decision records, and change-specific validation.

Compulsive uses [Vite+](https://viteplus.dev/):

```bash
vp install
vp check
vp test --run
vp pack --dts --publint --attw
```

## License

MIT
