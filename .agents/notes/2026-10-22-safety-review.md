# Agent Note: Repository safety review and bounded repairs

Status: implemented

## Problem

What this repo does: CPL manages local Git repositories and requirement worktrees through a library, CLI and authenticated browser UI. Its editor also reads and writes local files, stages Git changes and starts explicit local terminals.

This review covers the current `main` working tree over `cdd9b393301f8a8e7c90843a4b66f5598eb631d1`, including existing unstaged and untracked editor/theme work. There were no staged changes. The assumed load is one local user's CLI and DevTool, not a multi-user hosted service. The pass follows entrypoints, executing owners, callers, persistence and tests across repository organization, Workspace lifecycle, worktree audit/removal, editor files/Git/search/session/watch/PTY, browser controllers, CLI output and package configuration. It is risk-led, not a claim that every line or possible concurrent process interleaving is defect-free.

## Decision

Repair confirmed defects at their executing owners and add focused regressions. Keep existing dirty-worktree checks, path validation, authentication, argument arrays and explicit leased pushes. Do not change user's repositories, add dependencies, publish, or perform a broad architectural rewrite.

The repairs are:

### Must fix

1. **A repeated rebase replaced the original force-push lease.** [Owner](../../src/workspace-sync.ts), line 76; same-branch selection [owner](../../src/workspace-members.ts), line 284.
   - What this is: the lease is the remote commit the user is allowed to replace after rewriting history.
   - Problem: another writer could advance the remote, then a first or repeated rebase accepted that tip as the lease even when local history never contained it. Selecting the same branch also dropped the saved lease.
   - Fix: arm the first lease only if local history or the rebase destination contains the remote tip, then retain that original base until safely cleared. Selecting the current branch is a no-op. Integration regressions cover independent remote writers, rejected first/repeated force authorization and safe fast-forward development on the default branch.
   - If skipped: a confirmed force push can overwrite remote work the local user never integrated.

2. **Deleting a Workspace could delete a canonical repository inside it.** [Owner](../../src/workspace-deletion.ts), lines 40 and 62.
   - What this is: Workspace deletion recursively removes its directory after member cleanup.
   - Problem: preflight protected exact roots and nested Workspaces, but not registered canonical repositories inside the directory or ancestors of protected roots. A configured symlink could also hide the physical storage root from the comparison.
   - Fix: resolve protected roots physically and reject these paths before touching members. Regressions verify an independently registered nested checkout, both symlinked root settings, retained file contents and registration after rejection.
   - If skipped: deleting a requirement can also delete a main checkout.

3. **Deletion rollback restored members before their parent directory.** [Owner](../../src/workspace-deletion.ts), line 125.
   - What this is: a failed registry write must reverse disk operations.
   - Problem: the rollback executor reverses its list; the previous list tried to restore links into a still-renamed directory.
   - Fix: restore the Workspace directory first, then worktrees and links. An injected write failure verifies readable member files and unchanged metadata.
   - If skipped: a failed deletion leaves broken members instead of restoring the prior state.

4. **Reference rollback used a moving remote ref instead of the removed HEAD.** [Workspace owner](../../src/workspace-deletion.ts), [member owner](../../src/workspace-members.ts), line 203.
   - What this is: detached reference checkouts need an exact rollback point.
   - Problem: restoring `origin/main` after it advanced changed the reference checkout during rollback.
   - Fix: capture HEAD before removing the worktree and use that commit when restoring it. Both whole-Workspace and single-member failure tests verify the exact old HEAD.
   - If skipped: a failed operation changes the code version the user was using as a reference.

5. **A directory-stage request included excluded descendants.** [Owner](../../src/project/git.ts), line 341.
   - What this is: editor Git actions operate on reviewed file paths.
   - Problem: a literal directory passed to `git add` still recurses, including an excluded `.env` below it.
   - Fix: require individual visible change paths and reject directory/submodule staging. A real Git regression verifies the index remains empty after rejection.
   - If skipped: a seemingly limited stage can include files outside the editor's visible selection.

