import type { EditorScope } from "../types.js";
import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type {
  ProjectGitStatus,
  ProjectGitOperation,
  projectGitDiff,
  projectGitHistory,
} from "../../../../project/git.js";
import type { RepositoryBranch } from "../../../../types.js";
import { useI18n } from "../../../app/i18n.js";
import { useEditorGitDraft } from "./useEditorGitDraft.js";
import EditorDiscardOptions from "../components/EditorDiscardOptions.js";
export function useEditorGit(
  getRpc: () => Promise<WorkspaceRpc>,
  scope: EditorScope,
  dirtyPaths: string[],
  report: (e: unknown) => void,
  onChanged: () => void,
) {
  const { t } = useI18n();
  const { modal } = App.useApp();
  const [status, setStatus] = useState<ProjectGitStatus>();
  const [busy, setBusy] = useState(false);
  const draft = useEditorGitDraft(getRpc, scope, status, busy, dirtyPaths, report);
  const { message, setMessage } = draft;
  const [recovery, setRecovery] = useState("");
  const currentDirtyPaths = useRef(dirtyPaths);
  useEffect(() => {
    currentDirtyPaths.current = dirtyPaths;
  }, [dirtyPaths]);
  const discardRequest = useRef(0);
  const discardDialog = useRef<ReturnType<typeof modal.confirm> | undefined>(undefined);
  useEffect(
    () => () => {
      discardRequest.current++;
      discardDialog.current?.destroy();
    },
    [scope.workspaceId, scope.repositoryId],
  );
  const [diff, setDiff] = useState<Awaited<ReturnType<typeof projectGitDiff>>>();
  const [history, setHistory] = useState<Awaited<ReturnType<typeof projectGitHistory>>>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revision, setRevision] = useState("");
  const [branchOpen, setBranchOpen] = useState(false);
  const [branch, setBranch] = useState("");
  const [branches, setBranches] = useState<RepositoryBranch[]>([]);
  const { workspaceId, repositoryId } = scope;
  const refresh = useCallback(async () => {
    const next = await (
      await getRpc()
    ).call("get-project-git-status", { workspaceId, repositoryId });
    setStatus(next);
    return next;
  }, [getRpc, workspaceId, repositoryId]);
  useEffect(() => {
    let active = true;
    void getRpc()
      .then((rpc) => rpc.call("get-project-git-status", { workspaceId, repositoryId }))
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [getRpc, workspaceId, repositoryId, report]);
  async function run(operation: ProjectGitOperation, paths: string[] = [], force = false) {
    if (!status || busy || draft.generating) return;
    if (
      ["commit", "amend", "pull", "push", "undo", "discard"].includes(operation) &&
      dirtyPaths.length
    ) {
      report(new Error(t("editor.saveBeforeGit")));
      return;
    }
    if (["discard", "amend", "undo", "pull", "push"].includes(operation)) {
      const confirmed = await new Promise<boolean>((resolve) =>
        modal.confirm({
          title: t("editor.gitConfirm", {
            action: force ? t("operation.forcePush") : t(`editor.${operation}`),
          }),
          content:
            operation === "discard"
              ? `${paths[0]} — ${t("editor.discardWarning")}`
              : `${t("editor.gitTarget", { branch: status.branch })}${force ? `\n${t("operation.forcePushDetail")}` : ""}`,
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const rpc = await getRpc();
      const file =
        operation === "discard" &&
        paths[0] &&
        status.changes.find((change) => change.path === paths[0])?.worktree !== "D"
          ? await rpc.call("read-project-file", { ...scope, path: paths[0] })
          : undefined;
      const next = await rpc.call("run-project-git-action", {
        ...scope,
        operation,
        paths,
        fingerprint: status.fingerprint,
        message,
        confirmed: true,
        expectedVersion: file?.version ?? "",
        force,
      });
      setStatus(next);
      if (operation === "commit" || operation === "amend") setMessage("");
      setDiff(undefined);
      onChanged();
    } catch (e) {
      report(e);
      await refresh().catch(report);
    } finally {
      setBusy(false);
    }
  }
  async function discardAll() {
    if (!status || busy || draft.generating) return;
    if (dirtyPaths.length) {
      report(new Error(t("editor.saveBeforeGit")));
      return;
    }
    const id = ++discardRequest.current;
    setBusy(true);
    try {
      let backup = false;
      const confirmed = await new Promise<boolean>((resolve) => {
        discardDialog.current = modal.confirm({
          centered: true,
          title: t("editor.discardAll"),
          content: createElement(EditorDiscardOptions, {
            branch: status.branch || "HEAD",
            count: status.changes.filter((change) => !change.ignored).length,
            onBackupChange: (value) => {
              backup = value;
            },
          }),
          okText: t("editor.discardAll"),
          okButtonProps: { danger: true },
          autoFocusButton: "cancel",
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed || id !== discardRequest.current) return;
      if (!backup) {
        const permanent = await new Promise<boolean>((resolve) => {
          discardDialog.current = modal.confirm({
            centered: true,
            title: t("editor.discardNoBackupTitle"),
            content: t("editor.discardNoBackupHint"),
            okText: t("editor.discardPermanently"),
            okButtonProps: { danger: true },
            autoFocusButton: "cancel",
            onOk: () => resolve(true),
            onCancel: () => resolve(false),
          });
        });
        if (!permanent || id !== discardRequest.current) return;
      }
      if (currentDirtyPaths.current.length) throw new Error(t("editor.saveBeforeGit"));
      const rpc = await getRpc();
      if (id !== discardRequest.current) return;
      const result = await rpc.call("discard-project-git-changes", {
        ...scope,
        fingerprint: status.fingerprint,
        confirmed: true,
        backup,
      });
      if (id !== discardRequest.current) return;
      setStatus(result.status);
      setRecovery(result.backup?.oid ?? "");
      setDiff(undefined);
      setMessage("");
      onChanged();
    } catch (error) {
      if (id === discardRequest.current) {
        report(error);
        await refresh().catch(report);
      }
    } finally {
      discardDialog.current = undefined;
      setBusy(false);
    }
  }
  async function inspect(path: string, staged: boolean, commit = "") {
    try {
      setDiff(
        await (
          await getRpc()
        ).call("get-project-git-diff", {
          ...scope,
          path,
          staged,
          ...(commit ? { revision: commit } : {}),
        }),
      );
    } catch (e) {
      report(e);
    }
  }
  async function hunk(index: number) {
    if (!diff || busy || draft.generating) return;
    setBusy(true);
    try {
      setStatus(
        await (
          await getRpc()
        ).call("stage-project-git-hunk", {
          ...scope,
          path: diff.path,
          staged: diff.staged,
          hunk: index,
          fingerprint: diff.fingerprint,
        }),
      );
      await inspect(diff.path, diff.staged);
      onChanged();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function loadHistory(offset = 0, commit = "", path = "") {
    setHistoryOpen(true);
    setBusy(true);
    try {
      const result = await (
        await getRpc()
      ).call("get-project-git-history", {
        ...scope,
        offset,
        ...(commit ? { revision: commit } : {}),
        ...(path ? { path } : {}),
      });
      setRevision(commit);
      setHistory((old) =>
        offset && old ? { ...result, commits: [...old.commits, ...result.commits] } : result,
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function loadBranches() {
    setBranchOpen(true);
    try {
      const result = await (await getRpc()).call("get-repository-branches", { repositoryId });
      setBranches(result.branches);
    } catch (e) {
      report(e);
    }
  }
  async function switchBranch() {
    if (busy || draft.generating) return;
    if (dirtyPaths.length) {
      report(new Error(t("editor.saveBeforeGit")));
      return;
    }
    setBusy(true);
    try {
      await (await getRpc()).call("switch-workspace-member-branch", { ...scope, branch });
      setBranchOpen(false);
      onChanged();
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  return {
    status,
    busy: busy || draft.generating,
    generating: draft.generating,
    generateMessage: draft.generateMessage,
    discardAll,
    recovery,
    setRecovery,
    message,
    setMessage,
    refresh,
    run,
    inspect,
    hunk,
    diff,
    setDiff,
    history,
    historyOpen,
    setHistoryOpen,
    revision,
    loadHistory,
    branchOpen,
    setBranchOpen,
    branch,
    setBranch,
    branches,
    loadBranches,
    switchBranch,
  };
}
