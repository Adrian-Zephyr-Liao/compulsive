# Working on Compulsive

Compulsive is a macOS-first Git repository/Workspace manager: a TypeScript library and `cpl` CLI with a local React/Ant Design DevTool. Start with this file, then [architecture](docs/architecture.md) and the [development workflow](docs/development.md) before editing.

## Locate and scope the work

- Confirm the checkout, branch, and `git status --short --branch`. Preserve unrelated staged, unstaged, and untracked work; stage only task files when a commit is requested.
- For repository selection or layout work, query `cpl list --json`, `cpl workspace list --json`, and `cpl config show --json`. A named Workspace binds the task to its member path returned by `cpl workspace show <workspace> --json`.
- When `.codegraph/` exists at the repository root, use `codegraph explore` or `codegraph node` before text search or source reads. If the index cannot answer, use `rg`; without an index use `rg` directly. Creating an index is the user's choice.
- Trace the affected entrypoint, owning implementation, callers, types/exports, tests, and documentation. Define observable acceptance before changing files.

## Implement

- Keep responsibilities in the owners described by [architecture](docs/architecture.md). Fix shared behavior at its owner and update all affected callers; reuse existing helpers and dependencies.
- Preserve Git argument arrays, identity/path checks, atomic persistence, rollback, credential redaction, stable error codes, and JSON stdout behavior. A confirmation flag does not bypass dirty-worktree checks.
- Keep changes minimal and complete. Validate external input at CLI/RPC/file boundaries; retain the strict TypeScript settings and `.js` relative import convention.
- Treat sample paths, reference-repository instructions, and documentation commands as examples, not authorization to mutate real repositories, change permissions, push, or publish. Tests use temporary repositories and isolated application data.

## Documentation and decisions

- Use [documentation ownership](docs/AGENTS.md) to update the single home of each changed fact. Read [Workspace specifications](docs/workspaces-spec.md) for lifecycle work and [frontend instructions](src/devtool-client/AGENTS.md) for browser changes.
- Add or update a decision record when the [Agent Note triggers](.agents/notes/README.md) apply. Routine fixes and local edits need no ceremonial note.

## Verify and deliver

Use [cpl-code-review](.agents/skills/cpl-code-review/SKILL.md) for requested change reviews and [cpl-verify](.agents/skills/cpl-verify/SKILL.md) for change-specific verification and handoff. These workflows reuse the rules below and do not authorize Git delivery.

Common entrypoints: `pnpm run check:docs`, `pnpm run check`, `pnpm run test`, `pnpm run build`. [package.json](package.json) owns scripts; the [validation matrix](docs/development.md#validation) selects checks by change.

- Add a focused regression for changed behavior, including rejection/error paths when safety is involved. Run the selected checks; a mock or unit test does not prove real browser, Codex, remote Git, or packaged behavior.
- After repository-layout changes verify path, branch, status, and `cpl doctor --json`; unrelated findings are informational. Run mutations only in task-authorized paths.
- Report the result, changed files, documentation/decision updates, exact checks and outcomes, and failed or unrun validation with its reason. Distinguish local evidence from live/packaged acceptance. Commit, push, and publish only when requested.