6. **Filtered Git status hid staged files that commit still included.** [Owner](../../src/project/git.ts), line 409; [view](../../src/devtool-client/features/editor/components/EditorGit.tsx).
   - What this is: commit/amend apply to Git's complete index, not only the displayed list.
   - Problem: excluded files staged by another tool disappeared from the UI but were committed along with visible changes; an excluded-only working tree was labelled clean.
   - Fix: validate the full staged path list before commit/amend. Report excluded non-ignored changes without exposing their paths and block clean-only undo/pull. Ignored build directories do not count as dirty. Tests verify an unchanged HEAD, preserved excluded contents and bilingual non-clean presentation.
   - If skipped: private configuration can be committed without appearing in the editor's review list.

7. **Organization moved repositories without repairing worktree pointers.** [Owner](../../src/repository-organize.ts), line 145.
   - What this is: moving a checkout changes paths that Git and CPL may store elsewhere.
   - Problem: linked worktrees and separate Git directories could retain old absolute paths after a plain rename.
   - Fix: reject such non-no-op moves during planning and execution revalidation. Tests create a worktree after an earlier plan and verify that both checkouts and the original registry remain intact; a separate-Git-directory case is also covered.
   - If skipped: a normal organize action can break other checkouts.

### Should fix

8. **Deleted directories prevented individual Git file actions.** [Owner](../../src/project/git.ts), line 371; [controller](../../src/devtool-client/features/editor/hooks/useEditorGit.ts).
   - What this is: stage, unstage and discard must also handle tracked deletions.
   - Problem: filesystem lookup failed at a missing parent; discard tried to read a deleted file to get its version.
   - Fix: use the reviewed Git deletion state for index actions and an explicit absence version for restoring a deletion. Tests verify stage/unstage, actual restored content and rejection after a file reappears with newer content.
   - If skipped: deleted files cannot be managed through the editor even though Git supports them.

9. **Closed editor tabs kept whole documents and undo histories in memory.** [Owner](../../src/devtool-client/features/editor/utils/editorState.ts), line 33; [caller](../../src/devtool-client/features/editor/hooks/useEditorWorkbench.ts).
   - What this is: cached CodeMirror state preserves open tabs, not every file ever opened.
   - Problem: the document limit did not bound the separate state map after closing tabs.
   - Fix: retain state only for open source views, keeping inactive tabs while removing closed columns and preview-only entries. A pure regression checks exact retained keys.
   - If skipped: long editing sessions keep accumulating source text and undo history.

10. **Filesystem events refreshed only the root file tree.** [Owner](../../src/devtool-client/features/editor/hooks/useEditorWorkbench.ts), line 133.
    - What this is: expanded directories have their own cached entries.
    - Problem: adding a file below an already expanded directory left that listing stale.
    - Fix: refresh affected cached directories and preserve expanded listings during manual refresh. Selector tests cover related, unrelated and full-root events; a browser walkthrough observed an external file appear in the expanded `src` directory.
    - If skipped: the tree hides new files until the user collapses/reopens or reloads it.

11. **`forget --json` emitted human terminal text.** [Owner](../../src/cli.ts), line 193.
    - What this is: scripts expect one JSON value on stdout.
    - Problem: successful forget ignored JSON mode and printed a styled success message.
    - Fix: return `{ forgotten: id }` through the existing output owner. The regression parses stdout and verifies repository files still exist.
    - If skipped: automation cannot parse a successful command.

12. **A valid `..project` directory was treated as traversal.** [Owner](../../src/repository-metadata.ts), line 5.
    - What this is: repository classification and organization share a containment check.
    - Problem: `startsWith("..")` rejects a legitimate child name as well as a parent path.
    - Fix: reject only the complete parent segment or a parent-plus-separator prefix. Tests retain rejection of parents/siblings and accept legitimate dotted names.
    - If skipped: managed repositories can be misclassified and safe paths rejected.

### Nice to have

Removed 11 lines of unreachable cleanup in `addGitWorktree`: its `added` flag was set only after the only awaited operation completed, so its catch branch could never see it true. Actual rollback stays with the owning member/clone transaction. No dependency was added or removed for these repairs.

The built CLI smoke check also exposed an outdated blanket statement that CPL never deletes repository files. The existing Workspace/worktree deletion features make that promise false. Help now explicitly warns that removal can delete files and asks the user to review the target; the existing CLI flag regression checks both the new warning and removal of the false promise.

