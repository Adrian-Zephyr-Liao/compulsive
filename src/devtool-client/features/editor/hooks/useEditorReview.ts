import { useEffect, useState } from "react";
import type { projectGitDiff, ProjectGitStatus } from "../../../../project/git.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import { describeError } from "../../workspaces/utils/errors.js";
import type { EditorScope } from "../types.js";
import { reviewEntries } from "../utils/gitChanges.js";

export function useEditorReview(
  getRpc: () => Promise<WorkspaceRpc>,
  scope: EditorScope,
  status: ProjectGitStatus | undefined,
  active: boolean,
) {
  const [selected, select] = useState("");
  const [result, setResult] = useState<{
    key: string;
    diff?: Awaited<ReturnType<typeof projectGitDiff>>;
    error?: string;
  }>();
  const entries = reviewEntries(status);
  const current =
    entries.find((entry) => entry.id === selected) ??
    entries.find((entry) => !entry.change.conflict) ??
    entries[0];
  const key = JSON.stringify([
    scope.workspaceId,
    scope.repositoryId,
    current?.id,
    status?.fingerprint,
  ]);
  const path = current?.change.path;
  const staged = current?.staged ?? false;
  const conflict = current?.change.conflict ?? false;
  useEffect(() => {
    if (!active || !path || conflict) return;
    let valid = true;
    setResult(undefined);
    void getRpc()
      .then((rpc) => rpc.call("get-project-git-diff", { ...scope, path, staged }))
      .then((diff) => {
        if (valid) setResult({ key, diff });
      })
      .catch((error: unknown) => {
        if (valid) setResult({ key, error: describeError(error) });
      });
    return () => {
      valid = false;
    };
  }, [active, getRpc, scope.workspaceId, scope.repositoryId, path, staged, conflict, key, status]);
  const currentResult = result?.key === key ? result : undefined;
  return {
    entries,
    current,
    select,
    diff: currentResult?.diff,
    error: currentResult?.error,
    loading: !status || Boolean(current && !conflict && !currentResult),
  };
}
