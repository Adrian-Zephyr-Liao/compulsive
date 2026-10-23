import { useEffect, useState } from "react";
import type { projectGitDiff } from "../../../../project/git.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import { describeError } from "../../workspaces/utils/errors.js";
import type { EditorScope } from "../types.js";

export function useEditorDiff(
  getRpc: () => Promise<WorkspaceRpc>,
  scope: EditorScope,
  path: string,
  staged: boolean,
  fingerprint: string | undefined,
) {
  const [retry, setRetry] = useState(0);
  const identity = JSON.stringify([scope.workspaceId, scope.repositoryId, path, staged]);
  const key = JSON.stringify([identity, fingerprint, retry]);
  const [result, setResult] = useState<{
    key: string;
    identity: string;
    diff?: Awaited<ReturnType<typeof projectGitDiff>>;
    error?: string;
  }>();
  useEffect(() => {
    let active = true;
    void getRpc()
      .then((rpc) => rpc.call("get-project-git-diff", { ...scope, path, staged }))
      .then((diff) => {
        if (active) setResult({ key, identity, diff });
      })
      .catch((error: unknown) => {
        if (active) setResult({ key, identity, error: describeError(error) });
      });
    return () => {
      active = false;
    };
  }, [getRpc, scope.workspaceId, scope.repositoryId, path, staged, key, identity]);
  return {
    loading: result?.key !== key,
    diff: result?.identity === identity ? result.diff : undefined,
    error: result?.key === key ? result.error : undefined,
    refresh: () => setRetry((n) => n + 1),
  };
}
