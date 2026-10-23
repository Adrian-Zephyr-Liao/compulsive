import { useEffect, useMemo, useState } from "react";

import type { DevtoolWorkspace } from "../../../../devtool.js";
import type { RepositoryRecord } from "../../../../types.js";
import type { RequirementRepository } from "../types.js";

interface RequirementDraftOptions {
  busy: boolean;
  currentWorkspace: DevtoolWorkspace | undefined;
  repositories: RepositoryRecord[];
  workspaceRoot: string;
  workspaces: DevtoolWorkspace[];
  onResetBranches: () => void;
}

export function useRequirementDraft({
  busy,
  currentWorkspace,
  repositories,
  workspaceRoot,
  workspaces,
  onResetBranches,
}: RequirementDraftOptions) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"create" | "clone">("clone");
  const [sourceId, setSourceId] = useState("");
  const [targetName, setTargetName] = useState("");
  const [repositoryBranches, setRepositoryBranches] = useState<Record<string, string>>({});
  const [customizedBranchIds, setCustomizedBranchIds] = useState<string[]>([]);
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [defaultBranchIds, setDefaultBranchIds] = useState<string[]>([]);
  const [error, setError] = useState("");

  const source = useMemo(
    () => workspaces.find((workspace) => workspace.id === sourceId),
    [sourceId, workspaces],
  );
  const allRepositories = useMemo<RequirementRepository[]>(
    () =>
      repositories.map((repository) => {
        const member = source?.members.find(
          (candidate) => candidate.repositoryId === repository.id,
        );
        return { repository, ...(member ? { member } : {}) };
      }),
    [repositories, source],
  );
  const filteredRepositories = useMemo(() => {
    const query = repositoryQuery.trim().toLowerCase();
    if (!query) {
      return allRepositories.filter(({ repository }) => selectedIds.includes(repository.id));
    }
    return allRepositories.filter(({ member, repository }) =>
      [member?.alias ?? repository.name, repository.classificationPath].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [allRepositories, repositoryQuery, selectedIds]);
  const developmentIds = useMemo(
    () => selectedIds.filter((repositoryId) => !referenceIds.includes(repositoryId)),
    [referenceIds, selectedIds],
  );
  const targetPath = targetName.trim()
    ? `${workspaceRoot.replace(/\/$/, "")}/${targetName.trim()}`
    : workspaceRoot;
  const canSubmit = Boolean(
    targetName.trim() &&
    (mode === "create" || sourceId) &&
    (mode === "create" || selectedIds.length > 0) &&
    developmentIds.every(
      (repositoryId) =>
        defaultBranchIds.includes(repositoryId) || repositoryBranches[repositoryId]?.trim(),
    ) &&
    !busy,
  );

  useEffect(() => {
    if (mode !== "clone") return;
    setRepositoryQuery("");
    setRepositoryBranches({});
    setCustomizedBranchIds([]);
    setDefaultBranchIds([]);
    onResetBranches();
    setSelectedIds(source?.members.map((member) => member.repositoryId) ?? []);
    setReferenceIds(
      source?.members
        .filter(
          (member) => member.mode === "link" || (member.mode === "worktree" && member.detached),
        )
        .map((member) => member.repositoryId) ?? [],
    );
  }, [mode, onResetBranches, source]);

  useEffect(() => {
    const defaultBranch = targetName.trim() ? `workspace/${targetName.trim()}` : "";
    setRepositoryBranches((current) => {
      const next = { ...current };
      for (const repositoryId of developmentIds) {
        if (!customizedBranchIds.includes(repositoryId)) next[repositoryId] = defaultBranch;
      }
      return next;
    });
  }, [customizedBranchIds, developmentIds, targetName]);

  function reset(nextMode: "create" | "clone", sourceWorkspace?: DevtoolWorkspace): void {
    setMode(nextMode);
    setSourceId(sourceWorkspace?.id ?? "");
    setTargetName("");
    setRepositoryBranches({});
    setCustomizedBranchIds([]);
    setDefaultBranchIds([]);
    onResetBranches();
    setError("");
    setRepositoryQuery("");
    setSelectedIds(sourceWorkspace?.members.map((member) => member.repositoryId) ?? []);
    setReferenceIds(
      sourceWorkspace?.members
        .filter(
          (member) => member.mode === "link" || (member.mode === "worktree" && member.detached),
        )
        .map((member) => member.repositoryId) ?? [],
    );
    setOpen(true);
  }

  function toggleRepository(repositoryId: string): void {
    if (selectedIds.includes(repositoryId)) {
      setSelectedIds((current) => current.filter((selected) => selected !== repositoryId));
      setReferenceIds((current) => current.filter((reference) => reference !== repositoryId));
      setDefaultBranchIds((current) => current.filter((id) => id !== repositoryId));
    } else setSelectedIds((current) => [...current, repositoryId]);
  }

  function toggleReference(repositoryId: string): void {
    setReferenceIds((current) =>
      current.includes(repositoryId)
        ? current.filter((reference) => reference !== repositoryId)
        : [...current, repositoryId],
    );
  }

  function setRepositoryBranch(repositoryId: string, branch: string): void {
    setRepositoryBranches((current) => ({ ...current, [repositoryId]: branch }));
    setCustomizedBranchIds((current) =>
      current.includes(repositoryId) ? current : [...current, repositoryId],
    );
  }

  function setRepositoryDefaultBranch(repositoryId: string, value: boolean): void {
    setDefaultBranchIds((current) =>
      value
        ? [...new Set([...current, repositoryId])]
        : current.filter((id) => id !== repositoryId),
    );
  }

  return {
    canSubmit,
    close: () => setOpen(false),
    developmentCount: developmentIds.length,
    developmentIds,
    defaultBranchIds: defaultBranchIds.filter((id) => developmentIds.includes(id)),
    error,
    filteredRepositories,
    mode,
    open,
    openClone: () => reset("clone", currentWorkspace ?? workspaces[0]),
    openCreate: () => reset("create"),
    referenceIds,
    repositoryBranches,
    repositoryQuery,
    selectedIds,
    setError,
    setRepositoryBranch,
    setRepositoryDefaultBranch,
    setRepositoryQuery,
    setSourceId,
    setTargetName,
    sourceId,
    targetName,
    targetPath,
    toggleReference,
    toggleRepository,
  };
}
