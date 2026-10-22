# Agent Note: Diff-first local project review

Status: implemented

## Problem

An agent-oriented project viewer is mainly used to review generated changes. Opening a blank source editor or a commit form first makes that primary task harder. Full editing remains necessary, and changing the default must not discard unsaved buffers or break explicit file links.

## Decision

Default repository entry to a grouped local-change list and an embedded read-only diff. Keep All files adjacent and retain the existing editor mounted, including dirty-buffer guards. Legacy file links still open All files; optional `view=changes|files` query state selects the mode without changing the saved session format.

Embedded review starts inline and retains the user's layout choice across file/view changes in the current editor session. Modal comparisons keep their existing default. This avoids splitting an already narrow review panel into unreadable halves without introducing another persisted preference.

Reuse the existing authenticated status/diff RPCs and CodeMirror renderer. Separate staged/index and unstaged/disk entries, including both entries for a mixed change. Include new files; do not present conflicts as a valid two-way diff. Select the first available non-conflicted change, invalidate late requests and retain manual refresh, exclusion warnings and external-editor recovery.

Raster images are a supported read-only diff, not a failed text preview. Reuse signature detection and bounded reads from the existing asset owner, retain binary Git output without UTF-8 transcoding, and return optional image sides through the existing diff result. A separate native Ant Design image presentation serves both embedded and modal consumers. Unsupported binaries still use external-editor recovery; this does not add binary editing or text conversion.

The staged-rename regression exposed a shared diff-reader defect: after a rename is staged, later unstaged edits must compare against the new index path, not the old HEAD path. Fix that lookup at `project/git.ts` so both review and existing Git/history consumers use the correct baseline.

## Alternatives considered

- Only making Source Control the initial sidebar: rejected because the commit form and modal diff still put review behind extra actions.
- Replacing or remounting the full editor on every switch: rejected because buffers and per-view state must survive.
- Adding remote-main comparison, automatic Git polling or another diff library: not required by this local-review change. Review currently means saved, local uncommitted changes; historical commits remain available through the existing Git panel.

## Consequences

No new dependency, RPC name, filesystem authority, Git mutation or persisted data format is introduced. Image support adds optional fields to the existing diff result. Unavailable/unsupported binary files retain a VS Code action. Read-only diff contents do not include unsaved in-memory edits; the UI says so. The existing full editor and Git actions remain available in All files.

## Verification

- Focused regressions passed: 31 frontend tests in nine files and 13 real-Git tests. They cover view defaults and legacy links, mixed staged/unstaged entries, added/deleted/renamed files, ignored/excluded paths, unavailable/conflicted files, stale responses and embedded/controlled diff layout.
- `pnpm run check` passed docs, architecture, formatting, lint and types. `pnpm run prepack`, Ant Design lint (zero issues) and `npm pack --dry-run --ignore-scripts --json` passed. The existing large Ant Design vendor-chunk warning remains.
- An isolated preview server and disposable Git fixture verified direct diff-first entry, clean empty state, staged/unstaged/new/deleted contents, inline and side-by-side selection, retained file/layout selection across views, full-file opening and unsaved-buffer retention. Chinese/light and English/dark views were checked. A symlink produced an explicit unavailable state with VS Code recovery and no invalid full-file action. Synthetic unmerged index entries verified the conflict fallback, not actual conflict resolution.
- Diff excludes unsaved buffers, with a visible warning; an independent disk read confirmed the temporary browser-only edit was not saved. User repositories and the existing local server were not mutated or restarted. The full test suite, whole-branch comparisons and external VS Code actions were not exercised. No commit, push or npm publication was performed.
- PNG follow-up: `pnpm run test tests/editor-diff.test.tsx tests/editor-review-loading.test.ts tests/i18n.test.ts --no-file-parallelism` passed 15 tests, including bilingual image sides, added/deleted empty states and escaped image-to-text content. `pnpm run check`, `pnpm run prepack` and Ant Design lint on both diff components passed. The existing vendor-size warning remains.
- Focused real-Git runs passed 36 related tests across `tests/project-git-images.test.ts`, `tests/project-git.test.ts` and `tests/project-files.test.ts`, executed with `pnpm run test --no-file-parallelism` and explicit file selection. They cover byte-preserving staged/unstaged/new/deleted/historical images, text/image replacements, UTF-8/BOM, the 4 MiB bound and path/member/symlink protections. Initial cumulative image lifecycle cases and an existing hunk case exceeded the default timeout; image lifecycle cases were separated and the hunk passed on rerun without increasing timeouts. These are focused-run results, not a full-suite pass.
- The disposable browser fixture verified actual PNG before/after rendering, native image zoom, added/deleted sides and English/light plus Chinese/dark surfaces. Its images and names are synthetic. The global local-link service was rebuilt and restarted on port 7392; HTTP 200 and the served frontend asset hash were checked. No user repository contents, commits or remotes were modified. A full-suite run and unsupported binary viewers remain outside this follow-up.
