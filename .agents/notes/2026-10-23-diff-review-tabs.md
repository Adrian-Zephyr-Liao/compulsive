# Agent Note: Diff review tabs and Git range actions

Status: implemented

## Problem

Source Control comparisons interrupted editing with a modal. Detached numbered hunk buttons lacked code context, and the reader did not identify its comparison baselines. Source and two Git versions of one path must coexist without sharing dirty-buffer close/save semantics.

## Decision

Reuse CodeMirror and Ant Design. The common review frame names both baselines, adapts to panel width and separates display-chunk navigation from Git mutation. Place each hunk action at its parsed Git range, retaining the server's original index and fingerprint; malformed ranges disable actions rather than guessing. Serialize diff snapshots against CPL writers and compare before/after fingerprints. Staged renames retain whole-file operations, not mismatched hunk patches.

Add an optional validated `diff: staged|working` tab field to the private session format and URL query. Old sessions remain valid. Diff tabs load saved Git versions, never source documents, and cannot save/discard a same-path dirty buffer on close. Sessions still omit file contents and terminal output. `EditorDiffCode` owns the reader lifecycle; controllers retain Git operations and scoped request invalidation.

## Alternatives considered

- Keep the modal and only restyle it: rejected because review still interrupts the source workflow.
- Map CodeMirror chunk numbers to Git hunk indices: rejected because one Git hunk can contain multiple display chunks.
- Add another editor or diff dependency: rejected; existing packages provide the required lifecycle and decorations.
- Use one tab for every version of a path: rejected because source, index and working comparisons have different baselines and dirty-state semantics.

## Consequences

No new dependency or RPC name. Optional session metadata is persisted beside CPL config. Per-hunk controls use CodeMirror block widgets with native keyboard-accessible buttons and Ant Design tokens; ordinary controls remain Ant Design components. Read-only history/disk comparisons do not expose mutations. Scroll/line restoration after operations is approximate when content is removed. External processes are not serialized by CPL's lock; snapshot/fingerprint checks reject observed concurrent changes, not hostile continuous filesystem races.

## Verification

- Delivery regression covered 29 focused files in bounded runs: 149 tests passed, while the old highlight suite initially failed to collect because its mock targeted the former renderer. It now targets `EditorDiffCode`; all 8 highlight tests passed, and the 12 frame/image tests passed again with an explicit assertion that image comparisons do not mount the text reader. No full-repository test pass is claimed.
- Focused regressions passed 119 distinct tests in 18 files across bounded runs: editor diff/tab/range/state/route/Git/history/draft/review, project sessions/Git/images, RPC and locales. This includes a newly injected external writer during a diff read, rejected without changing its file or the index. An extended run initially timed out four Git cases; the 16-case Git file then passed at the original timeout, and the later concurrent-read case passed separately. No timeout was increased and no full-repository pass is claimed.
- `pnpm run check` passed documentation, architecture, format, lint and types; Ant Design feature lint found no issues. `pnpm run build` passed Node declarations/artifacts and the frontend, followed by fresh frontend builds after visual refinements. The existing Ant Design vendor-size warning remains.
- An isolated authenticated browser fixture verified independent staged/working/source tabs, deep links and refresh restoration, block staging/unstaging (also with Enter), disabled mutations for unsaved source, closing a Diff while preserving that source, navigation, empty comparison, explicit expansion, Chinese/light and English/dark. A side-by-side context line had matching 323px vertical coordinates in both panes after mirrored action rows were added. Git inspection confirmed that unstage retained the other indexed hunk and did not alter working content. Screenshots contain synthetic code only.
- No business repository mutation, real remote push, Codex execution or npm publication. The user's long-running server was not restarted. Complete cross-platform and assistive-technology acceptance remain outside these checks; line/scroll restoration after removed content is approximate.
