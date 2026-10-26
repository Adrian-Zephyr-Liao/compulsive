# Agent Note: Remote default baseline for new Workspace branches

Status: implemented

## Problem

Adding a repository with a new development branch omitted the start point when no same-name remote
branch existed. Git then used the canonical checkout's possibly old or unrelated HEAD.

## Decision

Keep existing local and same-name remote branches unchanged in precedence. For a new explicit or
generated Workspace branch without a library start point, resolve and fetch origin's advertised
default branch. Reject remote failures instead of silently using HEAD. Preserve HEAD fallback only
for repositories without origin, and honor explicit library start points.
Pass `--no-track` for independent branch creation so Git auto-setup settings cannot associate the
new branch with origin's default. Matching remote branches still use explicit `--track`.

## Alternatives considered

Using cached origin refs can retain an obsolete baseline. Resetting existing branches could destroy
development history. Neither is used. In-place branch switching remains a separate operation.

## Consequences

New origin-backed branches require remote access. No dependency, input or registry format changes.
Existing business branches are not migrated or reset by this fix.

## Verification

An isolated temporary-repository regression reproduced an incorrect master baseline by commit SHA
before the fix. The ten new cases pass: freshly advanced main/master/trunk, an unrelated dirty
canonical checkout, generated names, explicit start points, existing local/remote branches,
no-origin fallback, upstream suppression and rejection without new membership, branches or worktrees.

`pnpm run check` passes documentation, architecture, formatting, lint and types. The related run of
`tests/workspaces.test.ts`, `tests/workspace-cli.test.ts`, `tests/workspace-clone.test.ts`,
`tests/workspace-default-branch.test.ts` and `tests/workspace-branches-integration.test.ts` passed
47 of 49 tests, with two existing five-second timeouts. Isolated reruns of dirty-removal protection
and conflict-status reporting both pass without changing their time limits. This is bounded
verification of 59 distinct cases, not a passing whole-suite run.

`pnpm run prepack` passes Node ESM/CJS, declarations, publint, attw and browser builds; the existing
large-vendor-chunk warning remains. Pack dry-run lists 151 files without unexpected paths. A built
ESM/CJS/CLI probe uses temporary repositories and a file-URL remote, verifies a newly fetched master
baseline with no upstream, retains canonical HEAD and passes five Doctor checks. Temporary probe
data is removed. No real business branch, running user service, commit, push or npm release is changed.
