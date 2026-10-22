# DevTool frontend conventions

The frontend uses a small feature-first structure. Keep dependencies pointing inward:

```text
src/devtool-client/
├── app/                 providers, route table, and Ant Design theme
├── features/            business-owned state and UI
└── styles/              Tailwind entrypoint and scoped structural CSS
```

## Responsibilities

- `app/`: root providers, global theme tokens, route definitions, and application bootstrap.
- `features/workspaces/`: workspace RPC state, actions, screens, dialogs, and feature components.
- `features/settings/`: storage settings, diagnostics and their feature-owned state/UI.
- `features/editor/`: the full local editor route; document, layout, file/search/Git/terminal controllers and locally lazy CodeMirror/xterm/preview views. It reuses the shell's RPC connection.
- `styles/`: the Tailwind entrypoint and scoped structural CSS that cannot be expressed clearly with Ant Design tokens or short utility classes.

The workspace feature is split by responsibility:

```text
features/workspaces/
├── WorkspaceApp.tsx        route/connection ownership and page composition
├── RequirementPage.tsx     requirement route presentation
├── components/             presentational sections and the repository table
│   └── dialogs/            modal forms and confirmations
├── hooks/                  RPC connection, status, drafts, and repository operations
├── utils/                  pure selectors and error formatting
└── types.ts                feature-local contracts
```

Keep RPC lifecycle and async side effects in hooks, pure status decisions in selectors, and Ant Design rendering in components. `WorkspaceApp` coordinates these pieces; it should not contain table cell markup or modal form internals.

`useWorkspaceActions.tsx` owns common action execution, configuration/doctor requests, requirement submission and batch-sync feedback. `useMemberDialogs.ts` owns add/switch/confirmation state and member mutations. Both reuse the root connection and status refresh callbacks; they do not establish connections or independent route state. Shared action/feedback/count contracts live in `types.ts`. `workspaceSelectors.ts` owns pure member filtering and counts, including exclusion of removed members from cached status totals.

Batch-sync feedback refreshes both Workspace metadata and Git status before exposing follow-up
actions. It distinguishes skipped, failed, conflicting and safe-force-required members, and presents
the stash object ID and restore state returned by the server. Conflict inspection reuses the existing
repository drawer and must not target a newly selected requirement through a stale notification.
Notifications do not automatically start Codex or authorize a force push.

The settings feature keeps `SystemSettingsPage.tsx` as its route/navigation shell. `StorageSettingsPanel.tsx` owns configuration form rendering and field rules; `DoctorPanel.tsx` owns the basic diagnostic presentation. `useSettingsState.ts` owns the draft/form instance and on-demand diagnostic execution/results; call these hooks in the shell, not route children, so switching settings subroutes retains existing drafts and results. `WorktreeAuditPanel.tsx` and `useWorktreeAudit.ts` remain the separate inventory/removal presentation and controller. No settings panel creates an additional RPC connection.

## Local routes

The application uses React Router's `createHashRouter` and `RouterProvider` so CPL's static frontend supports direct links/reloads without server rewrite rules and the editor can block navigation with unsaved buffers:

- `#/requirements/:workspaceId`: a requirement and its repositories. Encode the full persistent workspace ID when building links.
- `#/requirements/:workspaceId/code/:repositoryId?file=relative/path`: a member's full-screen local editor; encode both IDs. The selected file is URL-backed, so reload/back/forward preserve it. The broad dashboard chrome is hidden on this route. Directory and editor loads stay feature-owned, and late responses must not replace a selected/dirty document.
- `#/settings/storage`: storage and discovery configuration.
- `#/settings/doctor`: on-demand environment diagnostics.
- `#/settings/doctor/worktrees`: read-only linked-worktree inventory, persisted reports and ignore choices.
- Worktree deletion is a separate, freshly validated action with a full-path confirmation. Keep destructive checks on the server; never rely on cached table state.
- Risky audit removals require a separate, initially unchecked force confirmation; protected roots/identities remain blocked. Refresh requirement membership after successful removal and display detached-commit recovery refs.
- `#/` and `#/requirements`: redirect to the first available requirement, or show the empty state when none exists.

