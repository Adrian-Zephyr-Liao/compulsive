import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, realpath, readdir } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

import { redactGitError } from "./git.js";
import type { RepositoryRecord, WorkspaceRecord } from "./types.js";
import type {
  WorktreeAuditItem,
  WorktreeAuditOptions,
  WorktreeAuditReport,
} from "./worktree-audit-types.js";

const execute = promisify(execFile);
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function git(path: string, args: string[], signal?: AbortSignal): Promise<string> {
  try {
    const result = await execute("git", args, {
      cwd: path,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15_000,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
      ...(signal ? { signal } : {}),
    });
    return result.stdout;
  } catch (error) {
    throw new Error(redactGitError(String(error)));
  }
}

interface GitWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  locked: string | null;
  prunable: string | null;
}

export function parseWorktreeList(output: string): GitWorktree[] {
  return output
    .split("\0\0")
    .filter(Boolean)
    .map((record) => {
      const fields = new Map(
        record
          .split("\0")
          .filter(Boolean)
          .map((field) => {
            const space = field.indexOf(" ");
            return space < 0 ? [field, ""] : [field.slice(0, space), field.slice(space + 1)];
          }),
      );
      const path = fields.get("worktree");
      if (!path || !isAbsolute(path)) throw new Error("Invalid Git worktree path.");
      return {
        path,
        head: fields.get("HEAD") ?? null,
        branch: fields.get("branch")?.replace(/^refs\/heads\//, "") ?? null,
        locked: fields.get("locked") ?? null,
        prunable: fields.get("prunable") ?? null,
      };
    });
}

export function parseWorktreeChanges(output: string): WorktreeAuditItem["changes"] {
  const fields = output.split("\0");
  const changes: WorktreeAuditItem["changes"] = [];
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) continue;
    if (field.length < 4 || field[2] !== " ") throw new Error("Invalid Git status record.");
    const status = field.slice(0, 2);
    const change: WorktreeAuditItem["changes"][number] = { status, path: field.slice(3) };
    if (/[RC]/.test(status)) {
      const from = fields[++i];
      if (!from) throw new Error("Missing Git rename source.");
      change.from = from;
    }
    changes.push(change);
  }
  return changes;
}

async function identity(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return resolve(path);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return false;
  }
}

async function commonDirectory(path: string, signal?: AbortSignal): Promise<string> {
  const common = (await git(path, ["rev-parse", "--git-common-dir"], signal)).trim();
  return realpath(resolve(path, common));
}

