# Agent Note: Domain ownership and independent Git integration scenarios

Status: implemented

## Problem

Large lifecycle, CLI, RPC and frontend coordination files still combined unrelated responsibilities. The clone regression combined clone selection, reference conversion, rebase, leased force push, merged-tip detection, a remote writer and branch switching in one 450-line test with a shared 45-second budget. Instrumentation recorded hundreds of Git calls before timeout. The legacy migration test included initializing/cloning submodules in its default five-second body, sometimes expiring during setup before migration ran. A test timeout does not cancel an already running async Git workflow, so a long timed-out scenario can also contaminate later test timing.

## Decision

Use the explicit owners in [architecture](../../docs/architecture.md), preserving existing public exports, CLI/RPC names, paths, storage schemas, errors, verification and rollback. The manager imports lifecycle owners directly; do not keep the old `workspaces.ts` barrel. Split CLI adapters and RPC factories by feature. Retain audit/Codex map lifetimes within the composed server instance. Split frontend mutations and dialog state from root route/connection composition, move pure filters/counts to selectors and translation data to message catalogs.

Replace the cumulative clone test with independent clone, reference, development and published-branch scenarios. Each receives fresh temporary repositories, retaining the prior assertions without state dependence on another test. Prepare the migration submodule fixture in a separate 30-second setup hook; retain its default five-second operation/assertion body. Clone/branch bodies use 20 seconds instead of the original cumulative 45; setup/cleanup have explicit bounds, and fixture subprocesses are bounded. Isolate system/global Git configuration and synthetic identities through the test environment without modifying machine configuration. No global timeout increase or production Git shortcut is introduced.

## Alternatives considered

- Increase the original 45-second test or global five-second timeout: rejected because unrelated scenarios and expensive setup would remain coupled, and a timeout would still leave async work running.
- Treat user Git settings as the sole cause: rejected because isolation alone still reproduced the timeout; command count and fixture placement required structural fixes.
- Split files only by line count or introduce a new service framework: rejected because the existing functions have usable ownership seams and no new dependency or runtime abstraction is needed.
- Put newly extracted frontend state in route children: rejected because navigation must retain the existing shared connection and state lifetime.

## Consequences

Internal source paths change; owning docs and manager imports change together. Existing package, CLI, RPC and storage contracts remain intact. Git assertions still exercise real temporary repositories, while RPC grouping and frontend selector tests are bounded unit evidence. Browser interactions and live remote/Codex behavior remain separate acceptance steps. The previous [boundary decision](2026-10-21-architecture-boundaries.md) still applies; the graph guard now recognizes CLI and RPC adapter subdirectories.

## Verification

The first independent clone/migration/branch run passed all eight scenarios. An intermediate serial suite passed 138 tests before the final RPC/selector additions. A later background suite crossed a prolonged interruption and reported widespread timeouts (116 passed, 28 timed out); that run is not accepted as passing verification. A fresh uninterrupted `pnpm run test --no-file-parallelism` subsequently passed all 144 tests in 20 files in 313 seconds, including the replacement clone/migration scenarios and new RPC/selector regressions.

`pnpm run check` passes with no format/lint/type warnings (20 documents, 88 source graph nodes, 115 lint/type-checked files at execution). Both checker self-tests pass, including rejection of domain imports from the new adapter directories. Ant Design lint reports no issues in the workspace feature. Syntax-tree comparison against the local HEAD confirms unchanged execution bodies for 47 Workspace, 21 CLI and 20 repository functions (explicit orchestration/signature changes excluded), 21 existing RPC definitions unchanged, and all 45 original clone matcher assertions retained across independent scenarios.

`pnpm run prepack` passes ESM/CJS/declaration and browser builds, attw and publint. Built ESM/CJS manager API construction and CLI help pass without initialization or writes. `npm pack --dry-run --ignore-scripts --json` inspects 23 files, 521628 compressed bytes for version 0.1.6; no package is published. Existing CommonJS, experimental TypeScript 7 and Ant Design vendor-chunk size warnings remain outside this ownership refactor.

No real repository layout, user Git configuration or remote was changed for testing. Temporary profiling/generation helpers were removed. No real browser interaction walkthrough, live Codex task or remote Git integration was performed; rendering tests and mocked RPC tests do not replace those acceptance steps. No commit, push or publication is authorized by this work.
