# Agent Note: Full local editor workbench

Status: implemented

## Problem

The user expanded the former read-only preview to a Mayoi-inspired local editor: editing/saving, file management, search, editor columns, Git, terminals and persistent light/dark preferences. SSH and account/cloud sync are excluded. A browser-based local editor must preserve unsaved work and must not turn a path or Git command from the browser into unrestricted backend authority.

## Decision

Keep React/Ant Design/Tailwind, CodeMirror 6 and the authenticated Devframe connection. Use an edge-to-edge editor route with compact chrome, lazy Explorer/Search/Git modes, independent columns and local preview/terminal views. Mayoi's public screenshots and documented interactions are references, not copied native code, assets or branding.

Shared domain owners enforce current membership, paths, version checks, bounded work and process lifetime. Saves use same-directory atomic replacement and expected content versions. Rename reserves a destination exclusively; Trash is recoverable with exact path/identity confirmation. Search matches run in a cancellable, time-limited worker. Git actions use literal arguments and reviewed state; hunk patches are generated on the server. Push delegates to existing branch/upstream/lease safeguards. Native terminals require an explicit non-sandbox warning; unrelated agent/API credential variables are not inherited.

Store validated layout/preferences beside CPL config, never source buffers or transcripts. Use a data hash router to block in-app navigation; retain native before-unload protection for browser refresh/close. Filesystem events refresh clean documents while retaining dirty buffers and reporting disk conflicts. Keep buffers mounted during connection failure.

Internal cleanup groups server project operations under `src/project/` and names the browser feature `features/editor/`, with components, hooks and pure utilities matching the existing requirement feature. Separate document I/O, unsaved-work guards and command/shortcut lifecycles from page/layout coordination. Keep file-operation dialogs, sidebar modes and Git history as cohesive views; do not split individual controls or add forwarding barrels. Shared feature types no longer depend on view exports. These are internal ownership changes, not URL, RPC, public-library or persistence migrations.

## Alternatives considered

- Porting Mayoi's Go/native terminal/application stack: rejected because CPL already has a local React/Ant Design host and no native-window/SSH scope.
- A hand-written editor, terminal or Markdown parser: rejected in favor of installed CodeMirror/xterm/Markdown components.
- A generic filesystem root, shell-command Git RPC or unconditional force push: rejected because executing owners must retain membership, literal-path and lease safeguards.
- Browser storage for editor sessions or persisting unsaved source/transcripts: rejected to follow CPL storage ownership and avoid retaining project contents.
- Replacing every refresh with polling: rejected; filesystem events and bounded waits handle file/PTY delivery, while Git remains on demand.
- Keeping a flat read-only-preview namespace for a complete editor, or dividing every short helper/control into its own layer: rejected because the former hides ownership and the latter adds navigation without a distinct responsibility.

## Consequences

This supersedes the [read-only preview decision](2026-10-22-read-only-code-preview.md). Internal RPCs and a private session format expand, without a public manager editing API. Runtime terminal dependencies are added; macOS `node-pty` 1.1.0 needs an owned, regular spawn-helper to have its owner execute bit restored (upstream issue 919). This narrow workaround never changes another user's file or broad directory permissions.

The initially evaluated `trash` package was removed: its default glob expansion could affect paths beyond the confirmed literal filename, and it introduced an unpatched `braces` advisory. Use macOS's `/usr/bin/trash -s <absolute-path>` with argument arrays instead. Systems without that command reject the operation with a Finder/file-manager escape; no permanent deletion or guessed Trash directory is used. This preserves the native Trash/Put Back behavior without another glob dependency.

A local terminal is not confined to the selected repository. Common filename exclusions do not detect secrets in arbitrary source. Version/path checks and exclusive reservations protect normal concurrent editing, not a hostile process continuously swapping user-owned filesystem ancestors. Search/index/output sizes and session counts are intentionally bounded; unsupported files retain the VS Code escape hatch. Symbol hints are syntax-neutral, not a language server. No SSH, cloud accounts, AI providers, Git publication or npm publication is implied.

## Verification

The editor specification [records commands, browser observations and explicit limits](../../docs/editor-spec.md#implementation-record). The serial regression passed 186 tests in 31 files; static checks, Ant Design feature lint, package checks and production dependency audit passed. Isolated browser walkthroughs additionally checked actual disk saves, native literal-path Trash, rename, diff rendering, hunk staging, a local commit, layout/theme restoration and real PTY output. Browser acceptance caught and repaired deferred Modal mounting, context-menu event propagation and orientation-dependent panel sizing.

Internal cleanup was revalidated with a fresh serial run: 200 tests passed in 34 files. Added document/shortcut transitions and parent/sibling/prefix-neighbor path cases supplement the existing filesystem, Git and PTY coverage. Relocation acceptance caught two accidentally rewritten `..` path literals; both were restored before the fresh passing run. Isolated browser checks confirmed actual disk saves, dirty-close and route-leave cancellation, quick open, file-operation/Git-history dialogs, shared columns and both locales. The fixture server and temporary synthetic repository were removed afterward; the user's existing port-7392 server remained available.

The cleanup also passed `pnpm run check`, feature Ant Design lint, `pnpm run prepack` and package dry-run checks. The dry-run includes the renamed lazy assets and no old page chunks at unchanged version 0.1.6. The existing Ant Design vendor-size warning remains.

All Git mutations used temporary repositories and a local file remote. No real repository was mutated, and nothing was committed, pushed or published for this editor task. Native cross-platform behavior, real external Git hosts, OS-level IME/VoiceOver and dirty-buffer reauthentication remain unverified.
