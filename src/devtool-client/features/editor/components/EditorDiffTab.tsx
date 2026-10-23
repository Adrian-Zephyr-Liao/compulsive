import { lazy, Suspense } from "react";
import { Alert, Button, Spin } from "antd";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import { useI18n } from "../../../app/i18n.js";
import type { EditorScope } from "../types.js";
import type { useEditorGit } from "../hooks/useEditorGit.js";
import { useEditorDiff } from "../hooks/useEditorDiff.js";

const EditorDiff = lazy(() => import("./EditorDiff.js"));

export default function EditorDiffTab({
  getRpc,
  scope,
  path,
  staged,
  git,
  dark,
  dirty,
  open,
  report,
}: {
  getRpc: () => Promise<WorkspaceRpc>;
  scope: EditorScope;
  path: string;
  staged: boolean;
  git: ReturnType<typeof useEditorGit>;
  dark: boolean;
  dirty: boolean;
  open: () => void;
  report: (error: unknown) => void;
}) {
  const { t } = useI18n();
  const { diff, loading, error, refresh } = useEditorDiff(
    getRpc,
    scope,
    path,
    staged,
    git.status?.fingerprint,
  );
  const reload = () => {
    refresh();
    void git.refresh().catch(report);
  };
  const conflict = git.status?.changes.some((c) => c.path === path && c.conflict);
  const exists = !git.status?.changes.some(
    (c) => c.path === path && (c.worktree === "D" || (c.index === "D" && c.worktree === " ")),
  );
  if (error || conflict)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 overflow-auto p-6">
        <Alert
          type="warning"
          showIcon
          title={t(conflict ? "editor.conflicts" : "editor.reviewUnavailable")}
          description={conflict ? t("editor.reviewConflict") : error}
        />
        <div className="flex gap-2">
          <Button onClick={reload}>{t("editor.historyRetry")}</Button>
          {exists && <Button onClick={open}>{t("editor.reviewOpenFile")}</Button>}
        </div>
      </div>
    );
  return (
    <Suspense
      fallback={
        <div className="p-6">
          <Spin />
        </div>
      }
    >
      {diff ? (
        <EditorDiff
          {...diff}
          embedded
          dark={dark}
          close={() => {}}
          kind={staged ? "staged" : "working"}
          busy={loading || git.busy}
          actionsDisabled={dirty}
          onHunk={(index) => void git.hunk(diff, index)}
          onFileAction={() => void git.run(staged ? "unstage" : "stage", [path])}
          onRefresh={reload}
          onOpen={exists ? open : undefined}
          notice={dirty ? t("editor.reviewUnsaved", { count: 1 }) : undefined}
        />
      ) : (
        <div className="flex h-full items-center justify-center p-6">
          <Spin />
        </div>
      )}
    </Suspense>
  );
}
