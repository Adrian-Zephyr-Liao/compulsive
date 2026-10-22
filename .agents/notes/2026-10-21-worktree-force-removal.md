# Agent Note: Explicit force removal of audit candidates

Status: implemented

## Problem

The original [removal decision](2026-10-21-worktree-audit-removal.md) blocked dirty, locked, unfinished,
missing and unregistered candidates. The user explicitly confirmed that all candidates should be
selectable, with separate force confirmation for risks and retained protection for primary repos
and system roots.

## Decision

Keep normal requirement-member deletion unchanged. The separate audit action returns hard blockers
and overridable force reasons, revalidates the complete path, Git identity, directory entry and
current references, and rejects stale confirmations. Only the literal boolean `true` enables force.
Ignored data retains its independent opt-in. [Workspace specifications](../../docs/workspaces-spec.md#worktree-inventory-and-explicit-removal)
own the current contract.

Remove registered worktrees with Git, including two force flags when explicitly authorized. Remove
only the selected missing record, not all prunable entries. Unregistered immediate children of a
verified `.worktrees` root can be recursively removed after force confirmation; symlinks are unlinked
without following them. Preserve primary/canonical repositories, protected roots and identity checks.
Keep local branches and retain detached commits under `refs/cpl/removed-worktrees/` before removal.
Clean requirement memberships and matching links afterward, preserving unexpected normal files.

## Alternatives considered

- Keep blanket safety rejection: rejected after explicit user approval of force-confirmed removal.
- Silently force all deletes: rejected; risks require an initially unchecked separate confirmation.
- Bulk prune missing entries: rejected because it could clear unselected registrations.
- Create a full working-directory backup: not chosen; the user approved permanent deletion, while
  commit recovery refs preserve detached history without copying dependencies or uncommitted data.

## Consequences

Force removal permanently discards uncommitted/untracked data and unfinished operations. Ignored
paths can contain secrets. This is not Trash-backed or an atomic lock against external editors.
Commit recovery refs may remain if subsequent removal fails; no working files are backed up.
Disk deletion cannot be rolled back after a metadata cleanup failure, so return a successful delete
with a cleanup warning. A force flag never bypasses protected-root or identity validation.

## Verification

[Force-removal integration tests](../../tests/worktree-force-removal.test.ts) use temporary Git
repositories for dirty/locked state, real merge/rebase conflicts, missing registrations, unregistered
directories and symlinks, reference cleanup, detached-commit retention and primary protection.
Existing audit tests continue to cover normal deletion and rejection paths. No real developer
worktree is deleted during verification. Browser checks inspect confirmations only; final delivery
separately states checks, packaging results and remaining unverified cases.
