import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import { readWorktreeBranch, runGit } from "./git.js";
import type { DoctorCheck, RepositoryManager, RepositoryRecord, WorkspaceRecord } from "./types.js";

async function gitCommonDirectory(path: string): Promise<string> {
  const result = await runGit(["rev-parse", "--git-common-dir"], { cwd: path });
  return realpath(isAbsolute(result.stdout) ? result.stdout : resolve(path, result.stdout));
}

async function inspectWorkspaceMember(
  workspace: WorkspaceRecord,
  member: WorkspaceRecord["members"][number],
  repositories: RepositoryRecord[],
): Promise<string> {
  const repository = repositories.find((record) => record.id === member.repositoryId);
  if (!repository) throw new Error("Referenced repository is not registered.");
  const memberPath = join(workspace.absolutePath, member.alias);
  const entry = await lstat(memberPath);
  if (member.mode === "link") {
    if (!entry.isSymbolicLink()) throw new Error("Member path is not a symbolic link.");
    const [resolvedMember, resolvedRepository] = await Promise.all([
      realpath(memberPath),
      realpath(repository.absolutePath),
    ]);
    if (resolvedMember !== resolvedRepository) {
      throw new Error("Symbolic link points to a different repository.");
    }
    return `link -> ${resolvedRepository}`;
  }

  const legacy = resolve(member.worktreePath) === resolve(memberPath);
  if (!legacy) {
    const expectedPath = join(repository.absolutePath, ".worktrees", workspace.name);
    if (resolve(member.worktreePath) !== resolve(expectedPath)) {
      throw new Error("Managed worktree path does not match workspace metadata.");
    }
    if (!entry.isSymbolicLink()) throw new Error("Member path is not a symbolic link.");
    if ((await realpath(memberPath)) !== (await realpath(member.worktreePath))) {
      throw new Error("Symbolic link points to a different worktree.");
    }
  } else if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new Error("Member path is not a Git worktree directory.");
  }
  const worktreeEntry = await lstat(member.worktreePath);
  if (!worktreeEntry.isDirectory() || worktreeEntry.isSymbolicLink()) {
    throw new Error("Managed worktree is not a directory.");
  }
  const [memberCommon, repositoryCommon, branch, status] = await Promise.all([
    gitCommonDirectory(member.worktreePath),
    gitCommonDirectory(repository.absolutePath),
    readWorktreeBranch(member.worktreePath),
    runGit(["status", "--porcelain"], { cwd: member.worktreePath }),
  ]);
  if (
    memberCommon !== repositoryCommon ||
    branch.branch !== (member.detached ? "" : member.branch)
  ) {
    throw new Error("Git worktree identity does not match workspace metadata.");
  }
  return `worktree ${member.detached ? `detached at ${member.branch}` : member.branch}${branch.rebasing ? " (rebasing)" : ""} -> ${member.worktreePath}${status.stdout ? " (dirty)" : ""}`;
}

export async function runDoctorChecks(manager: RepositoryManager): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  try {
    const git = await runGit(["--version"]);
    checks.push({ name: "git", ok: true, detail: git.stdout });
  } catch (error) {
    checks.push({ name: "git", ok: false, detail: String(error) });
  }
  try {
    const config = await manager.getConfig();
    await access(config.rootDir, constants.W_OK);
    await manager.search();
    checks.push({ name: "storage", ok: true, detail: config.rootDir });
  } catch (error) {
    checks.push({ name: "storage", ok: false, detail: String(error) });
  }
  try {
    const config = await manager.getConfig();
    await access(config.workspaceRoot, constants.W_OK);
    const [workspaces, repositories] = await Promise.all([
      manager.searchWorkspaces(),
      manager.search(),
    ]);
    checks.push({ name: "workspace-root", ok: true, detail: config.workspaceRoot });
    for (const workspace of workspaces) {
      for (const member of workspace.members) {
        const name = `workspace:${workspace.name}/${member.alias}`;
        try {
          checks.push({
            name,
            ok: true,
            detail: await inspectWorkspaceMember(workspace, member, repositories),
          });
        } catch (error) {
          checks.push({ name, ok: false, detail: String(error) });
        }
      }
    }
  } catch (error) {
    checks.push({ name: "workspaces", ok: false, detail: String(error) });
  }
  try {
    if (process.platform !== "darwin") throw new Error("macOS only in v1");
    await access("/usr/bin/pbcopy", constants.X_OK);
    checks.push({ name: "clipboard", ok: true, detail: "/usr/bin/pbcopy" });
  } catch (error) {
    checks.push({ name: "clipboard", ok: false, detail: String(error) });
  }
  return checks;
}