async function inspect(item: WorktreeAuditItem, signal?: AbortSignal): Promise<void> {
  const entry = await lstat(item.path);
  item.exists = true;
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (await realpath(item.path)) !== resolve(item.path)
  ) {
    item.risks.push("symlink");
    throw new Error("Not a regular worktree directory; no symlink traversal was attempted.");
  }
  const top = (await git(item.path, ["rev-parse", "--show-toplevel"], signal)).trim();
  if (
    (await realpath(top)) !== (await realpath(item.path)) ||
    (await commonDirectory(item.path, signal)) !== item.commonDirectory
  ) {
    throw new Error("Git worktree identity does not match the registered repository.");
  }
  item.changes = parseWorktreeChanges(
    await git(item.path, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], signal),
  );
  // shortcut: Summarize ignored directories to avoid enumerating node_modules; inspect contents before removal.
  const ignored = await git(
    item.path,
    ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
    signal,
  );
  item.changes.push(
    ...ignored
      .split("\0")
      .filter(Boolean)
      .map((path) => ({ status: "!!", path })),
  );
  if (item.changes.some(({ status }) => status === "??")) item.risks.push("untracked");
  if (item.changes.some(({ status }) => status === "!!")) item.risks.push("ignored-files");
  if (item.changes.some(({ status }) => status !== "??" && status !== "!!"))
    item.risks.push("dirty");
  if (item.changes.some(({ status }) => /^(DD|AU|UD|UA|DU|AA|UU)$/.test(status)))
    item.risks.push("conflicts");
  const admin = (await git(item.path, ["rev-parse", "--absolute-git-dir"], signal)).trim();
  for (const name of [
    "MERGE_HEAD",
    "rebase-merge",
    "rebase-apply",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
  ]) {
    if (await exists(join(admin, name))) item.operations.push(name);
  }
  if (item.operations.length) item.risks.push("in-progress");
  item.head = (await git(item.path, ["rev-parse", "HEAD"], signal)).trim();
  item.branch = (await git(item.path, ["branch", "--show-current"], signal)).trim() || null;
  const upstreamInfo = item.branch
    ? (
        await git(
          item.path,
          [
            "for-each-ref",
            "--format=%(upstream:short)%09%(upstream:track)",
            `refs/heads/${item.branch}`,
          ],
          signal,
        )
      ).trim()
    : "";
  const [upstream, tracking] = upstreamInfo.split("\t");
  item.upstream = upstream || null;
  if (tracking === "[gone]") item.risks.push("missing-upstream");
  else if (upstream) {
    item.ahead = Number(
      (await git(item.path, ["rev-list", "--count", `${upstream}..HEAD`], signal)).trim(),
    );
  }
  item.unpublished = Number(
    (await git(item.path, ["rev-list", "--count", "HEAD", "--not", "--remotes"], signal)).trim(),
  );
  if ((item.ahead ?? 0) > 0 || item.unpublished > 0) item.risks.push("unpublished");
  if (!upstream) item.risks.push("no-upstream");
  if (
    !item.branch &&
    !(
      await git(
        item.path,
        ["for-each-ref", "--contains", "HEAD", "--format=%(refname)", "refs/heads", "refs/tags"],
        signal,
      )
    ).trim()
  ) {
    item.risks.push("detached-unprotected");
  }
}

