# Agent Note: Explicit default-branch development

Status: implemented

## Problem

Create/clone and add forms require a custom branch name even when a repository should develop on
origin's default branch. Inferring main/master in the browser can choose the wrong branch.

## Decision

Send default-branch intent through additive optional inputs on the existing RPC/library operations.
Resolve origin's advertised HEAD in the domain owners and create an ordinary attached worktree.
Keep custom branch names and detached references separate. Existing branch and rollback behavior
is unchanged; the registry does not store a second mode flag.

## Alternatives considered

Typing main/master manually is already possible but does not resolve origin's actual default.
Sharing the canonical checkout or forcing a branch into multiple worktrees would change isolation
and could corrupt another checkout's working state; neither is used.

## Consequences

The choice needs remote access, and Git rejects an already checked-out default branch. Existing
local default-branch commits are retained rather than reset. No CLI flag or dependency is added.

## Verification

Focused tests passed for advertised main/master/trunk, upstream creation, mixed clone modes,
contradictory input rejection, occupied-branch rollback and canonical draft preservation. An isolated
browser walkthrough created, cloned and added a repository on main, verified the occupied-branch
rejection, and checked Chinese/English controls. Check, prepack and pack dry-run passed. The running
user service was not restarted, and no package was published.
