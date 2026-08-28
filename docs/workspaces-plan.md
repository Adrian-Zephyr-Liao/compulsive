# Workspace Implementation Plan

Status: In progress

## Increment 1: Contracts and Persistence

- Extend the public types with workspace records, inputs, and results.
- Add backward-compatible `workspaceRoot` configuration derivation.
- Add atomic `workspaces.json` initialization, loading, and validation.
- Prove the behavior with focused storage and configuration tests.

## Increment 2: Link Workspaces

- Create and search workspaces.
- Add, remove, synchronize, and delete link members safely.
- Cover many-to-many membership, path conflicts, rollback, and canonical-repository preservation.

## Increment 3: Worktree Workspaces

- Add existing-branch and explicit new-branch worktree members.
- Verify worktree identity and clean state before removal or deletion.
- Cover branch conflicts, dirty worktrees, rollback, and independent checkout state.

## Increment 4: CLI and Interaction

- Add `workspace` and `ws` commands with stable JSON output and exit codes.
- Add workspace-aware repository search and workspace navigation.
- Add repository/workspace combined selection and focused workspace selection in interactive terminals.

## Increment 5: Integration and Release Gate

- Repair link members after repository organization.
- Extend doctor checks and update English and Chinese documentation without changing the user's pending README edit.
- Run Vite+ checks, tests, package validation, tarball installation, and temporary-repository smoke tests.
