import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { CompulsiveError } from "../errors.js";
import { runProjectGit } from "./git-command.js";
import {
  assertProjectRelativePath,
  resolveProjectPath,
  withProjectLock,
  type ProjectFileInput,
} from "./paths.js";
import { readProjectFile } from "./files.js";
import { readProjectBytes } from "./assets.js";
import { decodeGitDiff, readGitDiffBlob } from "./git-diff.js";
import { changeSnapshot } from "./git-snapshot.js";
import { verifyManagedWorktree } from "../workspace-worktrees.js";
import type { RepositoryManager, WorkspaceId, RepositoryId } from "../types.js";

type Scope = Omit<ProjectFileInput, "path">;
export interface ProjectGitChange {
  path: string;
  original: string;
  index: string;
  worktree: string;
  conflict: boolean;
  ignored: boolean;
}
export interface ProjectGitStatus {
  snapshotComplete?: boolean;
  excludedChanges: boolean;
  forcePushRequired: boolean;
  branch: string;
  head: string;
  upstream: string;
  ahead: number;
  behind: number;
  changes: ProjectGitChange[];
  fingerprint: string;
}
export async function gitRoot(manager: RepositoryManager, scope: Scope) {
  const state = await resolveProjectPath(manager, { ...scope, path: "" });
  if (state.member.mode === "worktree")
    await verifyManagedWorktree(
      state.root,
      state.repository.absolutePath,
      state.member.branch,
      state.member.detached,
    );
  return state;
}
export async function projectGitStatus(
  manager: RepositoryManager,
  scope: Scope,
): Promise<ProjectGitStatus> {
  const { root, member } = await gitRoot(manager, scope);
  return readGitStatus(root, member.mode === "worktree" ? member.forcePushBase : undefined);
}
export async function readGitStatus(root: string, forceBase?: string): Promise<ProjectGitStatus> {
  const git = (args: string[]) => runProjectGit(root, args, { allowFailure: true });
  const [raw, head, branch, upstream, diff, cached] = await Promise.all([
    git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored=matching"]),
    git(["rev-parse", "--verify", "HEAD"]),
    git(["symbolic-ref", "--short", "-q", "HEAD"]),
    git(["rev-parse", "--abbrev-ref", "@{upstream}"]),
    git(["diff", "--no-ext-diff", "--no-textconv"]),
    git(["diff", "--cached", "--no-ext-diff", "--no-textconv"]),
  ]);
  if (raw.exitCode) throw new CompulsiveError("GIT_FAILED", raw.stderr);
  const changes: ProjectGitChange[] = [];
  let excludedChanges = false;
  const entries = raw.stdout.split("\0");
  for (let i = 0; i < entries.length; i++) {
    const item = entries[i]!;
    if (!item) continue;
    const index = item[0]!,
      worktree = item[1]!,
      path = item.slice(3).replace(/\/$/, "");
    const original =
      index === "R" || index === "C" || worktree === "R" ? (entries[++i] ?? path) : path;
    try {
      assertProjectRelativePath(path, false);
      assertProjectRelativePath(original, false);
    } catch {
      excludedChanges ||= index !== "!";
      continue;
    }
    changes.push({
      path,
      original,
      index,
      worktree,
      conflict: index === "U" || worktree === "U" || ["AA", "DD"].includes(index + worktree),
      ignored: index === "!",
    });
  }
  const counts = upstream.exitCode
    ? []
    : (await git(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])).stdout
        .trim()
        .split(/\s+/)
        .map(Number);
  const snapshot = await changeSnapshot(root, changes);
  return {
    snapshotComplete: snapshot.complete,
    excludedChanges,
    forcePushRequired: Boolean(
      forceBase && (await git(["merge-base", "--is-ancestor", forceBase, "HEAD"])).exitCode !== 0,
    ),
    branch: branch.stdout.trim(),
    head: head.stdout.trim(),
    upstream: upstream.exitCode ? "" : upstream.stdout.trim(),
    ahead: counts[0] ?? 0,
    behind: counts[1] ?? 0,
    changes,
    fingerprint: createHash("sha256")
      .update(head.stdout + raw.stdout + diff.stdout + cached.stdout + snapshot.hash)
      .digest("hex"),
  };
}
export async function projectGitDiff(
  manager: RepositoryManager,
  input: ProjectFileInput & { staged: boolean; revision?: string | undefined },
) {
  assertProjectRelativePath(input.path, false);
  const { root } = await gitRoot(manager, input);
  if (input.revision && !/^[a-f0-9]{40,64}$/.test(input.revision))
    throw new CompulsiveError("INVALID_INPUT", "Select a full commit ID from history.");
  return withProjectLock(root, async () => {
    const status = await readGitStatus(root);
    const change = status.changes.find((c) => c.path === input.path);
    const revision = input.revision ?? "HEAD";
    const basePath =
      input.staged || change?.worktree === "R" ? (change?.original ?? input.path) : input.path;
    const readCurrent = async () => {
      if (input.revision || input.staged)
        return readGitDiffBlob(root, input.revision ?? "", input.path);
      try {
        return decodeGitDiff((await readProjectBytes(manager, input)).data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return { text: "" };
      }
    };
    const [base, current] = await Promise.all([
      readGitDiffBlob(
        root,
        input.revision ? `${revision}^` : input.staged ? "HEAD" : "",
        input.revision ? input.path : basePath,
      ),
      readCurrent(),
    ]);
    const images: { original?: string; content?: string } | undefined =
      base.image || current.image
        ? {
            ...(base.image && { original: base.image }),
            ...(current.image && { content: current.image }),
          }
        : undefined;
    const hunks =
      input.revision || images || change?.conflict || (input.staged && change?.index === "R")
        ? []
        : (await readHunks(root, input.path, input.staged)).hunks.map((h) => h.split("\n")[0]!);
    if (!input.revision && (await readGitStatus(root)).fingerprint !== status.fingerprint)
      throw new CompulsiveError(
        "CONFLICT",
        "Git state changed while reading the diff. Refresh and try again.",
      );
    return {
      path: input.path,
      original: base.text,
      content: current.text,
      staged: input.staged,
      fingerprint: status.fingerprint,
      ...(images && { images }),
      hunks,
    };
  });
}
async function readHunks(root: string, path: string, staged: boolean) {
  const raw = (
    await runProjectGit(root, [
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      "--unified=3",
      ...(staged ? ["--cached"] : []),
      "--",
      path,
    ])
  ).stdout;
  const parts = raw.split(/(?=^@@ )/m);
  return { header: parts[0] ?? "", hunks: parts.slice(1) };
}
export async function projectGitHunk(
  manager: RepositoryManager,
  input: ProjectFileInput & { staged: boolean; hunk: number; fingerprint: string },
) {
  assertProjectRelativePath(input.path, false);
  const { root } = await gitRoot(manager, input);
  return withProjectLock(root, async () => {
    const status = await projectGitStatus(manager, input);
    if (
      status.fingerprint !== input.fingerprint ||
      !Number.isSafeInteger(input.hunk) ||
      input.hunk < 0 ||
      status.changes.some((c) => c.path === input.path && c.conflict)
    )
      throw new CompulsiveError(
        "CONFLICT",
        "Git state changed. Reopen the diff before changing a hunk.",
      );
    await resolveProjectPath(manager, input, true);
    if (input.staged && status.changes.some((c) => c.path === input.path && c.index === "R"))
      throw new CompulsiveError(
        "INVALID_INPUT",
        "Unstage a renamed file as a whole file, not by hunk.",
      );
    const patch = await readHunks(root, input.path, input.staged);
    const hunk = patch.hunks[input.hunk];
    if (!hunk) throw new CompulsiveError("NOT_FOUND", "This change hunk is no longer available.");
    const args = ["apply", "--cached", ...(input.staged ? ["--reverse"] : [])];
    await runProjectGit(root, [...args, "--check", "-"], { input: patch.header + hunk });
    await runProjectGit(root, [...args, "-"], { input: patch.header + hunk });
    return projectGitStatus(manager, input);
  });
}
export async function projectGitHistory(
  manager: RepositoryManager,
  input: Scope & { offset: number; revision?: string | undefined; path?: string | undefined },
) {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0 || input.offset > 10000)
    throw new CompulsiveError("INVALID_INPUT", "Invalid history offset.");
  if (input.revision && !/^[a-f0-9]{40,64}$/.test(input.revision))
    throw new CompulsiveError("INVALID_INPUT", "Invalid commit ID.");
  if (input.path) assertProjectRelativePath(input.path, false);
  const { root } = await gitRoot(manager, input);
  const result = await runProjectGit(
    root,
    [
      "log",
      "--all",
      "--date=iso-strict",
      "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00",
      "--max-count=50",
      `--skip=${input.offset}`,
      ...(input.path ? ["--", input.path] : []),
    ],
    { allowFailure: true },
  );
  const fields = result.stdout.split("\0");
  const commits = [];
  for (let i = 0; i + 4 < fields.length; i += 5)
    commits.push({
      id: fields[i]!.trim(),
      parents: fields[i + 1]!.split(" ").filter(Boolean),
      author: fields[i + 2]!,
      date: fields[i + 3]!,
      subject: fields[i + 4]!,
    });
  const changed = input.revision
    ? (
        await runProjectGit(root, [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "--name-only",
          "-r",
          "-z",
          input.revision,
        ])
      ).stdout
        .split("\0")
        .filter((p) => {
          try {
            assertProjectRelativePath(p, false);
            return Boolean(p);
          } catch {
            return false;
          }
        })
    : [];
  const rawBlame = input.path
    ? (
        await runProjectGit(root, ["blame", "--line-porcelain", "--", input.path], {
          allowFailure: true,
        })
      ).stdout
    : "";
  const blame: Array<{
    id: string;
    line: number;
    author: string;
    summary: string;
    content: string;
  }> = [];
  let current = { id: "", line: 0, author: "", summary: "", content: "" };
  for (const line of rawBlame.split("\n")) {
    const header = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(line);
    if (header)
      current = { id: header[1]!, line: Number(header[2]), author: "", summary: "", content: "" };
    else if (line.startsWith("author ")) current.author = line.slice(7);
    else if (line.startsWith("summary ")) current.summary = line.slice(8);
    else if (line.startsWith("\t") && current.id) {
      if (blame.length >= 5000) break;
      blame.push({ ...current, content: line.slice(1) });
    }
  }
  return { commits, changed, blame, blameTruncated: blame.length >= 5000 };
}
export type ProjectGitOperation =
  | "stage"
  | "unstage"
  | "discard"
  | "commit"
  | "amend"
  | "undo"
  | "fetch"
  | "pull"
  | "push";
