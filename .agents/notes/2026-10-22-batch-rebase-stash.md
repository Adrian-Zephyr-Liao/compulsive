# Agent Note: Preserve local work during batch rebase

Status: implemented

## Problem

Batch sync skipped dirty worktrees and merged clean branches, while the UI could label a skipped
batch successful. The requested workflow is stash, rebase the remote default branch, push committed
history, and restore work-in-progress without losing staged intent.

## Decision

The [Workspace sync owner](../../src/workspace-sync.ts) uses a narrowly scoped
[stash helper](../../src/workspace-sync-stash.ts) for identity-safe automatic saving and restoration.
Stash messages are unique, recovery uses the exact object ID with `--index`, and backups are retained
even after successful restore. Batch results include phase, recovery state and `push-required`.
The original remote lease survives repeated rebases, and force push remains a separate explicit
confirmation. That confirmed path also saves/restores local edits so a batch's restored WIP does not
block a subsequent reviewed push. Conflicts stop the affected repository and use the existing manual
or explicitly started Codex flow.
Record a new lease only after integrating the same-name remote and passing default-rebase guards.
A lease still contained in HEAD is not proof of a completed rewrite: after an aborted/failed attempt,
retry must integrate the remote again. An actually rewritten branch retains its original lease.
Before rebase, incoming and replayed additions are checked for ignored-file collisions: Git can
otherwise overwrite an ignored file without a conflict. Inspect only candidate paths, rather than
stashing ignored dependency trees or secrets.

## Alternatives considered

- Continue skipping dirty members: safe but does not implement the requested workflow.
- Use merge for all batch syncs: changes history differently from the requested rebase.
- Pop or drop `stash@{0}`: unsafe because linked worktrees share the stash ref and concurrent activity
  can change its position. Immutable IDs and retained entries avoid deleting another backup.
- Automatically force push rewritten history: could replace remote work without user confirmation.
- Add a persistent recovery queue or new push RPC parameter: unnecessary for this scoped workflow;
  Git retains the backup and operation results provide recovery details.

## Consequences

Retained stash entries accumulate until the user removes them. Recovery can conflict with updated
code, and a failed apply may be partial; inspect the working tree before retrying. Locks coordinate
only the current process, not external editors or other CPL processes. Batch sync does not commit
work-in-progress, automatically run Codex, or automatically complete a rejected force push. The
[Workspace specification](../../docs/workspaces-spec.md#batch-branch-synchronization) owns the contract.

## Verification

Regression scenarios use isolated real Git repositories and file remotes for staged/unstaged/binary
preservation, existing stashes, remote commits, rebase/restore conflicts and fetch/push failures.
Failure-retry regressions also verify that a guard rejection or aborted rebase cannot skip remote
commits, and that the explicit-force fallback protects ignored files. Frontend regressions cover
incomplete-result feedback, selection changes and force-push visibility after WIP restoration.

`pnpm run check`, `pnpm run prepack` (including publint and declaration checks), and an npm dry-run
pack passed. A built-server browser fixture exercised Chinese sync confirmation, successful sync,
persisted status after reload and English confirmation. Git assertions confirmed zero commits behind
the default branch, matching pushed HEAD, retained staged PNG and no publication of that staged image.
The fixture and its server were removed afterward; the existing global link was rebuilt/restarted.

The implementation is local; live GitLab access, actual Codex conflict execution and npm publication
are not established by those tests. Full-repository regression and browser conflict/force execution
were not run; those mutation paths have isolated Git and component/hook coverage instead.