The mixed-inventory audit regression also prepared four worktrees, locks, ignored files and registry links inside its five-second assertion budget. A contended complete run exposed that timeout. Preparation now runs in a dedicated bounded 20-second fixture hook; the real audit/validation assertions retain their original five-second limit. Final validation ran serially, without a second Git-heavy test process competing with it.

## Alternatives considered

- Refreshing a force-push lease after each fetch: rejected because it changes what the user may overwrite without integrating that remote work.
- Trusting the filtered Git list or only disabling a UI button: rejected because another editor or RPC caller can populate the index or send a recursive directory path.
- Automatically repairing every worktree/admin pointer during organize: not implemented. That requires a separate multi-checkout migration/rollback contract; this repair blocks the unsafe move before mutation instead.
- Rewriting architecture, replacing the UI stack or adding a component/testing dependency: unnecessary for these defects.

## Consequences

URLs, session formats and public library methods stay unchanged. Editor Git status gains an additive excluded-change flag, and commit/amend can now reject an excluded staged path with an external-editor recovery message. This is a common-name exclusion policy, not a secret detector. The paired user READMEs, Workspace spec and editor spec describe the strengthened boundaries.

Automatic organize is deliberately unavailable for linked worktrees, main repositories with linked worktrees and external Git directories. A correctly located repository remains a no-op. Resolve the Git layout explicitly before trying to move it; CPL does not delete worktrees to make an organize request succeed.

## Verification

Follow-up delivery review on 2026-10-23 found that direct fast-forward pull could overwrite an ignored
local file newly tracked upstream. A real temporary-repository test reproduced the changed bytes.
The editor now fetches the configured upstream, fixes its commit ID, revalidates identity/local state,
and merges with `--ff-only --no-autostash --no-overwrite-ignore`; `git pull` does not accept the final
protection flag directly. Four regressions passed for ignored collisions, non-origin upstreams,
divergence and new local edits during fetch. A late save response also no longer resurrects a closed
document; 13 document/state regressions passed, retaining newer typing and the actual saved baseline.
The Codex protocol test now releases simulated completion explicitly instead of racing 900ms against
subprocess startup; all five protocol cases passed without increasing the global timeout.

New regressions reproduced the old failures before the relevant fixes: a changed force-push lease, failed rollback, nested canonical deletion, recursive staging, hidden-file commit, missing-parent Git actions, non-JSON output, unprotected organize planning and dotted-name classification. An initial broad repaired run passed 216 tests in 36 files. One subsequent run was interrupted for the physical-root fix; another exposed the contended audit-fixture timeout described above and was stopped. Neither incomplete run is counted as passing. After the safety/behavior changes, the focused audit/branch run passed 24 tests, then `pnpm run test --no-file-parallelism` passed all 221 tests in 36 files in 441.65 seconds. The subsequent help-only wording correction was first reproduced by its failing assertion, then passed the 23 CLI/terminal tests plus static checks and a rebuild; it does not change deletion behavior.

Browser acceptance used only temporary synthetic repositories and a local file remote. It observed nested-tree updates, both languages' excluded-change warning and a rejected commit when another tool staged an excluded file. Independent Git inspection confirmed HEAD still named the initial demo commit and both staged paths remained in the index. The first fixture was interrupted during authentication; that is not seamless-reauthentication acceptance. A second authenticated fixture completed the interaction, and temporary servers/data were removed afterward.

The final `pnpm run check` passed: 25 documentation files, 138 architecture-scoped sources, formatting for 215 files, and lint/type checks for 183 files. `antd lint src/devtool-client --format json` reported zero issues. `pnpm audit --prod --registry=https://registry.npmjs.org --json` reported no known production advisories. The final `pnpm run prepack` passed ESM/CJS, declarations, publint, attw and browser builds. Package dry-run listed 151 files at unchanged version 0.1.6. Existing large Ant Design vendor chunk and experimental compiler warnings remain.

Verdict: the confirmed destructive and Git-safety failures are repaired with regressions; no release is implied. Lean: 11 dead lines removed, zero dependency changes.

Not checked: every line/path combination, concurrent metadata writers in different CPL processes, live remote Git providers, a real Codex turn, cross-platform native behavior, heap profiling, OS IME/VoiceOver or seamless reauthentication with dirty buffers. File/terminal limits do not create an OS sandbox. Existing uncommitted work is retained; no repository commit, remote push or npm publication occurred.
