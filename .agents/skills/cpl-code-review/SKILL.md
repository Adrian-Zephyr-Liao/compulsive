---
name: cpl-code-review
description: >
  Review Compulsive/CPL changes, commits or pull requests when a code review,
  safety review or review of a fix is requested. Trace the changed behavior,
  repository-specific safeguards and verification evidence; report findings
  without editing or posting a remote review unless requested.
---

# Review Compulsive changes

Use the repository's [instructions](../../../AGENTS.md) and [architecture](../../../docs/architecture.md) as the rules. This Skill organizes the review; the linked documents own the requirements.

## Establish the review scope

Confirm the checkout, HEAD and `git status --short --branch`. Resolve the requested paths, commit or PR base/head from the user's request and available metadata; do not substitute a guessed default branch or assume a clean worktree. State the selected comparison.

- For working-tree changes, inspect staged and unstaged diffs separately, then read the relevant untracked files: `git diff` does not include them. Keep unrelated pending work out of a task-specific review.
- For a commit, inspect `git show <commit>` and its affected callers. For a branch/PR, use `git diff <verified-base>...<verified-head>` and identify any local-only changes separately. If live PR refs are unavailable, review the available local scope and label the remote comparison unverified.
- Review requests authorize investigation and relevant local checks. Source edits, staging, committing, pushing and remote review comments require the corresponding user request; this Skill never implies those actions.

Read enough surrounding source to trace each changed operation from its CLI, library or RPC entrypoint to its owner, consumers, persistence and tests. Follow the root code-search convention. Recheck scope when files or refs change during the review.

## Follow the affected behavior

Use only the applicable rows; this is a risk guide, not another policy or an instruction to audit the whole repository.

| Change reaches                    | Review questions and owning material                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git/filesystem mutations          | Does the executing operation enforce the [Workspace guarantees](../../../docs/workspaces-spec.md), including alternate CLI/library/RPC callers? Follow identity, path, dirty-state and reference checks through to the exact Git/filesystem operation. Check failure recovery and preservation of canonical repositories; use current operation-specific code/docs for force-removal behavior. |
| Persistence or async work         | Trace validation, atomic writes, rollback and partial-failure reporting. Check when success becomes visible and whether cancellation or concurrent state changes invalidate the decision.                                                                                                                                                                                                      |
| Shared interfaces                 | Trace both sides of changed types, errors, defaults and return fields, including `index.ts` exports when public, CLI JSON/exit behavior, RPC schemas and browser consumers. Check credential redaction before persisted or displayed errors.                                                                                                                                                   |
| Imports or frontend behavior      | Compare ownership against [dependency rules](../../../docs/architecture.md#dependency-and-state-rules); a passing import graph does not prove semantic ownership. Read [frontend instructions](../../../src/devtool-client/AGENTS.md) for browser state, component, locale and acceptance requirements.                                                                                        |
| Docs, prompts or decision records | Compare claims against the owning implementation. Follow [document ownership](../../../docs/AGENTS.md) and [Note policy](../../notes/README.md); inspect changed defaults, limitations, errors and proposed/implemented status. Flag substantive omissions, not wording preferences.                                                                                                           |

Evaluate regression strength: would the assertion fail on the reported defect, and does it inspect actual files, Git state, registry contents or user-visible behavior? Passing mocks, RPC-name tests or coverage alone cannot establish the complete operation. Existing tests may encode the obsolete behavior being fixed.

Use the selection/execution steps in [cpl-verify](../cpl-verify/SKILL.md) when running selected checks or assessing missing evidence; the review is already underway, so return verification results here instead of starting another review. Follow its linked matrix rather than reproducing command lists. Keep baseline failures and missing browser, packaged or live-service evidence visible.

## Report findings

Lead with actionable findings, ordered by impact. For each, give the affected file and verified line, the trigger, concrete consequence and supporting code/test evidence. Distinguish blockers from suggestions and identify uncertainty; omit hypothetical failures without a plausible path.

If no actionable defect is established, say so and list remaining verification gaps. Report the reviewed comparison and checks actually run. A review-only result contains findings and evidence, not an automatic fix, commit or remote comment.