`app/routes.tsx` owns top-level routes and URL builders. Settings owns its nested routes. The URL is the source of truth for page and requirement selection; do not add a parallel `activeView` state. The shared application shell keeps the RPC connection alive across navigation. Missing/deleted requirement IDs and unknown paths redirect with history replacement.

## Internationalization

- All user-visible frontend text belongs in the catalogs exposed through `app/i18n.tsx`; components use `useI18n()` rather than inline copy.
- `app/i18n.tsx` owns runtime locale selection, translation and providers; message catalogs live in `app/messages/zh-CN.ts` and `app/messages/en-US.ts`. The English catalog is checked against the Chinese catalog's key union, re-exported as `MessageKey` through the existing i18n entrypoint.
- Chinese and English keys are type-checked against the same catalog, and interpolated values use named placeholders.
- `ConfigProvider.locale` follows the selected app locale so Ant Design's built-in labels change with the product copy.
- Dates use `formatDateTime()` from the locale context. Keep raw RPC and Git values unchanged.
- The locale switch is a UI preference stored under `compulsive.locale`; workspace and repository state remain in CPL storage.

## Styling rules

1. Ant Design components remain the control primitives. Configure color, radius, typography, and component defaults through `ConfigProvider` tokens.
2. Tailwind utilities handle local layout and spacing. Class names must be complete strings so Tailwind v4 can detect them statically.
3. Structural CSS is scoped below a feature root class. Avoid global `.ant-*` overrides when a token or component prop exists.
4. Do not duplicate brand tokens in JSX and CSS. Ant Design exposes the configured values as CSS variables for structural styles.
5. Keep modal, dropdown, tooltip, empty, loading, and error states in the same visual system as the main screen.

`app/appearance.tsx` owns one global light/dark state, hydrated from the shared connection's initial `get-state` response. The header and editor preferences change the same state after `update-devtool-preferences` succeeds. `app/theme.ts` owns both semantic palettes and Ant Design algorithms; page chrome and overlays consume tokens, not fixed white surfaces. Theme changes must not recreate the router/connection or discard editor buffers. The choice is atomically stored in `devtool-preferences.json` beside CPL config, not in browser storage or per-repository sessions. Refreshes of unrelated workspace state do not override an in-session theme choice.

## Local editor boundary

Repository actions expose **Open editor** without changing **Open in VS Code**. `EditorPage` inherits the global Ant Design typography, radius, control heights and appearance, including overlays. Only Tree/Tabs/Splitter density tokens are editor-specific: 32px tree rows, 40px card tabs and a 1px resize divider. `EditorWorkspace` composes feature controllers, a native Segmented sidebar switch, columns and dialogs. `EditorFileTabs` owns native editable-card Tabs and forwards close/reorder/pin actions to the existing controller; `EditorTerminalDock` uses the same Tabs while keeping inactive PTYs mounted. `EditorChrome` renders 48px navigation and a 32px status bar; layout spacing follows 8/16px steps, with 12px secondary text and the inherited 14px body text. Ant Design Tree/Splitter remain the navigation/resize primitives; CodeMirror 6, merge views, xterm.js and Markdown rendering load locally on demand. Do not put them in an eagerly loaded generic vendor chunk.

The editor follows the same feature-first boundaries as requirements:

```text
features/editor/
├── EditorPage.tsx          route validation and inherited Ant Design theme
├── EditorWorkspace.tsx     controller and panel composition
├── components/             chrome, sidebar, document/Git/terminal views and dialogs
├── hooks/                  document, command, guard, layout and RPC lifecycle
├── utils/                  pure document/tab transitions, shortcuts and Git graph
├── types.ts                shared feature contracts, not component-owned exports
└── editor.css              scoped editor/renderer structure
```

`useEditorWorkbench` coordinates columns, independent view state, layout persistence and filesystem-event refresh. `useEditorDocuments` owns shared buffers, bounded loads, per-file serialized/versioned saves and disk comparisons; `useEditorGuards` owns dirty-close, route and browser-leave protection. `useEditorCommands` binds the command catalog and keyboard lifecycle; key-to-command mapping and document/tab transitions are pure utilities. `useEditorFileActions`, `useEditorSearch`, `useEditorGit` and `useEditorTerminals` own their RPC calls and failure paths. `EditorSidebar`, `EditorFileDialog` and `EditorGitHistory` own coherent presentations, not another set of controllers. No editor controller creates another connection. Connection loss must not replace the editor with an error page or drop buffers.

