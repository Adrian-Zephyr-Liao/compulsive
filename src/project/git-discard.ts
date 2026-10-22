import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { lstat, unlink } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { CompulsiveError } from "../errors.js";
import type { RepositoryManager } from "../types.js";
import { runProjectGit } from "./git-command.js";
import { gitRoot, readGitStatus } from "./git.js";
import { assertProjectRelativePath, resolveProjectPath, withProjectLock } from "./paths.js";

export async function projectGitDiscardAll(
  manager: RepositoryManager,
  input: {
    workspaceId: string;
    repositoryId: string;
    fingerprint: string;
    confirmed: boolean;
    backup?: boolean;
  },
) {
  if (!input.confirmed)
    throw new CompulsiveError("INVALID_INPUT", "Confirm discarding all local changes first.");
  const { root } = await resolveProjectPath(manager, { ...input, path: "" });
  return withProjectLock(root, async () => {
    const state = await gitRoot(manager, input);
    if (state.root !== root)
      throw new CompulsiveError("CONFLICT", "The repository moved. Refresh before retrying.");
    const current = await readGitStatus(root);
    if (current.fingerprint !== input.fingerprint)
      throw new CompulsiveError(
        "CONFLICT",
        "Git state changed. Refresh and review before discarding.",
      );
    if (
      !current.head ||
      current.excludedChanges ||
      current.snapshotComplete !== true ||
      current.changes.some((change) => change.conflict)
    )
      throw new CompulsiveError(
        "CONFLICT",
        "These changes cannot be safely discarded here. Resolve conflicts or review excluded, symbolic-link, submodule or large files in an external editor; nothing was discarded.",
      );
    const markers = [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "rebase-merge",
      "rebase-apply",
      "sequencer",
    ];
    const locations = (
      await runProjectGit(root, ["rev-parse", ...markers.flatMap((name) => ["--git-path", name])])
    ).stdout
      .trim()
      .split("\n");
    for (const location of locations) {
      try {
        await lstat(isAbsolute(location) ? location : resolve(root, location));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      throw new CompulsiveError(
        "CONFLICT",
        "Finish or abort the current Git operation before discarding changes.",
      );
    }
    const changes = current.changes.filter((change) => !change.ignored);
    if (!changes.length)
      throw new CompulsiveError("CONFLICT", "There are no local changes to discard.");
    const paths = [...new Set(changes.flatMap((change) => [change.path, change.original]))];
    const identity = (info: BigIntStats) =>
      `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
    const files = new Map<string, string>();
    for (const path of paths) {
      assertProjectRelativePath(path, false);
      let target = root;
      const parts = path.split("/");
      for (const [index, part] of parts.entries()) {
        target = join(target, part);
        let info;
        try {
          info = await lstat(target, { bigint: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
          throw error;
        }
        if (
          info.isSymbolicLink() ||
          (index === parts.length - 1 ? !info.isFile() : !info.isDirectory())
        )
          throw new CompulsiveError(
            "CONFLICT",
            "Directories, submodules and symbolic links cannot be discarded here; nothing was changed.",
          );
        if (index === parts.length - 1) files.set(path, identity(info));
      }
    }
    const [index, head] = await Promise.all([
      runProjectGit(root, ["ls-files", "--stage", "-z", "--", ...paths]),
      runProjectGit(root, ["ls-tree", "-r", "-z", "HEAD", "--", ...paths]),
    ]);
    if (
      [index.stdout, head.stdout].some((tree) =>
        tree.split("\0").some((entry) => /^(?:120000|160000) /.test(entry)),
      )
    )
      throw new CompulsiveError(
        "CONFLICT",
        "Submodule and symbolic-link changes require an external editor; nothing was discarded.",
      );
    const treePaths = (tree: string) =>
      tree
        .split("\0")
        .filter(Boolean)
        .map((entry) => entry.slice(entry.indexOf("\t") + 1));
    const headPaths = new Set(treePaths(head.stdout));
    const restorePaths = [...new Set([...headPaths, ...treePaths(index.stdout)])];
    if ((await readGitStatus(root)).fingerprint !== input.fingerprint)
      throw new CompulsiveError(
        "CONFLICT",
        "Files changed while preparing to discard; nothing was discarded.",
      );
    let backup: { oid: string; message: string } | null = null;
    if (input.backup) {
      const message = `CPL discard-all ${randomUUID()}`;
      // Git's scoped stash cleanup fails for staged renames/deletions; all changed paths were checked above.
      const result = await runProjectGit(
        root,
        ["stash", "push", "--include-untracked", "--message", message],
        { allowFailure: true },
      );
      const backups = await runProjectGit(
        root,
        ["reflog", "show", "--format=%H%x00%gs", "--max-count=100", "refs/stash"],
        { allowFailure: true },
      );
      const oid = backups.stdout
        .split("\n")
        .find((line) => line.endsWith(message))
        ?.split("\0")[0];
      if (!oid || !/^[a-f0-9]{40,64}$/.test(oid))
        throw new CompulsiveError(
          "GIT_FAILED",
          `The backup could not be verified. Check git stash list for ${message} and refresh Git status before retrying. ${result.stderr}`,
        );
      backup = { oid, message };
      if (result.exitCode)
        throw new CompulsiveError(
          "GIT_FAILED",
          `Discard did not finish. Backup ${oid} is retained; recover with git stash apply --index ${oid}. ${result.stderr}`,
          { backup },
        );
    }
    try {
      if (!input.backup && restorePaths.length)
        await runProjectGit(
          root,
          [
            "restore",
            "--source=HEAD",
            "--staged",
            "--worktree",
            "--pathspec-from-file=-",
            "--pathspec-file-nul",
          ],
          { input: `${restorePaths.join("\0")}\0` },
        );
      for (const path of paths) {
        if (headPaths.has(path)) continue;
        let target = root;
        const parts = path.split("/");
        let missing = false;
        for (const [position, part] of parts.entries()) {
          target = join(target, part);
          let info;
          try {
            info = await lstat(target, { bigint: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") {
              missing = true;
              break;
            }
            throw error;
          }
          if (
            info.isSymbolicLink() ||
            (position === parts.length - 1
              ? !info.isFile() || identity(info) !== files.get(path)
              : !info.isDirectory())
          )
            throw new CompulsiveError(
              "CONFLICT",
              "A reviewed new file changed during discard; it was not deleted.",
            );
        }
        if (!missing) await unlink(target);
      }
      const status = await readGitStatus(
        root,
        state.member.mode === "worktree" ? state.member.forcePushBase : undefined,
      );
      if (status.excludedChanges || status.changes.some((change) => !change.ignored))
        throw new CompulsiveError("CONFLICT", "Some changes remain after discard.");
      return { status, backup };
    } catch (error) {
      throw new CompulsiveError(
        error instanceof CompulsiveError ? error.code : "FILESYSTEM_FAILED",
        backup
          ? `Discard did not finish. Backup ${backup.oid} is retained; recover with git stash apply --index ${backup.oid}. ${(error as Error).message}`
          : `Discard did not finish. Some changes may already have been permanently removed; no backup was created. Refresh Git status before continuing. ${(error as Error).message}`,
        { backup, cause: error },
      );
    }
  });
}
