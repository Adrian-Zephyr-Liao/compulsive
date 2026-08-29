# Compulsive

English · [简体中文](./README.zh-CN.md)

**Your repository home for the AI era.**

AI has changed how software is built. One developer can now explore more frameworks, run more
experiments, and maintain more agent-generated projects than ever before. The bottleneck is no
longer creating a repository—it is remembering where every repository lives, finding it again, and
keeping related projects organized without duplicating or losing work.

Compulsive is a macOS-first local Git repository manager. Its `cpl` command gives every repository
a predictable canonical home, makes the entire collection searchable, and lets multiple Workspaces
reuse the same repository through links or isolated Git worktrees.

## Highlights

- Classify remote repositories as `<host>/<owner...>/<repo>`.
- Keep repositories without a remote under `local/<repo>`.
- Discover and register existing repositories without moving them unexpectedly.
- Preview every move and protect dirty repositories, nested repositories, and occupied targets.
- Search repositories and Workspaces from scripts or an interactive terminal picker.
- Reuse one canonical repository across multiple Workspaces without duplicate clones.
- Copy a safely quoted `cd -- 'path'` command after clone, navigation, or organization.

## Install

```bash
npm install --global @adrian-zephyr/compulsive
cpl init
```

Use a custom managed root during first initialization:

```bash
cpl init --root /Users/your-name/Code
```

Initialization is idempotent. Running it again does not replace the existing root or repository
index.

## Quick start

```bash
cpl clone https://github.com/vuejs/core.git
cpl add /Users/your-name/Projects/my-local-tool
cpl scan /Users/your-name/Projects
cpl scan /Users/your-name/Projects --register
cpl list
cpl search core
cpl go core
cpl organize my-local-tool --dry-run
cpl organize my-local-tool --yes
cpl doctor
```

Run `cpl` without a command in an interactive terminal to open a searchable repository and
Workspace picker.

## Directory model

Remote repositories are classified by host, owner path, and repository name:

```text
/Users/your-name/Code/github.com/vuejs/core
/Users/your-name/Code/gitlab.com/group/subgroup/project
```

Repositories without an `origin` remote use the logical classification `local/<repository>` and
stay in their existing location until `cpl organize` is explicitly confirmed.

`clone`, `go`, and a completed `organize` copy a safely quoted `cd -- 'path'` command to the macOS
clipboard and print it. Clipboard failures are warnings and never turn a successful Git operation
into a failure.

## Search and migration

`scan` is read-only unless `--register` is present. Scan results include only newly discovered,
unregistered repositories, so rerunning a scan after migration does not list repositories that are
already organized. `forget` removes only the index entry and never deletes repository files.

To migrate a directory containing existing repositories, register the discoveries, preview every
target, and then confirm the batch:

```bash
cpl scan /Users/your-name/Projects --register
cpl organize --all --dry-run
cpl organize --all --yes
```

`organize --all` rereads each repository's current `origin` before planning, but outputs only
repositories whose canonical target has changed. A repository registered under `local/` is
automatically promoted to `github.com/...` after an `origin` is added. The dry run does not update
the index; classification changes are persisted only after the confirmed move succeeds. All
repositories are still preflighted, so a target conflict stops the batch before the first move.

## Workspaces

A Workspace groups related projects without changing their canonical storage locations. The
default Workspace root is a sibling of the repository root—for example,
`/Users/your-name/Workspaces` next to `/Users/your-name/Code`.

Link mode is the default. Multiple Workspaces can share the same checkout, current branch,
uncommitted changes, and build files:

```bash
cpl workspace create Product
cpl workspace create Platform
cpl workspace add Product api
cpl workspace add Platform api --alias shared-api
cpl workspace list
cpl workspace go Product
cpl search shared --workspace Platform
```

Use a Git worktree when a Workspace needs an isolated branch and working directory:

```bash
cpl workspace add Product web \
  --worktree \
  --branch feature/product-web \
  --create-branch
```

Common maintenance commands:

```bash
cpl workspace sync Product
cpl workspace remove Product api --yes
cpl workspace delete Product --yes
```

Workspace removal deletes only exact Compulsive-managed links or clean worktrees. It never deletes
the canonical repository or unrelated files inside a Workspace.

## Configuration

Compulsive keeps one persistent local configuration, managed through the CLI:

```bash
cpl config show
cpl config set-root /Users/your-name/Code
cpl config set-workspace-root /Users/your-name/Workspaces
cpl config add-scan-root /Users/your-name/Projects
cpl config remove-scan-root /Users/your-name/Projects
```

On macOS, `config.json` and repository state live under
`/Users/your-name/Library/Application Support/compulsive`. Set `CPL_HOME` to override the
application-data directory for isolated automation and tests.

## Terminal and automation

Human-readable output uses compact cards, status symbols, color-aware diagnostics, searchable
selection, confirmation prompts, and spinners. Colors automatically disable outside a TTY and
respect `NO_COLOR`; use `--color` or `--no-color` to override them.

Commands that support `--json` write one JSON value to stdout and diagnostics to stderr, without
prompts, spinners, or ANSI codes.

| Exit code | Meaning                                 |
| --------- | --------------------------------------- |
| `0`       | Success                                 |
| `2`       | Invalid input, remote, or configuration |
| `3`       | Repository not found                    |
| `4`       | Ambiguous match or path conflict        |
| `5`       | Git or filesystem failure               |

The CLI stays lightweight: `mri` handles argument parsing, `picocolors` handles ANSI styling, and
`@clack/prompts` provides interactive controls.

## Library API

```ts
import { createRepositoryManager } from "@adrian-zephyr/compulsive";

const manager = createRepositoryManager();
await manager.initialize({ rootDir: "/Users/your-name/Code" });

const repository = await manager.clone({
  remote: "git@github.com:vuejs/core.git",
});

console.log(repository.absolutePath);
```

The package publishes ESM and CommonJS entry points with TypeScript declarations. Public operations
throw `CompulsiveError`, whose `code` is stable and machine-readable.

## Safety model

- Git is launched with argument arrays, never interpolated shell commands.
- Credentials are removed before remote information reaches the index.
- Scanning does not descend into repositories, heavy build outputs, or symbolic links.
- Organization refuses occupied, nested, stale, and cross-volume targets.
- A moved repository is revalidated before its index path changes.
- Workspace links follow organized repositories and refuse to overwrite user content.
- `forget`, Workspace removal, and repository organization never delete canonical repositories.

## Development

Compulsive uses [Vite+](https://viteplus.dev/):

```bash
vp install
vp check
vp test --run
vp pack --dts --publint --attw
```

## License

MIT
