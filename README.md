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

```bash
cpl config show
cpl config set-root ~/Desktop/源码
cpl config add-scan-root ~/Projects
cpl config remove-scan-root ~/Projects
```

State is stored in `~/Library/Application Support/compulsive` on macOS. Set `CPL_HOME` to override the application-data directory, which is useful for isolated automation and tests.

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
