# DevTool frontend conventions

The frontend uses a small feature-first structure. Keep dependencies pointing inward:

```text
src/devtool-client/
├── app/                 providers and Ant Design theme
├── features/            business-owned state and UI
├── shared/ui/           business-agnostic primitives
└── styles/              Tailwind entrypoint and scoped structural CSS
```

## Responsibilities

- `app/`: root providers, global theme tokens, and application bootstrap only.
- `features/workspaces/`: workspace RPC state, actions, screens, dialogs, and feature components.
- `shared/ui/`: reusable wrappers around Ant Design with no workspace vocabulary.
- `styles/`: the Tailwind entrypoint and scoped structural CSS that cannot be expressed clearly with Ant Design tokens or short utility classes.

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
