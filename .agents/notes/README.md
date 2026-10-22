# Agent Notes

An Agent Note records a decision's rationale and trade-offs. No ADR/Notes system existed in this checkout before this policy. Notes complement the [architecture](../../docs/architecture.md) and [development workflow](../../docs/development.md); current behavior stays with its owning document.

## When to write

Add or update a Note for a change to architecture/ownership, shared CLI/RPC/library contracts, on-disk formats, destructive-operation guarantees, or an engineering/validation policy a maintainer may revisit. A non-obvious defect fix with a durable trade-off qualifies. Routine fixes restoring an existing contract, tests, copy, formatting and local refactors do not automatically need a Note.

Search existing Notes first. Update the owning Note's factual paths and verification when its decision remains valid. A reversal gets a new Note cross-linked with the old one; preserve the rationale and mark the old Note `superseded`. Proposals are not instructions or implementation evidence.

## Format and status

Use a flat `YYYY-MM-DD-short-topic.md` filename; no lifecycle/class directory tree or translated triplet is required. The header is:

```markdown
# Agent Note: Descriptive title

Status: proposed
```

Follow with these headings: `## Problem`, `## Decision`, `## Alternatives considered`, `## Consequences`, `## Verification`. Record only alternatives actually evaluated. Verification states what must be tested and separates observed outcomes from unrun checks or unresolved gaps.

- `proposed`: describes a pending choice, acceptance and risks; do not present it as implemented.
- `implemented`: the decision is realized in the current files; name remaining limitations. Local implementation does not imply release or deployment.
- `rejected`: retain the reason only while it prevents a plausible repeated mistake.
- `superseded`: link the replacement; this is historical evidence, not current authority.

Keep one status line. On transition update status, tense and verification together. There is no frozen archive or central index: search this small directory. Do not copy historical notes from another project. `pnpm run check:docs` validates the filename, header, status, required headings and links; review determines whether the decision itself is accurate.
