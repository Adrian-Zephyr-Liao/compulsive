# Agent Note: Global DevTool appearance

Status: implemented

## Problem

The editor's independent theme left the requirement/settings shell and fixed white page chrome out of sync. Per-repository appearance could also change the theme when opening a different repository.

## Decision

Use one app-level appearance provider, hydrated through the existing state connection. Header and editor preference controls persist the same validated global choice before applying it. Ant Design's default/dark algorithms and shared semantic tokens own main surfaces, controls, overlays and terminal colors. Nested editor configuration changes density, not colors or theme authority.

Store the choice in `devtool-preferences.json` beside CPL config with the existing atomic-write helper and serialized operations. Strip legacy session theme fields on the next session save. Keep router/connection ownership and unsaved document buffers unchanged.

## Alternatives considered

- Keeping a second editor palette: rejected because entering/leaving the editor would still change global visual context.
- Browser-only storage: rejected to retain the selected CPL-local preferences location.
- Public CLI/library configuration additions: rejected because this is DevTool-only presentation state.

## Consequences

The private RPC/state format gains appearance preferences, but repository lifecycle and public manager interfaces do not change. Existing users start in the shell's light theme until explicitly choosing global dark mode; conflicting per-repository values are not guessed into a global preference. In-session workspace refreshes must not override a confirmed choice. Separate browser clients do not receive live theme-change broadcasts.

## Verification

`pnpm run test tests/devtool-preferences.test.ts tests/app-theme.test.tsx tests/devtool.test.ts tests/editor-route.test.tsx tests/project-session.test.ts tests/i18n.test.ts --no-file-parallelism` passed 17 tests in six files. Coverage includes persistence across manager instances, serialization, validation/no-overwrite, legacy session-field removal, both semantic palettes and bilingual editor inheritance. Derived primary-button, link and selected-label foreground/background pairs meet a 4.5:1 contrast assertion; this is not a full accessibility audit.

`pnpm run check`, `antd lint src/devtool-client --format json`, `pnpm run build` and `pnpm run prepack` passed. The final color-only refinement was followed by the focused contrast test and a browser rebuild. The existing approximately 902 kB Ant Design vendor warning remains.

An isolated built-CLI browser fixture verified header switching, refresh persistence, requirement/settings/Doctor navigation, dark modal/dropdown surfaces, editor-to-shell theme continuity, retained dirty buffers and navigation protection, and live terminal output across both modes and locales. Synthetic screenshots are saved for [requirements](../../docs/screenshots/global-dark-requirement.png), [settings](../../docs/screenshots/global-dark-settings.png) and the [editor](../../docs/screenshots/global-dark-editor.png). No real repository content was modified. The global local-link server was restarted on port 7392; no Git or npm publication was performed. Cross-browser and live cross-client theme broadcasting are not accepted features.
