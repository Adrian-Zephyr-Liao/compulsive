import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkspaceStatusResult } from "../../../../types.js";
import type { WorkspaceRpc } from "../types.js";
import { describeError } from "../utils/errors.js";

interface WorkspaceStatusOptions {
  cachedStatuses: WorkspaceStatusResult[];
  getRpc: () => Promise<WorkspaceRpc>;
  selectedWorkspaceId: string | undefined;
  onError: (message: string) => void;
}

export function useWorkspaceStatus({
  cachedStatuses,
  getRpc,
  selectedWorkspaceId,
  onError,
}: WorkspaceStatusOptions) {
  const [statuses, setStatuses] = useState<Record<string, WorkspaceStatusResult>>({});
  const [freshWorkspaceId, setFreshWorkspaceId] = useState<string>();
  const [loading, setLoading] = useState(false);
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId);
  const requestIdRef = useRef(0);
  const loadingWorkspaceIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    setFreshWorkspaceId(undefined);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const cached = Object.fromEntries(cachedStatuses.map((status) => [status.workspaceId, status]));
    setStatuses((current) => ({ ...cached, ...current }));
  }, [cachedStatuses]);

  const refresh = useCallback(
    async (fetchRemote = true): Promise<void> => {
      const workspaceId = selectedWorkspaceIdRef.current;
      if (!workspaceId || loadingWorkspaceIdRef.current === workspaceId) return;
      const requestId = ++requestIdRef.current;
      loadingWorkspaceIdRef.current = workspaceId;
      setLoading(true);
      try {
        const rpc = await getRpc();
        const result = await rpc.call("get-workspace-status", { workspaceId, fetchRemote });
        if (requestId === requestIdRef.current && selectedWorkspaceIdRef.current === workspaceId) {
          setStatuses((current) => ({ ...current, [workspaceId]: result }));
          setFreshWorkspaceId(workspaceId);
        }
      } catch (error) {
        if (requestId === requestIdRef.current) onError(describeError(error));
      } finally {
        if (requestId === requestIdRef.current) {
          loadingWorkspaceIdRef.current = undefined;
          setLoading(false);
        }
      }
    },
    [getRpc, onError],
  );

  return {
    fresh: freshWorkspaceId === selectedWorkspaceId,
    loading,
    refresh,
    status: selectedWorkspaceId ? statuses[selectedWorkspaceId] : undefined,
  };
}