The default entry is diff-first. `EditorReview` owns the grouped change list and embedded read-only viewer, while `useEditorReview` guards its async requests against stale selections and mode/repository changes. `utils/gitChanges.ts` shares grouping with the existing Git panel and resolves optional `view=changes|files` URL state; legacy explicit file links keep opening All files. Keep the full editor mounted when hidden so switching back preserves buffers and view state. Review uses saved local Git changes and manual refresh, not remote-main comparison or Git polling. The existing `EditorDiff` supports embedded review and modal history/disk comparisons without duplicating the CodeMirror renderer.

Text diffs load the existing filename-based language support and use the editor's dark syntax palette. Their CodeMirror theme uses Ant Design success/error backgrounds for changed lines, stronger border-color backgrounds for changed characters and matching gutter markers in both inline and side-by-side modes. Disable active-line and same-word overlays in this read-only view so they do not obscure diff meaning; do not change source-editor behavior or code column widths.

`EditorImageDiff` handles signature-checked raster versions returned by the same diff RPC. Before/after panes and absent-image states reuse native Ant Design `Image`/`Empty` and the global theme; image changes never mount CodeMirror or display text hunk actions. The server retains original Git bytes and the 4 MiB per-side preview limit. Unsupported binaries retain external-editor recovery.

`useEditorGit` owns confirmed bulk discard and the optional returned stash recovery ID, shared by review and Source Control. `EditorDiscardOptions` presents the backup checkbox (off by default) and the matching risk description; no-backup execution requires a second destructive confirmation. `useEditorGitDraft` owns commit text and opt-in Codex generation: confirm the staged-patch transfer, keep existing text on failure, and invalidate results after a Git/scope change or newer typing. `EditorGit` renders the generation button beside the existing commit form; generation never clicks Commit for the user. The editor shell shows a recovery command only when a backup was requested.

Closed source tabs release cached editor/undo state; inactive open tabs retain it. Filesystem events refresh affected cached child directories as well as the root, and manual refresh preserves expanded listings. Git status warns about excluded non-ignored changes instead of declaring a clean checkout; commit validation checks the whole index on the server, including files staged by other tools.

Server adapters resolve roots from current requirement/member IDs; no RPC accepts an arbitrary machine root or a free-form Git command. Shared path checks reject traversal, symlinks, Git/dependency/worktree metadata and common environment/key files. Text/images are capped at 4 MiB; directory reads examine at most 1,000 entries and report truncation. These exclusions are not a secret detector or an OS sandbox. Version conflicts stop saves; Trash has no permanent-delete fallback. Browser checks are not authorization.

Trash invokes macOS's system command with one absolute literal path, never glob expansion. If the command is unavailable, deletion is blocked and the user must use the file manager. Do not reintroduce a wildcard-expanding delete helper or move items into a guessed `.Trash` directory.

Markdown skips raw HTML and remote images; SVG is displayed in image mode, not injected into the document. Arbitrary project HTML is never executed by a file preview. A terminal is different: it starts only after an explicit non-sandbox warning and has the current user's machine permissions. PTY output/session counts are bounded; close/server shutdown disposes processes, and unattached sessions expire. No source text or terminal transcript is persisted in layout storage. The only editor upload is a user-confirmed, bounded staged patch for Codex commit-message generation; filename exclusions are not a secret detector.

`editor-sessions.json` sits beside CPL config and stores only validated paths, tab/view positions, sizes, recent command IDs and editor preferences. Legacy per-session `dark` fields are ignored and omitted on the next save; opening a repository must not change global appearance. Unsaved text remains memory-only; browser refresh/close uses the native before-unload safeguard because browsers do not support a custom asynchronous close dialog. In-app navigation and tab/file actions use Ant Design dialogs. See [editor acceptance](../../docs/editor-spec.md) for the feature contract and verification record.

## React rules

- State belongs to the closest common owner; derive filtered collections instead of storing duplicate state.
- Feature components receive plain values and callbacks. They do not call RPC methods directly.
- Keep destructive validation and async error handling in the feature controller.
- Add a new folder only when a feature has more than one file; avoid one-file abstraction layers.
