# Agent Note: Local read-only project preview

Status: superseded

## Problem

Users need to inspect files in a requirement member without opening a separate editor. Adding a filesystem RPC must not expose arbitrary machine paths or execute project content.

## Decision

Superseded by the user-requested [full local editor](2026-10-22-local-editor-workbench.md). The following records the initial read-only slice, not current editing authority or limits.

Use the existing authenticated Devframe connection and a dedicated URL route. Add only directory-list and text-read queries. The server resolves each root from current requirement membership, rejects traversal/symlink paths and common secret/metadata/dependency paths, and bounds directory reads and file bytes. Use Ant Design Tree/Splitter plus locally bundled, lazy CodeMirror 6 and language modules. Preserve the existing VS Code action and keep all writes out of scope. The current [frontend boundary](../../src/devtool-client/README.md#local-editor-boundary) is owned by the replacement decision.

## Alternatives considered

- A hand-written code viewer: rejected because CodeMirror supplies selection, search, highlighting, line numbers and folding.
- Loading the editor from a CDN: rejected to preserve local/offline operation and avoid external editor requests.
- Scanning all project files eagerly or accepting absolute paths: rejected because it adds unbounded work or broader file access than a member preview needs.
- Saving edits or running an embedded terminal: deferred because the requested scope is preview, not remote development.

## Consequences

Additive internal RPC contracts and browser dependencies, but no public manager API, CLI/storage format or background polling. Common-secret exclusions are not content-level secret detection. Local concurrent filesystem changes are not atomic snapshots; refresh after changes. Errors and unsupported files retain an external-editor escape. Existing pending tooltip changes are preserved.

## Verification

`pnpm run test tests/project-files.test.ts tests/editor-route.test.tsx tests/devtool.test.ts tests/i18n.test.ts tests/settings.test.tsx` passes 20 tests across five files. Temporary fixtures cover member resolution, read-only RPC behavior, traversal/absolute/mixed-case restricted paths, descendant and replaced-root symlinks, common secrets, binary/UTF-8/size limits, missing files and bounded directories. Bilingual server-rendering tests verify the dedicated deep-link route and preview controls.

`pnpm run check`, Ant Design lint for the feature/table, and `pnpm run prepack` pass. A package dry run inspects 143 files including the lazy page/editor assets (no publication). Existing Vite alias peer warnings, CommonJS/experimental TypeScript messages and the Ant Design vendor-size warning remain. No editor peer dependency mismatch was found.

An isolated local service with synthetic project files was exercised in the browser: repository preview entry, directory expansion, TypeScript highlighting/line numbers, read-only DOM state, file search and translated search labels, wrapping, splitter dragging, binary-file rejection, deep-link refresh, and Chinese/English switching. The pass exposed Flex padding overrides that were repaired. No user repositories were read or changed by this walkthrough. Full Git lifecycle regressions and adversarial concurrent-filesystem race testing were not rerun for this additive preview feature.
