import { useCallback, useState } from "react";

import { useI18n } from "../../../app/i18n.js";
import type { RepositoryBranch } from "../../../../types.js";
import type { WorkspaceRpc } from "../types.js";
import { describeError } from "../utils/errors.js";

interface RepositoryBranchesOptions {
  getRpc: () => Promise<WorkspaceRpc>;
  onError: (message: string) => void;
}

export function useRepositoryBranches({ getRpc, onError }: RepositoryBranchesOptions) {
  const { t } = useI18n();
  const [branchOptions, setBranchOptions] = useState<Record<string, RepositoryBranch[]>>({});
  const [loadingIds, setLoadingIds] = useState<string[]>([]);

  const reset = useCallback(() => {
    setBranchOptions({});
    setLoadingIds([]);
  }, []);

  const load = useCallback(
    async (repositoryId: string, refresh = false): Promise<void> => {
      if (loadingIds.includes(repositoryId) || (!refresh && repositoryId in branchOptions)) return;
      setLoadingIds((current) => [...current, repositoryId]);
      try {
        const rpc = await getRpc();
        const result = await rpc.call("get-repository-branches", { repositoryId });
        setBranchOptions((current) => ({ ...current, [repositoryId]: result.branches }));
      } catch (error) {
        onError(t("branches.loadFailed", { error: describeError(error) }));
      } finally {
        setLoadingIds((current) => current.filter((id) => id !== repositoryId));
      }
    },
    [branchOptions, getRpc, loadingIds, onError, t],
  );

  return { branchOptions, loadingIds, load, reset };
}
