import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, rm, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { discoverRepositoryRoots } from "./discovery.js";
import { CompulsiveError } from "./errors.js";
import { runGit } from "./git.js";
import type { StoragePaths } from "./storage.js";
import type { RepositoryManager } from "./types.js";
import { parseWorktreeList, scanWorktrees, validateAuditPath } from "./worktree-audit.js";
import { detachWorktreeReferences, findWorktreeReferences } from "./worktree-removal-references.js";
import type {
  WorktreeRemovalInput,
  WorktreeRemovalPlan,
  WorktreeRemovalResult,
} from "./worktree-audit-types.js";

function contains(parent: string, path: string): boolean {
  const location = relative(resolve(parent), resolve(path));
  return (
    location === "" ||
    (location !== ".." && !location.startsWith(`..${sep}`) && !isAbsolute(location))
  );
}

async function physical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(path);
    throw error;
  }
}

async function pathEntry(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function previewWorktreeRemoval(
  manager: RepositoryManager,
  id: string,
): Promise<WorktreeRemovalPlan> {
  const cached = (await manager.getWorktreeAudit())?.items.find((item) => item.id === id);
  if (!cached)
    throw new CompulsiveError("NOT_FOUND", "Audit finding not found. Run the audit again.");
  const [repositories, workspaces, config] = await Promise.all([
    manager.search(),
    manager.searchWorkspaces(),
    manager.getConfig(),
  ]);
  const repository = repositories.find((record) => record.id === cached.repositoryId);
  if (!repository?.isManaged)
    throw new CompulsiveError("CONFLICT", "The repository is no longer managed.");
  const current = await scanWorktrees([repository], workspaces, { worktreePath: cached.path });
  const item = current.items.find((item) => item.id === id);
  if (!item || current.errors.length)
    throw new CompulsiveError("CONFLICT", "Unable to verify this worktree. Run the audit again.");
  const registered = parseWorktreeList(
    (await runGit(["worktree", "list", "--porcelain", "-z"], { cwd: repository.absolutePath }))
      .stdout,
  );
  const primary = registered[0];
  if (!primary) throw new CompulsiveError("CONFLICT", "Git did not identify its primary worktree.");
  const entry = await pathEntry(item.path);
  const blockers: string[] = [];
  const forceReasons = item.risks.filter(
    (risk) => !["unpublished", "no-upstream", "missing-upstream", "ignored-files"].includes(risk),
  );
  if (item.references.length) forceReasons.push("referenced");
  if (item.category === "missing" || item.category === "unregistered")
    forceReasons.push(item.category);
  if (item.error || item.exists !== true) forceReasons.push("unknown");
  const protectedPaths = [
    sep,
    homedir(),
    config.rootDir,
    config.workspaceRoot,
    primary.path,
    "/System",
    "/Library",
    "/Applications",
    "/Users",
    "/Volumes",
    "/usr",
    "/bin",
    "/sbin",
    "/etc",
    "/var",
    "/private",
    "/tmp",
    ...repositories.map((record) => record.absolutePath),
    ...workspaces.map((workspace) => workspace.absolutePath),
  ];
  const resolvedPaths = await Promise.all(protectedPaths.map(physical));
  if (
    protectedPaths.some((path) => contains(item.path, path)) ||
    resolvedPaths.some((path) => contains(item.path, path)) ||
    contains(item.path, item.commonDirectory) ||
    contains(item.commonDirectory, item.path)
  )
    blockers.push("protected-path");
  // A force confirmation never authorizes traversal through a replaced parent symlink.
  if ((await physical(dirname(item.path))) !== resolve(dirname(item.path)))
    blockers.push("identity-changed");
  const isRegistered = registered.slice(1).some((worktree) => worktree.path === item.path);
  if (
    !isRegistered &&
    (dirname(resolve(item.path)) !== join(resolve(primary.path), ".worktrees") || !entry)
  )
    blockers.push("identity-changed");
  if (!isRegistered && entry?.isDirectory() && !entry.isSymbolicLink()) {
    for (const path of await discoverRepositoryRoots([item.path])) {
      const marker = await pathEntry(join(path, ".git"));
      if (marker?.isDirectory()) blockers.push("protected-path");
      else if (marker?.isFile()) {
        const common = await runGit(["rev-parse", "--git-common-dir"], {
          cwd: path,
          allowFailure: true,
        });
        if (
          common.exitCode === 0 &&
          (await physical(resolve(path, common.stdout))) !== item.commonDirectory
        )
          blockers.push("identity-changed");
      }
    }
  }
  if (isRegistered && entry?.isDirectory() && !entry.isSymbolicLink()) {
    if ((await pathEntry(join(item.path, ".git")))?.isDirectory()) blockers.push("protected-path");
    if (!item.error) {
      await validateAuditPath(item, repositories);
      const modules = await runGit(["ls-files", "--stage", "-z"], { cwd: item.path });
      if (modules.stdout.split("\0").some((record) => record.startsWith("160000 ")))
        forceReasons.push("submodules");
    } else {
      const common = await runGit(["rev-parse", "--git-common-dir"], {
        cwd: item.path,
        allowFailure: true,
      });
      if (
        common.exitCode === 0 &&
        (await physical(resolve(item.path, common.stdout))) !== item.commonDirectory
      )
        blockers.push("identity-changed");
    }
  }
  const references = await findWorktreeReferences(workspaces, item.path);
  if (references.length) forceReasons.push("referenced");
  // Bind confirmation to the directory entry as well as Git/file state and current member references.
  item.fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        item.fingerprint,
        entry ? [entry.dev, entry.ino, entry.ctimeMs] : null,
        references,
        isRegistered,
      ]),
    )
    .digest("hex");
  return { item, blockers: [...new Set(blockers)], forceReasons: [...new Set(forceReasons)] };
}

