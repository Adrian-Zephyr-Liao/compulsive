# Agent Note: Executable architecture boundaries and focused owner extraction

Status: implemented

## Problem

The written dependency rules had no source-level gate. `workspaces.ts` mixed lifecycle, branch-resolution commands and member observations; the settings page mixed routing, form rules and diagnostic presentation. Moving state into route children would also discard drafts and results during navigation.

## Decision

Extract reusable branch helpers and member-status observations without moving registry writes or lifecycle preflight/rollback. Split settings rendering into configuration and basic-doctor panels, retaining controllers in the settings route shell. Add `check:architecture` to `check`, using the installed Vite+ parser rather than adding a dependency, and reuse `check` in `prepublishOnly`. [Architecture](../../docs/architecture.md#executed-boundaries) owns the enforced rules and limitations; [frontend conventions](../../src/devtool-client/README.md#responsibilities) own state placement.

## Alternatives considered

- Rewrite all large modules or introduce domain/service/repository directory layers: rejected for this batch because that expands lifecycle and destructive-operation risk without needing a new public contract.
- Put form and doctor state in the extracted panels: rejected because route unmounts would change current state retention.
- Match imports with regular expressions or add a dependency-analysis package: rejected because Vite+ already provides an AST parser that distinguishes type-only edges, re-exports and literal dynamic imports.
- Enforce file-length thresholds: rejected because length alone does not identify a responsibility or a safe extraction point.

## Consequences

Public exports, CLI/RPC names, routes, storage schemas and Git safety semantics remain unchanged. The extracted modules are internal owners, not new public APIs. New source files automatically enter the graph; module paths must be literal. Third-party internals and arbitrary loader aliases are outside the gate. `workspaces.ts`, `cli.ts`, `devtool.ts` and `WorkspaceApp.tsx` still contain further extraction opportunities; passing this batch's gate does not mark repository-wide governance complete.

Follow-up: [domain ownership and Git test isolation](2026-10-22-domain-ownership-and-git-tests.md) records the next extraction batch and replacement of the two timed-out test structures. The results below remain the historical evidence for this first batch.

## Verification

The checker self-test covers forbidden imports, permitted type-only imports/re-exports, dynamic imports inside exported functions, parse errors, missing source, source extensions and runtime/self cycles. Settings rendering tests exercise separate storage/doctor routes and diagnostic failure/healthy-member presentation in both locales; they are server-rendered tests, not browser interaction evidence.

- Both documentation and architecture checker self-tests pass. `pnpm run check` passes with no format, lint or type warnings (16 documents, 61 source graph nodes, 83 lint/type-checked files at execution).
- `tests/workspace-status.test.ts`, `tests/settings.test.tsx` and `tests/i18n.test.ts` pass: 11 tests. The five status tests use mocked Git responses, not live remote evidence. Ant Design lint reports no issues in the settings feature.
- The Workspace/audit/force-removal/RPC run reports 53 of 56 tests passing, with three timeouts. The missing-upstream audit test passes on isolated rerun. The remaining clone (45 seconds) and legacy migration (5 seconds) timeouts reproduce with `HEAD:src/workspaces.ts` substituted in memory through a temporary Vite load hook, leaving checkout files unchanged. A short baseline probe confirms that hook loaded the old module. Test thresholds are not relaxed; those two cases remain a validation limitation rather than passing regressions.
- `pnpm run prepack` passes Node ESM/CJS/declaration builds, attw, publint and the browser build. Existing CommonJS/experimental TypeScript 7/vendor chunk-size warnings remain.
- No complete repository test run or real browser state-retention/visual walkthrough was performed. No real repository layout, branch, data or remote was mutated to validate this refactor; there was no commit, push or npm publication.
