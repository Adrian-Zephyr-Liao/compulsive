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

The settings feature keeps `SystemSettingsPage.tsx` as its route/navigation shell. `StorageSettingsPanel.tsx` owns configuration form rendering and field rules; `DoctorPanel.tsx` owns the basic diagnostic presentation. `useSettingsState.ts` owns the draft/form instance and on-demand diagnostic execution/results; call these hooks in the shell, not route children, so switching settings subroutes retains existing drafts and results. `WorktreeAuditPanel.tsx` and `useWorktreeAudit.ts` remain the separate inventory/removal presentation and controller. No settings panel creates an additional RPC connection.

## Local routes

The application uses React Router's `HashRouter` so CPL's static frontend supports direct links and reloads without server rewrite rules:

- `#/requirements/:workspaceId`: a requirement and its repositories. Encode the full persistent workspace ID when building links.
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

## React rules

- State belongs to the closest common owner; derive filtered collections instead of storing duplicate state.
- Feature components receive plain values and callbacks. They do not call RPC methods directly.
- Keep destructive validation and async error handling in the feature controller.
- Add a new folder only when a feature has more than one file; avoid one-file abstraction layers.
