# Compulsive

Compulsive is a macOS-first Git repository organizer. It provides the `cpl` command and a reusable TypeScript API for cloning repositories into predictable paths, registering existing local repositories, finding them later, and moving them safely into a managed source directory.

## Install

```bash
npm install --global @adrian-zephyr/compulsive
cpl init
```

The default managed root is `~/Desktop/源码`. Override it during first initialization:

```bash
cpl init --root ~/Desktop/Source
```

Initialization is idempotent. Running it again does not replace the existing root or repository index.

## Directory rules

Remote repositories are classified by host, owner path, and repository name:

```text
~/Desktop/源码/github.com/vuejs/core
~/Desktop/源码/gitlab.com/group/subgroup/project
```

Repositories without an `origin` remote use the logical classification `local/<repository>` and stay in their existing location until `cpl organize` is explicitly confirmed.

## Commands

```bash
cpl clone https://github.com/vuejs/core.git
cpl add ~/Projects/my-local-tool
cpl scan ~/Projects
cpl scan ~/Projects --register
cpl list
cpl list core --json
cpl go core
cpl organize my-local-tool --dry-run
cpl organize my-local-tool --yes
cpl forget my-local-tool --yes
cpl doctor
```

`clone`, `go`, and a completed `organize` copy a safely quoted `cd -- 'path'` command to the macOS clipboard and print it. Paste and press Enter to enter the repository. Clipboard failures are warnings and never turn a successful Git operation into a failure.

`scan` is read-only unless `--register` is present. `forget` removes only the index entry and never deletes repository files.

### Configuration

Compulsive supports an unbuild-style project configuration. Create `compulsive.config.ts` in the
directory where you run `cpl`:

```ts
export default {
  rootDir: "~/Desktop/源码",
  scanRoots: ["~/Documents/Projects"],
  ui: {
    color: "auto", // auto | always | never
    unicode: true,
  },
};
```

TypeScript, JavaScript, JSON, and JSONC configuration files are loaded by `c12`. If Compulsive is
also installed as a project dependency, use the typed helper for editor completion:

```ts
import { defineConfig } from "@adrian-zephyr/compulsive";

export default defineConfig({
  rootDir: "~/Desktop/源码",
  scanRoots: ["~/Documents/Projects"],
  ui: { color: "auto", unicode: true },
});
```

Use an explicit file from any directory with `cpl --config <path> <command>`. `cpl config file`
prints the active file. The file supplies defaults for first initialization and terminal styling; it
does not silently rewrite an already initialized repository index. `--root`, `--color`, and
`--no-color` take precedence where applicable.

Only use trusted TypeScript or JavaScript configuration files because Node.js executes them. Prefer
`compulsive.config.jsonc` when an executable configuration is unnecessary.

Persistent settings can still be managed directly:

```bash
cpl config show
cpl config file
cpl config set-root ~/Desktop/源码
cpl config add-scan-root ~/Projects
cpl config remove-scan-root ~/Projects
```

State is stored in `~/Library/Application Support/compulsive` on macOS. Set `CPL_HOME` to override the application-data directory, which is useful for isolated automation and tests.

### Terminal experience

Human-readable output uses compact repository cards, status symbols, color-aware diagnostics,
interactive selection, confirmation prompts, and spinners. Colors automatically disable outside a
TTY and respect `NO_COLOR`; use `--color` or `--no-color` to override them. `--json` remains plain,
single-value structured output without prompts, spinners, or ANSI codes.

The CLI keeps its runtime small by using focused packages: `mri` for argument parsing,
`picocolors` for ANSI styling, `@clack/prompts` for interaction, and `c12` for modern configuration
loading.

### Structured output and exit codes

Commands that support `--json` write one JSON value to stdout and diagnostics to stderr.

| Exit code | Meaning                                 |
| --------- | --------------------------------------- |
| `0`       | Success                                 |
| `2`       | Invalid input, remote, or configuration |
| `3`       | Repository not found                    |
| `4`       | Ambiguous match or path conflict        |
| `5`       | Git or filesystem failure               |

## Library API

```ts
import { createRepositoryManager } from "@adrian-zephyr/compulsive";

const manager = createRepositoryManager();
await manager.initialize();

const repository = await manager.clone({
  remote: "git@github.com:vuejs/core.git",
});

console.log(repository.absolutePath);
```

The package publishes ESM and CommonJS entry points with TypeScript declarations. Public operations throw `CompulsiveError`, whose `code` is stable and machine-readable.

## Safety model

- Git is launched with argument arrays, never interpolated shell commands.
- Credentials are removed before remote information reaches the index.
- Scanning does not descend into repositories, `node_modules`, build outputs, or symlinks.
- Organize refuses occupied, nested, stale, and cross-volume targets.
- A move is verified as a Git repository before the index path changes.
- No command deletes a repository directory.

## Development

Compulsive uses Vite+:

```bash
vp install
vp check
vp test --run
vp pack --publint --attw
```

## License

MIT
