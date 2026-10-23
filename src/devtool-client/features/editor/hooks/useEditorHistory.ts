import { useEffect, useRef, useState } from "react";
import type { projectGitDiff, projectGitHistory } from "../../../../project/git.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import { describeError } from "../../workspaces/utils/errors.js";
import type { EditorScope } from "../types.js";

type History = Awaited<ReturnType<typeof projectGitHistory>>;
const initial = {
  open: false,
  path: "",
  commits: [] as History["commits"],
  blame: [] as History["blame"],
  blameTruncated: false,
  loading: false,
  error: "",
  hasMore: false,
};

export function useEditorHistory(getRpc: () => Promise<WorkspaceRpc>, scope: EditorScope) {
  const { workspaceId, repositoryId } = scope;
  const [history, setHistory] = useState(initial);
  const [selected, select] = useState("");
  const [selectedFile, selectFile] = useState("");
  const [detail, setDetail] = useState<{ key: string; changed?: string[]; error?: string }>();
  const [preview, setPreview] = useState<{
    key: string;
    diff?: Awaited<ReturnType<typeof projectGitDiff>>;
    error?: string;
  }>();
  const request = useRef(0);
  useEffect(() => {
    setHistory(initial);
    return () => {
      request.current++;
    };
  }, [workspaceId, repositoryId]);

  async function loadHistory(offset = 0, commit = "", path = "") {
    if (commit) {
      select(commit);
      return;
    }
    const id = ++request.current;
    const targetPath = offset ? history.path : path;
    if (!offset) {
      select("");
      selectFile("");
      setDetail(undefined);
      setPreview(undefined);
    }
    setHistory((old) => ({
      ...(offset ? old : initial),
      open: true,
      path: targetPath,
      loading: true,
      error: "",
    }));
    try {
      const result = await (
        await getRpc()
      ).call("get-project-git-history", {
        workspaceId,
        repositoryId,
        offset,
        ...(targetPath ? { path: targetPath } : {}),
      });
      if (id !== request.current) return;
      setHistory((old) => ({
        ...old,
        commits: offset
          ? [
              ...old.commits,
              ...result.commits.filter((item) => !old.commits.some((c) => c.id === item.id)),
            ]
          : result.commits,
        blame: offset ? old.blame : result.blame,
        blameTruncated: offset ? old.blameTruncated : result.blameTruncated,
        loading: false,
        hasMore: result.commits.length === 50,
      }));
    } catch (error) {
      if (id === request.current)
        setHistory((old) => ({ ...old, loading: false, error: describeError(error) }));
    }
  }
  function close() {
    request.current++;
    setHistory((old) => ({ ...old, open: false, loading: false }));
  }
  const current = history.commits.find((item) => item.id === selected) ?? history.commits[0];
  const revision = current?.id ?? "";
  const key = JSON.stringify([workspaceId, repositoryId, revision]);
  const currentDetail = detail?.key === key ? detail : undefined;
  const changed = currentDetail?.changed ?? [];
  const file = changed.includes(selectedFile) ? selectedFile : (changed[0] ?? "");
  const previewKey = JSON.stringify([key, file]);
  const currentPreview = preview?.key === previewKey ? preview : undefined;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!history.open || !revision) return;
    let valid = true;
    setDetail(undefined);
    void getRpc()
      .then((rpc) =>
        rpc.call("get-project-git-history", { workspaceId, repositoryId, offset: 0, revision }),
      )
      .then((result) => {
        if (valid) setDetail({ key, changed: result.changed });
      })
      .catch((error: unknown) => {
        if (valid) setDetail({ key, error: describeError(error) });
      });
    return () => {
      valid = false;
    };
  }, [getRpc, workspaceId, repositoryId, history.open, revision, key, retry]);
  useEffect(() => {
    if (!history.open || !revision || !file) return;
    let valid = true;
    setPreview(undefined);
    void getRpc()
      .then((rpc) =>
        rpc.call("get-project-git-diff", {
          workspaceId,
          repositoryId,
          path: file,
          staged: false,
          revision,
        }),
      )
      .then((diff) => {
        if (valid) setPreview({ key: previewKey, diff });
      })
      .catch((error: unknown) => {
        if (valid) setPreview({ key: previewKey, error: describeError(error) });
      });
    return () => {
      valid = false;
    };
  }, [getRpc, workspaceId, repositoryId, history.open, revision, file, previewKey, retry]);
  return {
    ...history,
    current,
    changed,
    file,
    select,
    selectFile,
    loadHistory,
    close,
    retry: () => setRetry((value) => value + 1),
    detailLoading: Boolean(current && !currentDetail),
    detailError: currentDetail?.error,
    diff: currentPreview?.diff,
    diffLoading: Boolean(file && !currentPreview),
    diffError: currentPreview?.error,
  };
}
