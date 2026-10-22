# Compulsive architecture

This map describes the current checkout. [Workspace specifications](workspaces-spec.md) own lifecycle contracts; the [frontend README](../src/devtool-client/README.md) owns browser conventions. [Agent Notes](../.agents/notes/README.md) record decisions rather than duplicate these contracts.

## Entry paths and owners

```text
bin.ts -> cli.ts -> cli/* ----------------> manager.ts -> repository-* / workspace-*
browser hooks -> devtool.ts -> devtool/* -->              storage.ts / git.ts
library consumer -> index.ts ------------> manager.ts
```

The arrows summarize calls, not a rule that every operation must traverse every box. CLI queries/prompts and RPC serialization are adapters; repository and Workspace behavior belongs to the manager and its domain modules.

| Owner                                                                                                              | Responsibility                                                                                          |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| [bin.ts](../src/bin.ts), [cli.ts](../src/cli.ts), [cli/](../src/cli), [terminal.ts](../src/terminal.ts)            | Process entry/dispatch; feature command handlers, arguments, selection, confirmation and output         |
| [index.ts](../src/index.ts), [types.ts](../src/types.ts), [errors.ts](../src/errors.ts)                            | Public exports, discriminated data/API types, stable `CompulsiveError` codes                            |
| [manager.ts](../src/manager.ts)                                                                                    | Configured manager composition, repository registration, discovery and query operations                 |
| [repository-metadata.ts](../src/repository-metadata.ts), [repository-organize.ts](../src/repository-organize.ts)   | Repository classification; move planning/execution, verification, rollback and bounded source cleanup   |
| [workspace-registry.ts](../src/workspace-registry.ts)                                                              | Workspace creation/search, record lookup and status persistence                                         |
| [workspace-members.ts](../src/workspace-members.ts), [workspace-clone.ts](../src/workspace-clone.ts)               | Member addition/removal/conversion; selected-repository clone orchestration and rollback                |
| [workspace-sync.ts](../src/workspace-sync.ts)                                                                      | Rebase, push/lease state and batch branch synchronization                                               |
| [workspace-sync-stash.ts](../src/workspace-sync-stash.ts)                                                          | Sync operation locks, unfinished-operation checks and exact-OID stash recovery                          |
| [workspace-maintenance.ts](../src/workspace-maintenance.ts), [workspace-deletion.ts](../src/workspace-deletion.ts) | Link repair and legacy migration; separately owned Workspace deletion transaction                       |
| [workspace-paths.ts](../src/workspace-paths.ts), [workspace-worktrees.ts](../src/workspace-worktrees.ts)           | Shared path/link checks and rollback runner; Git identity, cleanliness and physical worktree operations |
| [workspace-branches.ts](../src/workspace-branches.ts)                                                              | Local/remote branch lookup, upstream and default-branch fetch helpers                                   |
| [workspace-status.ts](../src/workspace-status.ts)                                                                  | Per-member Git status, comparisons and observed development-tip evaluation                              |
| [storage.ts](../src/storage.ts)                                                                                    | On-disk validation and atomic writes for application configuration and registries                       |
| [git.ts](../src/git.ts), [git-url.ts](../src/git-url.ts), [discovery.ts](../src/discovery.ts)                      | Git execution and redaction, remote classification, safe repository discovery                           |
| [doctor.ts](../src/doctor.ts)                                                                                      | Read-only environment and Workspace diagnostics                                                         |
| [devtool.ts](../src/devtool.ts), [devtool/](../src/devtool)                                                        | Local server bootstrap and RPC composition; state, audit, Workspace and external-app adapter groups     |
| [codex.ts](../src/codex.ts)                                                                                        | Codex app-server subprocess protocol and turn completion                                                |
| [agent-instructions.ts](../src/agent-instructions.ts)                                                              | Marker-delimited global CPL instructions installed by initialization                                    |
| [shell.ts](../src/shell.ts), [clipboard.ts](../src/clipboard.ts)                                                   | Shell quoting and macOS clipboard integration                                                           |

The current worktree audit modules separate scanning, report persistence, cancellable jobs and removal in [worktree-audit.ts](../src/worktree-audit.ts), [worktree-audit-store.ts](../src/worktree-audit-store.ts), [worktree-audit-jobs.ts](../src/worktree-audit-jobs.ts) and [worktree-removal.ts](../src/worktree-removal.ts). These files can be uncommitted during development; their presence is not release evidence.

The former `workspaces.ts` implementation is replaced by cohesive owners, not retained as another implementation or a cyclic barrel. The manager imports those owners directly. Shared paths/worktree checks and registry lookup sit below lifecycle orchestration; cloning calls member creation and Workspace deletion for rollback, while deletion never calls cloning. `workspace-registry.ts` delegates observations to `workspace-status.ts`; both observation and lifecycle code reuse `workspace-branches.ts` without back-references. Persistence and destructive checks remain in their executing owner.

The CLI keeps cancellation, argument/query resolution and presentation in `cli/`; no command adapter implements Git lifecycle safety. DevTool factories in `devtool/` return typed RPC tuples: composition preserves the namespace contract, while audit jobs and Codex turn maps retain one lifetime per server-function factory invocation. The root module continues to re-export frontend state types for existing type-only consumers.