export async function scanWorktrees(
  repositories: RepositoryRecord[],
  workspaces: WorkspaceRecord[],
  options: WorktreeAuditOptions & { worktreePath?: string } = {},
): Promise<WorktreeAuditReport> {
  const managed = repositories.filter((repository) => repository.isManaged);
  const report: WorktreeAuditReport = {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    checkedAt: "",
    complete: false,
    cancelled: false,
    repositoryTotal: managed.length,
    repositoriesScanned: 0,
    items: [],
    errors: [],
  };
  const references = new Map<string, string[]>();
  for (const workspace of workspaces) {
    for (const member of workspace.members) {
      for (const path of [
        join(workspace.absolutePath, member.alias),
        ...(member.mode === "worktree" ? [member.worktreePath] : []),
      ]) {
        try {
          const key = await identity(path);
          const names = references.get(key) ?? [];
          const name = `${workspace.name}/${member.alias}`;
          if (!names.includes(name)) names.push(name);
          references.set(key, names);
        } catch (error) {
          report.errors.push({ repository: path, message: String(error) });
        }
      }
    }
  }
  const seen = new Set<string>();
  options.onProgress?.(0, managed.length);
  // Keep Git I/O bounded; cancellation stops starting additional repositories.
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, managed.length) }, async () => {
      while (!options.signal?.aborted) {
        const repository = managed[next++];
        if (!repository) break;
        try {
          const common = await commonDirectory(repository.absolutePath, options.signal);
          if (seen.has(common)) continue;
          seen.add(common);
          const registered = parseWorktreeList(
            await git(
              repository.absolutePath,
              ["worktree", "list", "--porcelain", "-z"],
              options.signal,
            ),
          );
          const primary = registered[0];
          if (!primary) throw new Error("Git returned no primary worktree.");
          const root = join(primary.path, ".worktrees");
          const candidates = registered.slice(1);
          if (await exists(root)) {
            const rootEntry = await lstat(root);
            if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) {
              report.errors.push({
                repository: root,
                message: "The .worktrees root is not a regular directory; disk scan skipped.",
              });
            } else {
              for (const entry of await readdir(root, { withFileTypes: true })) {
                const path = join(root, entry.name);
                if (
                  (entry.isDirectory() || entry.isSymbolicLink()) &&
                  !candidates.some((candidate) => resolve(candidate.path) === resolve(path))
                ) {
                  candidates.push({ path, head: null, branch: null, locked: null, prunable: null });
                }
              }
            }
          }
          for (const candidate of candidates) {
            if (options.signal?.aborted) break;
            if (options.worktreePath && resolve(candidate.path) !== resolve(options.worktreePath))
              continue;
            const refs = references.get(await identity(candidate.path)) ?? [];
            const registeredPath = registered.some(({ path }) => path === candidate.path);
            const item: WorktreeAuditItem = {
              ...candidate,
              id: hash([common, candidate.path]),
              repositoryId: repository.id,
              repositoryName: repository.name,
              repositoryPath: repository.absolutePath,
              commonDirectory: common,
              category: refs.length
                ? "referenced"
                : !registeredPath
                  ? "unregistered"
                  : resolve(candidate.path).startsWith(`${resolve(root)}/`)
                    ? "unreferenced"
                    : "external",
              references: refs,
              exists: null,
              upstream: null,
              ahead: null,
              unpublished: null,
              risks: [],
              operations: [],
              changes: [],
              error: null,
              fingerprint: "",
              ignored: false,
            };
            if (candidate.locked !== null) item.risks.push("locked");
            try {
              if (!(await exists(item.path))) {
                item.exists = false;
                item.category = "missing";
                item.risks.push("missing");
              } else {
                await inspect(item, options.signal);
              }
            } catch (error) {
              item.error = String(error);
              item.risks.push("unknown");
            }
            // Include file metadata so a new edit with the same porcelain status resurfaces ignored findings.
            const metadata: Array<number[] | null> = [];
            for (
              let offset = 0;
              offset < item.changes.length && !options.signal?.aborted;
              offset += 64
            ) {
              metadata.push(
                ...(await Promise.all(
                  item.changes.slice(offset, offset + 64).map(async (change) => {
                    try {
                      const stat = await lstat(join(item.path, change.path));
                      return [stat.size, stat.mtimeMs, stat.ctimeMs];
                    } catch {
                      return null;
                    }
                  }),
                )),
              );
            }
            item.fingerprint = hash([
              item.head,
              item.branch,
              item.category,
              refs,
              item.risks,
              item.changes,
              metadata,
              item.upstream,
              item.ahead,
              item.unpublished,
              item.locked,
              item.prunable,
              item.error,
            ]);
            report.items.push(item);
          }
        } catch (error) {
          if (!options.signal?.aborted)
            report.errors.push({ repository: repository.absolutePath, message: String(error) });
        } finally {
          report.repositoriesScanned++;
          options.onProgress?.(report.repositoriesScanned, managed.length);
        }
      }
    }),
  );
  report.cancelled = options.signal?.aborted ?? false;
  report.complete =
    !report.cancelled && report.errors.length === 0 && !report.items.some(({ error }) => error);
  report.checkedAt = new Date().toISOString();
  report.items.sort((a, b) => a.path.localeCompare(b.path));
  return report;
}

export async function validateAuditPath(
  item: WorktreeAuditItem,
  repositories: RepositoryRecord[],
): Promise<string> {
  const repository = repositories.find(({ id }) => id === item.repositoryId);
  if (
    !repository?.isManaged ||
    (await commonDirectory(repository.absolutePath)) !== item.commonDirectory
  ) {
    throw new Error("The repository identity changed. Run the audit again.");
  }
  const registered = parseWorktreeList(
    await git(repository.absolutePath, ["worktree", "list", "--porcelain", "-z"]),
  );
  if (!registered.slice(1).some(({ path }) => path === item.path)) {
    throw new Error("The worktree is no longer registered. Open its parent repository manually.");
  }
  const entry = await lstat(item.path);
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (await realpath(item.path)) !== resolve(item.path) ||
    (await commonDirectory(item.path)) !== item.commonDirectory
  ) {
    throw new Error("The worktree path changed. Run the audit again.");
  }
  return item.path;
}
