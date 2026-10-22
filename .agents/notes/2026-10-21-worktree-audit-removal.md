# Agent Note: Worktree inventory and explicit removal

Status: superseded

Superseded by [explicit force removal](2026-10-21-worktree-force-removal.md) after the user approved
force confirmation for risky candidates. The read-only inventory decisions remain valid.

## Problem

Registered repositories can retain linked worktrees that no current CPL requirement references.
Registry absence alone does not prove that a directory is unused or disposable. The product needs
both a useful inventory and a way to remove reviewed worktrees without losing local development.

## Decision

Keep scanning, persistence, progress delivery and removal in separate domain modules; the manager
owns their integration. The browser and CLI share the inventory, while the browser exposes a
separate per-target removal preview and confirmation. [Workspace specifications](../../docs/workspaces-spec.md#worktree-inventory-and-explicit-removal)
own the current contract; [frontend conventions](../../src/devtool-client/README.md) own presentation.

Use Git's NUL-delimited worktree/status output, real paths and common Git-directory identity. Scan
only registered managed repositories, protect primary checkouts and cross-check every CPL member.
Reinspect only the selected target before deletion, then compare its fresh fingerprint. Use normal
Git removal without force; keep local branches and reject unretained detached HEAD commits. Do not
derive deletion authority from a clean status, ignored reminder or merge inference.

## Alternatives considered

- Inventory only: insufficient once the user explicitly requested deletion.
- Automatic/bulk cleanup of all unreferenced paths: rejected because external, moved and offline
  worktrees cannot be proven disposable from CPL metadata.
- Recursively delete directories or force Git removal: rejected because they bypass file/lock safety.
- Enumerate every ignored file: a real dependency-heavy worktree exceeded the subprocess output
  limit. Summarize ignored directories instead and require separate opt-in to discard their contents.

## Consequences

Deletion removes directories permanently, not through Trash. Tracked/untracked changes remain
blocking; ignored data may be discarded only after its own confirmation. Ignored-directory
fingerprints cover directory metadata, not every descendant's contents. Remote information is
cached, with missing upstream refs treated as warnings. No cleanup of missing registrations,
unknown directories, submodules or protected paths is attempted. External concurrent edits cannot
be fully locked by CPL, so the dialog asks the operator to stop editing/running the target first.

## Verification

[Integration tests](../../tests/worktree-audit.test.ts) create temporary Git repositories to check
classification, cancellation, persistence, real merge conflicts, changed fingerprints, successful
directory/registration removal, retained branches/siblings, and rejection paths. Tests do not
delete developer worktrees. Browser verification may inspect the real local report and open/cancel
previews, but destructive acceptance uses only test fixtures. Full check/test/build outcomes belong
in the task delivery; this decision record is not npm release evidence.