The local editor shares membership/path authorization in [project/paths.ts](../src/project/paths.ts). [project/files.ts](../src/project/files.ts) and [project/assets.ts](../src/project/assets.ts) bound reads; [project/mutations.ts](../src/project/mutations.ts) owns versioned saves, exclusive creation/rename reservations and recoverable Trash. [project/file-index.ts](../src/project/file-index.ts) and [project/search.ts](../src/project/search.ts) own bounded discovery/search; [project/git.ts](../src/project/git.ts) owns reviewed Git actions and delegates branch push safety to the existing Workspace owner. [project/terminals.ts](../src/project/terminals.ts) owns explicit PTY sessions, [project/watch.ts](../src/project/watch.ts) owns filesystem events, and [project/session.ts](../src/project/session.ts) owns validated layout persistence beside CPL config. The manager registers its storage location privately; these RPC-only editor operations are not added to the public library API.

The [project/](../src/project) directory groups these editor-only domain owners; their private helpers remain beside their callers rather than becoming root-level utilities or a barrel API. [project/git-diff.ts](../src/project/git-diff.ts) reads bounded Git blobs without byte loss and reuses the asset owner's raster-image detection. [project/git-discard.ts](../src/project/git-discard.ts) owns confirmed bulk discard with optional stash backup; [project/git-message.ts](../src/project/git-message.ts) owns staged-patch validation and delegates isolated read-only generation to [codex-message.ts](../src/codex-message.ts), not the full-access conflict-resolution adapter. Typed adapters in [devtool/](../src/devtool) use the existing authenticated connection. Server shutdown disposes PTYs and file watchers. The browser [editor feature](../src/devtool-client/features/editor) separates page composition, presentational components, lifecycle hooks and pure transitions, never filesystem authorization. Feature contracts live in its `types.ts`, not as exports from view components. [The editor specification](editor-spec.md) owns acceptance and limits; the frontend README owns component/controller responsibilities. Existing route URLs and session file formats remain unchanged; new editor-only actions use separate typed RPCs.

[devtool-preferences.ts](../src/devtool-preferences.ts) owns validated, serialized and atomic global appearance persistence beside CPL config, privately registered by the manager. It is independent of repository/editor sessions. The shared state RPC hydrates the browser's app-level appearance provider; one update RPC persists explicit theme changes without adding a public manager method or another connection.

## Dependency and state rules

- CLI and RPC adapters call the manager/domain implementation. They must not introduce a second implementation of repository-layout or worktree safety rules.
- Domain and storage modules stay independent of React, terminal prompts and Devframe presentation. Public additions reach `types.ts` and `index.ts` when they belong to the library API; RPC-only methods need not become public library exports.
- Browser code consumes RPC types and calls through its controllers/hooks. It never imports Node filesystem, Git execution, or manager implementations. Type-only imports from the server keep RPC declarations synchronized without bundling server code.
- CPL files are authoritative for repository/Workspace state; Git is authoritative for repository identity and branch state. Browser preferences such as locale belong in browser storage. Display state is not permission to delete or rewrite Git history.
- Persist only validated data with the existing atomic-write helpers. Complete the Git/filesystem operation before publishing success; preserve the owner's rollback and partial-failure diagnostics.

### Executed boundaries

`pnpm run check:architecture` parses `src/**/*.ts` and `src/**/*.tsx` with the parser already provided by Vite+. It rejects browser runtime imports of Node/server source, domain/storage runtime imports of presentation adapters or UI packages, unresolved local code imports, non-`.js` local source specifiers and runtime import cycles. CLI (including `cli/`), Devframe (including `devtool/`), terminal, Codex and clipboard entry/adapters are explicitly identified in [the checker](../scripts/check-architecture.mjs); the public `index.ts` is an export boundary rather than an internal dependency.

The graph includes static imports/re-exports, literal dynamic imports and direct `require()` calls. Type-only edges are excluded: shared RPC contracts and recursive data types do not become runtime dependencies. Module paths must be literal; computed module loading is rejected instead of silently escaping validation. This check covers repository source edges, not third-party dependency internals, arbitrary loader aliases, shadowed/aliased `require` or semantic ownership correctness. Do not treat a passing graph as proof that a large file has one responsibility.

## Source, artifacts and tests

[tsconfig.json](../tsconfig.json) defines strict NodeNext TypeScript with React JSX. Local TypeScript imports use `.js` specifiers. [vite.config.ts](../vite.config.ts) builds Node ESM/CJS and declarations from `src/index.ts` and `src/bin.ts`; [vite.devtool.config.ts](../vite.devtool.config.ts) builds the browser to `dist/devtool-client` with a relative asset base. Edit source, never generated `dist` files.

Tests live under [tests](../tests) and run through Vite+/Vitest. Filesystem and Git behavior tests use temporary repositories; external protocol tests may replace a subprocess. Those tests prove the local protocol/behavior they assert, not real application login, remote access or browser interactions. Use the [validation matrix](development.md#validation) for the required evidence.