export async function removeAuditedWorktree(
  manager: RepositoryManager,
  paths: StoragePaths,
  input: WorktreeRemovalInput,
): Promise<Omit<WorktreeRemovalResult, "report">> {
  const plan = await previewWorktreeRemoval(manager, input.id);
  if (input.confirmedPath !== plan.item.path)
    throw new CompulsiveError(
      "INVALID_INPUT",
      "The confirmation must exactly match the complete worktree path.",
    );
  if (plan.item.fingerprint !== input.fingerprint || plan.blockers.length)
    throw new CompulsiveError(
      "CONFLICT",
      "The worktree changed or is protected. Review a new deletion preview.",
      plan.blockers,
    );
  if (plan.forceReasons.length && input.force !== true)
    throw new CompulsiveError(
      "CONFLICT",
      "Force deletion confirmation is required.",
      plan.forceReasons,
    );
  if (plan.item.risks.includes("ignored-files") && input.includeIgnored !== true)
    throw new CompulsiveError("CONFLICT", "Confirm deletion of ignored files separately.");
  const item = plan.item;
  let retainedCommitRef: string | null = null;
  if (input.force === true && item.head && !item.branch) {
    retainedCommitRef = `refs/cpl/removed-worktrees/${randomUUID()}`;
    await runGit(["update-ref", retainedCommitRef, item.head, ""], { cwd: item.repositoryPath });
  }
  if (item.category === "unregistered") {
    if ((await pathEntry(item.path))?.isSymbolicLink()) await unlink(item.path);
    else await rm(item.path, { recursive: true, force: false });
  } else {
    if ((await pathEntry(item.path))?.isSymbolicLink()) await unlink(item.path);
    await runGit(
      [
        "worktree",
        "remove",
        ...(input.force === true ? ["--force", "--force"] : []),
        "--",
        item.path,
      ],
      { cwd: item.repositoryPath },
    );
    const registered = parseWorktreeList(
      (await runGit(["worktree", "list", "--porcelain", "-z"], { cwd: item.repositoryPath }))
        .stdout,
    );
    if (registered.some((entry) => entry.path === item.path))
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Git still reports the worktree after removal. Check it before retrying.",
      );
  }
  if (await pathEntry(item.path))
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      "Worktree removal did not remove its path. Inspect it before retrying.",
    );
  let warning: string | null = null;
  try {
    await detachWorktreeReferences(paths, item.path);
  } catch (error) {
    warning = `Worktree removed, but requirement references could not be fully cleaned: ${String(error)}`;
  }
  return { removedPath: item.path, retainedCommitRef, warning };
}
