# Agent Note: Project-specific coding Agent guidance

Status: implemented

## Problem

The project has Workspace specifications, a completed implementation plan, frontend conventions and an Ant Design Skill, but no root Agent entrypoint, engineering decision policy or documentation check. A first-time Agent must otherwise infer the ownership and validation sequence. The Workspace spec also contradicts the current full-directory deletion implementation and regression test.

## Decision

Use a short root instruction file, task-triggered architecture/development documentation, subtree pointers for frontend work, and a flat Notes directory. Keep existing safety and frontend rules. `check:docs` runs independently and before Vite+ in the existing `check` script. The Workspace specification follows `deleteWorkspace` and the test named `deletes the workspace directory while preserving the canonical repository`; this migration does not change runtime behavior.

### Migration source and mapping

Source: local reference checkout `/Users/liaowenrun/Desktop/Code/github.com/deepseek-ai/deepseek-harness`, commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (local HEAD inspected on 2026-10-21; no fetch). Reference files are migration material, not instructions granting permission to operate on this project or machine.

| Reference mechanism                                                                                                                                 | CPL home                                                                                              | Treatment and reason                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Root and subtree `AGENTS.md`                                                                                                                        | [Root](../../AGENTS.md), [docs](../../docs/AGENTS.md), [frontend](../../src/devtool-client/AGENTS.md) | Adapt. Root stays short; subtree files cover actual responsibilities without another rule for every folder.                                                  |
| `docs/architecture.md`, `docs/development.md`, `docs/testing.md`                                                                                    | [Architecture](../../docs/architecture.md), [development](../../docs/development.md)                  | Adapt. One package, existing Vite+/Vitest scripts and macOS integrations determine boundaries and checks.                                                    |
| `.agents/notes/README.md` and lifecycle instructions                                                                                                | [Note policy](README.md)                                                                              | Adapt. Flat filenames and four statuses fit this small repository; only decisions with durable trade-offs need a record.                                     |
| `dsh-pre-push-checks`, `dsh-doc-standards`, `dsh-prose-standard`                                                                                    | [Validation](../../docs/development.md#validation) and [document ownership](../../docs/AGENTS.md)     | Retain policy in these documents; the [review/verification Skills](2026-10-21-review-verification-skills.md) orchestrate it without copying the rules.       |
| Existing reusable workflow                                                                                                                          | [Ant Design Skill](../skills/antd/SKILL.md)                                                           | Retain. It already covers this project's actual component stack; do not duplicate it.                                                                        |
| Markdown/Note gates and `scripts/run-gates.ts`                                                                                                      | [check-agent-docs.mjs](../../scripts/check-agent-docs.mjs), [package scripts](../../package.json)     | Adapt only links, script names and Note format, with rejection self-tests. No scheduler, catalog generation or external dependencies.                        |
| `.github/workflows/ci.yml`, `docs-pages.yml`                                                                                                        | Existing `check` entrypoint                                                                           | Do not copy hosted CI infrastructure. This checkout has no CI workflows; the new check is locally executable.                                                |
| Cordis/plugin seams, `@deepseek-ai/dsh-*`, generated catalogs, dual SDKs                                                                            | None                                                                                                  | DeepSeek-specific; CPL has a manager/domain/adapters layout and one public package.                                                                          |
| Full bilingual pairing, frozen archive triplets, per-file 100% coverage, prerelease format rejection, sandbox escalation and stack/merge procedures | None                                                                                                  | No corresponding target mechanism or need. Preserve the existing paired user READMEs and existing compatibility checks; references grant no new permissions. |

## Alternatives considered

- Copy the reference instruction tree and its Skills/check infrastructure: rejected because package topology, release policy and tooling differ, and historical records are not CPL decisions.
- Add a separate ADR hierarchy: rejected because no ADR system exists here; one flat Notes directory preserves rationale with less navigation and machinery.
- Document guidance without an executed check: rejected because missing references, stale script names and malformed records are cheap to detect with Node's standard library.
- Require a Note for every non-trivial patch: narrowed to durable decisions so restoring documented behavior and routine edits do not create duplicate rationale.

## Consequences

The root routes an Agent to current owners instead of maintaining an exhaustive module/test catalog in context. The existing Ant Design Skill remains the reusable component workflow. The checker is intentionally limited to inline Markdown links, documented package script names and Note structure; architecture/prose accuracy still needs review. Existing uncommitted product changes are outside this migration and are not release evidence. Product behavior, dependencies, repository layout and permissions are unchanged by the guidance.

## Verification

The [three walkthroughs](../../docs/development.md#three-task-walkthroughs) trace defect repair, a new Workspace action and a documentation-only edit through reading, implementation, verification and the Note trigger. They are reviews, not claims that those example features were implemented.

`node scripts/check-agent-docs.mjs --self-test` passes and rejects six invalid examples: missing files, missing anchors, unknown scripts, bad status, missing sections and sections present only inside a fenced example. `pnpm run check:docs` passes on the 13 guidance/documents. The scoped Vite+ check of those 13 changed files passes formatting, lint and type checks. The two focused Workspace tests for deleting the whole directory while preserving the canonical repository, and refusing a nested registered Workspace, pass (26 other tests in that file are not selected).

Full `pnpm run check` runs the documentation check successfully, then stops on an existing formatting issue in the unrelated, uncommitted `src/worktree-audit.ts`. That file is left untouched. This migration does not run the full product suite, build, packaging, real browser or live remote/Codex acceptance; no product behavior changes require those checks here. The [walkthroughs](../../docs/development.md#three-task-walkthroughs) are a completed manual policy review, not execution of the example feature or defect.
