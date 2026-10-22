# Agent Note: Review and verification Skill entrypoints

Status: implemented

## Problem

The project guidance explains rules and check selection, but only the existing Ant Design workflow is packaged as a discoverable Skill. Review and handoff requests need execution entrypoints that reuse those rules and preserve the distinction between investigation, fixes and Git delivery.

## Decision

Add [cpl-code-review](../skills/cpl-code-review/SKILL.md) for requested change/commit/PR reviews and [cpl-verify](../skills/cpl-verify/SKILL.md) for change-specific local validation and handoff. Both use ordinary repository Skill discovery with `name` and `description` frontmatter, like the existing `antd` Skill. They can also be explicitly invoked as `$cpl-code-review` and `$cpl-verify`. No global installation or invocation-policy override is required.

Adapt the workflows from `.agents/skills/dsh-code-review/SKILL.md` and `.agents/skills/dsh-pre-push-checks/SKILL.md` in the local `deepseek-ai/deepseek-harness` checkout at commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Keep scope discovery, consumer tracing, behavior-focused evidence and review reporting. Replace DeepSeek package/Loader/snapshot checks with links to CPL's [architecture](../../docs/architecture.md), [validation matrix](../../docs/development.md#validation), [document owners](../../docs/AGENTS.md) and [Note policy](README.md).

The [root instructions](../../AGENTS.md) route review and verification requests to these Skills. They do not duplicate the test matrix or own product rules. Verification does not imply permission to fix source, commit, push, publish or post a remote review. Review results may identify missing verification without recursively invoking another review.

The existing [documentation checker](../../scripts/check-agent-docs.mjs) explicitly includes both entrypoints; its self-test covers valid and broken links relative to a nested Skill directory. Skill frontmatter is checked with the local skill-creator validator during authoring, not by a new project dependency.

## Alternatives considered

- Keep only the general documents: leaves these two requested workflows without precise task descriptions and callable entrypoints.
- Copy the reference Skills verbatim: would require nonexistent `change-scope`, snapshot, coverage and stack workflows, and imply delivery actions beyond verification.
- Copy the validation matrix into each Skill or create another wrapper script: rejected because the current documents and executable checks already own that information and behavior.
- Add routers, global installation, UI metadata, new dependencies or subagent infrastructure: unnecessary for two short repository-local entrypoints.

## Consequences

The original [engineering guidance decision](2026-10-21-engineering-guidance.md) continues to own document layering. These Skills add execution steps while preserving that single source of policy. Descriptions provide discovery metadata and the root links make the files reachable. Automatic selection in a fresh Agent session remains unverified.

## Verification

The skill-creator `quick_validate.py` passes for both directories. `pnpm run check:docs` passes across 19 documents, including both Skills. `node scripts/check-agent-docs.mjs --self-test` passes seven rejection cases, including a broken nested Skill link; its positive counterpart resolves a valid `../../../docs/` path and heading. The scoped Vite+ check passes formatting, lint and type checks for the eight task files; `git diff --check` passes. Verification is limited to this guidance/checker change, not the unrelated product worktree changes.

Manual walkthroughs of the written workflows:

| Request/scenario                                       | Observed workflow outcome                                                                                                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review a deletion fix without editing                  | `cpl-code-review` resolves the intended diff, traces direct and alternate callers to the mutation and current safety rules, and reports trigger/impact/evidence without a fix or remote comment.               |
| Verify this documentation-only handoff, no commit/push | `cpl-verify` selects documentation/checker validation, runs it on task files, preserves unrelated work and ends with evidence rather than Git delivery. The checks above execute that selection.               |
| Verify a shared RPC change                             | The workflow follows the matrix to affected domain/RPC/browser consumers and distinguishes local protocol tests from browser/artifact acceptance. No duplicate command list is maintained in the Skill.        |
| A whole-worktree check fails in an unrelated file      | The workflow keeps that failure visible, preserves the file and labels any scoped pass as scoped; it cannot claim the whole tree passes. This is a conditional walkthrough, not a new whole-worktree test run. |
| Review a PR whose live base/head is unavailable        | The review uses available local evidence and labels the remote comparison unverified. Missing remote/browser access is not converted into a pass or a request to mutate production state.                      |

Both workflows return check results to an already-running review rather than recursively starting verification/review again. These walkthroughs assess routing, scope, check selection and action authority; they are not proof of automatic selection in a fresh Agent or live remote/browser behavior. Full product tests, builds, packaging and live integrations are not run for this Skill-only change.
