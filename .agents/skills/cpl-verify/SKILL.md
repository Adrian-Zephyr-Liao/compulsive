---
name: cpl-verify
description: >
  Select and run change-specific local validation for Compulsive/CPL when asked
  to verify a change, assess readiness or complete implementation before handoff,
  commit or push. Reuse the repository validation matrix and report evidence,
  failures and unrun checks; invoking this Skill does not authorize Git delivery
  or publishing.
---

# Verify a Compulsive change

Read the root [instructions](../../../AGENTS.md), the [validation matrix](../../../docs/development.md#validation) and live [package scripts](../../../package.json). The matrix owns check selection; this Skill turns the requested scope into an executed result.

## Determine what needs evidence

Confirm the checkout and branch, record HEAD and `git status --short --branch`, and identify the task's changed paths. Inspect staged and unstaged diffs plus relevant untracked files. For a commit or PR, use its verified comparison; retain local pending changes as a separate layer. Infer scope from the user's task and current context; clarify only ambiguity that would change the verification conclusion.

Map the change to its owning implementation, callers, tests and docs using [architecture](../../../docs/architecture.md). Include affected shared contracts, not unrelated worktree changes. Record the expected behavior and what observation would prove it before choosing commands.

Check [document ownership](../../../docs/AGENTS.md) and the [Note triggers](../../notes/README.md). In a verify-only task, report missing updates without editing them; in an authorized implementation task, complete the required updates before final verification.

## Select and execute

1. Choose the applicable rows from the current validation matrix and confirm the commands still exist. Start with the narrowest tests that cover the changed behavior; include failure/rejection paths and affected consumers when safety or shared behavior changes.
2. Run selected checks once, recording the exact command, scope and result. Test/build output must match the revision and dirty files being delivered. After further changes, rerun only the checks whose evidence was invalidated.
3. Use the matrix's artifact/browser requirements when the change reaches those entry paths. Verify isolated files, Git state or user interactions rather than trusting a success message. Retain the matrix's limits for mocks and cached remote refs.
4. Finish with the task diff, `git diff --check` and final status. A missing dependency, unavailable service, cancelled run or zero matching tests is not a pass. Do not use no-test success flags or reduce a check merely to obtain green output.

Use the isolation rules in [development](../../../docs/development.md#implement-a-complete-change) for filesystem, Git and built-CLI checks. A verification request does not authorize real repository deletion, remote pushes, task creation or permission changes. If an acceptance step needs an unavailable or unauthorized live action, finish the safe checks and report that step as unverified.

## Handle failures and hand off

For each failure, identify the exact diagnostic and whether it belongs to the task. Fix task-owned failures only when implementation/repair is authorized. In verify-only work, report the failure and cause supported by evidence. Preserve unrelated pending work; distinguish a narrowed passing check from a failed whole-worktree check rather than declaring the entire tree green.

If verification was requested by an ongoing review, return the results to that review. For a standalone handoff, use [cpl-code-review](../cpl-code-review/SKILL.md) when a review is requested or warranted by the affected risk, reusing the completed check results. Neither path requires another agent or a remote review.

Report:

- The verified scope and observed result.
- Exact commands and pass/fail/not-run outcomes, with the behavior or evidence each covers.
- Missing documentation/decision updates, baseline failures and acceptance gaps, with reasons and any remaining next action.

Follow the [delivery requirements](../../../docs/development.md#synchronize-and-report). Stop after verification unless Git delivery is separately authorized; explicit instructions such as “do not commit or push” remain binding.