export interface ProjectGitAction extends Scope {
  force?: boolean | undefined;
  operation: ProjectGitOperation;
  paths: string[];
  fingerprint: string;
  message: string;
  confirmed: boolean;
  expectedVersion: string;
}
export async function projectGitAction(manager: RepositoryManager, input: ProjectGitAction) {
  if (
    !["stage", "unstage", "discard", "commit", "amend", "undo", "fetch", "pull", "push"].includes(
      input.operation,
    ) ||
    input.paths.length > 1000 ||
    input.message.length > 10000
  )
    throw new CompulsiveError("INVALID_INPUT", "Invalid Git action.");
  for (const path of input.paths) assertProjectRelativePath(path, false);
  if (["discard", "amend", "undo", "pull", "push"].includes(input.operation) && !input.confirmed)
    throw new CompulsiveError("INVALID_INPUT", "Confirm this Git operation first.");
  if (input.force && input.operation !== "push")
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Force is only available for a confirmed leased push.",
    );
  const { root } = await resolveProjectPath(manager, { ...input, path: "" });
  return withProjectLock(root, async () => {
    const state = await gitRoot(manager, input);
    if (state.root !== root)
      throw new CompulsiveError("CONFLICT", "The repository moved. Refresh before retrying.");
    const { member } = state;
    const current = await readGitStatus(root);
    if (current.fingerprint !== input.fingerprint)
      throw new CompulsiveError(
        "CONFLICT",
        "Git state changed. Refresh and review before retrying.",
      );
    const git = (args: string[]) => runProjectGit(root, args);
    for (const path of input.paths) {
      assertProjectRelativePath(path, false);
      const change = current.changes.find((item) => item.path === path && !item.ignored);
      if (!change)
        throw new CompulsiveError(
          "CONFLICT",
          "Select an individual file from the reviewed Git changes.",
        );
      if (
        input.operation === "unstage" ||
        (["stage", "discard"].includes(input.operation) && change.worktree === "D")
      )
        continue;
      const { target } = await resolveProjectPath(manager, { ...input, path }, true);
      if ((await lstat(target)).isDirectory())
        throw new CompulsiveError(
          "CONFLICT",
          "Select individual files, not entire directories or submodules.",
        );
    }
    if (
      ["commit", "amend", "undo", "pull", "push"].includes(input.operation) &&
      (!current.branch || member.mode !== "worktree" || member.detached)
    )
      throw new CompulsiveError("CONFLICT", "Switch this reference to a development branch first.");
    switch (input.operation) {
      case "stage":
        if (!input.paths.length)
          throw new CompulsiveError("INVALID_INPUT", "Select files to stage.");
        await git(["add", "--", ...input.paths]);
        break;
      case "unstage":
        if (!input.paths.length)
          throw new CompulsiveError("INVALID_INPUT", "Select files to unstage.");
        await git(["restore", "--staged", "--", ...input.paths]);
        break;
      case "discard": {
        const path = input.paths[0];
        const change = current.changes.find((c) => c.path === path);
        if (
          input.paths.length !== 1 ||
          !path ||
          !change ||
          change.index === "?" ||
          change.conflict ||
          change.worktree === " "
        )
          throw new CompulsiveError(
            "CONFLICT",
            "Discard requires one non-conflicted tracked file.",
          );
        const version =
          change.worktree === "D"
            ? ""
            : (await readProjectFile(manager, { ...input, path })).version;
        if (version !== input.expectedVersion)
          throw new CompulsiveError("CONFLICT", "File changed; nothing was discarded.");
        await git(["restore", "--worktree", "--", path]);
        break;
      }
      case "commit":
      case "amend":
        if (!input.message.trim() || current.changes.some((c) => c.conflict))
          throw new CompulsiveError("CONFLICT", "Resolve conflicts and enter a commit message.");
        for (const path of (
          await git(["diff", "--cached", "--no-renames", "--name-only", "-z"])
        ).stdout
          .split("\0")
          .filter(Boolean)) {
          try {
            assertProjectRelativePath(path, false);
          } catch {
            throw new CompulsiveError(
              "CONFLICT",
              "The index contains files excluded from the editor. Review them in an external editor before committing.",
            );
          }
        }
        await git([
          "commit",
          ...(input.operation === "amend" ? ["--amend"] : []),
          "-m",
          input.message,
        ]);
        break;
      case "undo": {
        if (current.excludedChanges || current.changes.some((c) => !c.ignored))
          throw new CompulsiveError("CONFLICT", "Undo requires a clean working tree and index.");
        const remote = await runProjectGit(root, ["branch", "-r", "--contains", "HEAD"], {
          allowFailure: true,
        });
        if (remote.stdout.trim())
          throw new CompulsiveError(
            "CONFLICT",
            "This commit exists on a known remote branch; undo is blocked.",
          );
        await git(["reset", "--soft", "HEAD^"]);
        break;
      }
      case "fetch":
        await git(["fetch", "--", "origin"]);
        break;
      case "pull": {
        if (!current.upstream || current.excludedChanges || current.changes.some((c) => !c.ignored))
          throw new CompulsiveError(
            "CONFLICT",
            "Fast-forward pull requires an upstream and a clean working tree.",
          );
        await git(["fetch"]);
        const target = (await git(["rev-parse", "--verify", "@{upstream}^{commit}"])).stdout.trim();
        if (
          (await gitRoot(manager, input)).root !== root ||
          (await readGitStatus(root)).fingerprint !== input.fingerprint
        )
          throw new CompulsiveError(
            "CONFLICT",
            "Git state changed while fetching. Refresh and review before pulling.",
          );
        await git(["merge", "--ff-only", "--no-autostash", "--no-overwrite-ignore", "--", target]);
        break;
      }
      case "push":
        await manager.pushWorkspaceMember({
          workspaceId: input.workspaceId as WorkspaceId,
          repositoryId: input.repositoryId as RepositoryId,
          ...(input.force ? { force: true } : {}),
        });
        break;
    }
    return input.operation === "push"
      ? projectGitStatus(manager, input)
      : readGitStatus(root, member.mode === "worktree" ? member.forcePushBase : undefined);
  });
}
