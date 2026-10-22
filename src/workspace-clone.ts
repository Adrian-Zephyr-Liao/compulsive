import {
  type StoragePaths,
  readConfig,
  readWorkspaceRegistry,
  readRegistry,
  fileExists,
} from "./storage.js";
import { type CloneWorkspaceInput, type WorkspaceRecord } from "./types.js";
import { assertSafeWorkspaceSegment } from "./workspace-paths.js";
import { CompulsiveError } from "./errors.js";
import { findWorkspace, findRepository, createWorkspace } from "./workspace-registry.js";
import { resolve, join } from "node:path";
import { runGit } from "./git.js";
import { fetchOriginDefaultBranch, localBranchExists } from "./workspace-branches.js";
import { addWorkspaceMember } from "./workspace-members.js";
import { deleteWorkspace } from "./workspace-deletion.js";

export async function cloneWorkspace(
  paths: StoragePaths,
  input: CloneWorkspaceInput,
): Promise<WorkspaceRecord> {
  const name = input.name.trim();
  assertSafeWorkspaceSegment(name, "Workspace name");
  if (input.repositoryIds.length === 0) {
    throw new CompulsiveError("INVALID_INPUT", "Select at least one repository to clone.");
  }
  if (new Set(input.repositoryIds).size !== input.repositoryIds.length) {
    throw new CompulsiveError("INVALID_INPUT", "Repository selection contains duplicates.");
  }
  const referenceRepositoryIds = input.referenceRepositoryIds ?? [];
  if (new Set(referenceRepositoryIds).size !== referenceRepositoryIds.length) {
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Reference repository selection contains duplicates.",
    );
  }
  const selectedIds = new Set(input.repositoryIds);
  if (referenceRepositoryIds.some((repositoryId) => !selectedIds.has(repositoryId))) {
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Every reference repository must be selected for cloning.",
    );
  }
  const branchName = input.branchName?.trim();
  if (input.branchName !== undefined && !branchName) {
    throw new CompulsiveError("INVALID_INPUT", "Clone branch name is required.");
  }
  const referenceIds = new Set(referenceRepositoryIds);
  const repositoryBranches = input.repositoryBranches ?? [];
  if (
    new Set(repositoryBranches.map(({ repositoryId }) => repositoryId)).size !==
    repositoryBranches.length
  ) {
    throw new CompulsiveError("INVALID_INPUT", "Repository branch selection contains duplicates.");
  }
  const branches = new Map(
    repositoryBranches.map(({ repositoryId, branch }) => {
      if (!selectedIds.has(repositoryId)) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Every repository branch must belong to the selected repositories.",
        );
      }
      if (referenceIds.has(repositoryId)) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Reference repositories cannot specify a development branch.",
        );
      }
      const value = branch.trim();
      if (!value) {
        throw new CompulsiveError("INVALID_INPUT", "Repository branch name is required.");
      }
      return [repositoryId, value] as const;
    }),
  );

  const [config, workspaceRegistry, repositoryRegistry] = await Promise.all([
    readConfig(paths.config),
    readWorkspaceRegistry(paths.workspaces),
    readRegistry(paths.registry),
  ]);
  const source = input.sourceWorkspaceId
    ? findWorkspace(workspaceRegistry, input.sourceWorkspaceId).workspace
    : undefined;
  const targetPath = resolve(join(config.workspaceRoot, name));
  if (
    workspaceRegistry.workspaces.some(
      (workspace) => workspace.name.toLowerCase() === name.toLowerCase(),
    )
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace name already exists: ${name}`);
  }
  if (
    workspaceRegistry.workspaces.some((workspace) => resolve(workspace.absolutePath) === targetPath)
  ) {
    throw new CompulsiveError("CONFLICT", `Workspace path is already registered: ${targetPath}`);
  }
  if (await fileExists(targetPath)) {
    throw new CompulsiveError("CONFLICT", `Workspace path already exists: ${targetPath}`);
  }

  const selected = input.repositoryIds.map((repositoryId) => {
    const repository = findRepository(repositoryRegistry.repositories, repositoryId);
    const member = source?.members.find((candidate) => candidate.repositoryId === repositoryId);
    return {
      alias: member?.alias ?? repository.name,
      repository,
      startPoint: "",
      reference: referenceIds.has(repositoryId),
      branch: branches.get(repositoryId) ?? branchName,
    };
  });

  for (const candidate of selected) {
    if (candidate.branch && !candidate.reference) {
      const validBranch = await runGit(["check-ref-format", "--branch", candidate.branch], {
        cwd: candidate.repository.absolutePath,
        allowFailure: true,
      });
      if (validBranch.exitCode !== 0) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          `Invalid clone branch name for ${candidate.repository.name}: ${candidate.branch}`,
        );
      }
    }
  }

  for (const selectedRepository of selected) {
    const { repository } = selectedRepository;
    const origin = await runGit(["config", "--get", "remote.origin.url"], {
      cwd: repository.absolutePath,
      allowFailure: true,
    });
    if (origin.exitCode !== 0 || !origin.stdout) {
      throw new CompulsiveError("CONFLICT", `Repository has no origin remote: ${repository.name}`);
    }
    const remoteBranch = await fetchOriginDefaultBranch(repository.absolutePath).catch((error) => {
      throw new CompulsiveError(
        "CONFLICT",
        `Unable to resolve the default branch for origin: ${repository.name}`,
        { cause: error },
      );
    });
    const commit = await runGit(["rev-parse", "--verify", `${remoteBranch}^{commit}`], {
      cwd: repository.absolutePath,
      allowFailure: true,
    });
    if (commit.exitCode !== 0 || !commit.stdout) {
      throw new CompulsiveError(
        "CONFLICT",
        `Remote default branch ${remoteBranch} is unavailable: ${repository.name}`,
      );
    }
    selectedRepository.startPoint = remoteBranch;
  }

  const target = await createWorkspace(paths, { name });
  const createdBranches: Array<{ repositoryPath: string; branch: string }> = [];
  try {
    let current = target;
    for (const { alias, repository, startPoint, reference, branch } of selected) {
      const existingBranch = branch
        ? await localBranchExists(repository.absolutePath, branch)
        : false;
      current = await addWorkspaceMember(paths, {
        workspaceId: target.id,
        repositoryId: repository.id,
        alias,
        mode: "worktree",
        ...(reference ? { detached: true } : { ...(branch ? { branch } : {}), createBranch: true }),
        startPoint,
      });
      const created = current.members.at(-1);
      if (created?.mode === "worktree" && !created.detached && !existingBranch) {
        createdBranches.push({ repositoryPath: repository.absolutePath, branch: created.branch });
      }
    }
    return current;
  } catch (error) {
    try {
      await deleteWorkspace(paths, target.id);
      for (const created of createdBranches) {
        await runGit(["branch", "-D", "--", created.branch], {
          cwd: created.repositoryPath,
          allowFailure: true,
        });
      }
    } catch (rollbackError) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Workspace clone failed and the partial target could not be fully removed.",
        { cause: error, rollbackError },
      );
    }
    throw error;
  }
}
