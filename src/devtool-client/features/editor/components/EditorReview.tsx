import { lazy, Suspense, useEffect, useState } from "react";
import { Alert, Button, Dropdown, Empty, Menu, Spin, Splitter, Tag, Tooltip } from "antd";
import { DiffOutlined, EllipsisOutlined, ReloadOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type { EditorScope } from "../types.js";
import type { useEditorGit } from "../hooks/useEditorGit.js";
import { useEditorReview } from "../hooks/useEditorReview.js";

const EditorDiff = lazy(() => import("./EditorDiff.js"));

export default function EditorReview({
  active,
  getRpc,
  scope,
  git,
  dark,
  onOpen,
  onAllFiles,
  onOpenVscode,
  report,
  onCommit,
  dirtyPaths,
}: {
  active: boolean;
  getRpc: () => Promise<WorkspaceRpc>;
  scope: EditorScope;
  git: Pick<
    ReturnType<typeof useEditorGit>,
    "status" | "refresh" | "busy" | "discardAll" | "hunk" | "run"
  >;
  dark: boolean;
  onOpen: (path: string) => void;
  onAllFiles: () => void;
  onOpenVscode: () => void;
  report: (error: unknown) => void;
  onCommit: () => void;
  dirtyPaths: string[];
}) {
  const { t } = useI18n();
  const [sideBySide, setSideBySide] = useState<boolean>();
  const review = useEditorReview(getRpc, scope, git.status, active);
  useEffect(() => {
    if (active && git.status) void git.refresh().catch(report);
  }, [active, git.refresh, report]);
  const entry = review.current;
  const canOpen =
    entry &&
    !review.error &&
    entry.change.worktree !== "D" &&
    !(entry.change.index === "D" && entry.change.worktree === " ");
  const loading = (
    <div className="flex h-full items-center justify-center p-6">
      <Spin />
    </div>
  );
  return (
    <Splitter>
      <Splitter.Panel defaultSize={280} min={200} max={480}>
        <aside
          className="flex h-full min-h-0 flex-col bg-[var(--editor-panel)]"
          aria-label={t("editor.reviewChanges")}
        >
          <div className="flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--editor-border)] px-4 py-2">
            <span className="font-medium">
              {t("editor.reviewCount", { count: review.entries.length })}
            </span>
            <div className="flex items-center gap-1">
              <Button type="text" size="small" onClick={onCommit}>
                {t("editor.commit")}
              </Button>
              <Tooltip title={t("editor.gitRefresh")}>
                <Button
                  type="text"
                  size="small"
                  icon={<ReloadOutlined spin={git.busy} />}
                  aria-label={t("editor.gitRefresh")}
                  onClick={() => void git.refresh().catch(report)}
                />
              </Tooltip>
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "discard-all",
                      label: t("editor.discardAll"),
                      danger: true,
                      disabled: git.busy || !review.entries.length,
                      onClick: () => void git.discardAll(),
                    },
                  ],
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<EllipsisOutlined />}
                  aria-label={t("editor.more")}
                />
              </Dropdown>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto py-2">
            {git.status?.excludedChanges && (
              <p role="status" className="px-4 py-2 text-xs text-[var(--ant-color-warning-text)]">
                {t("editor.excludedChanges")}
              </p>
            )}
            <Menu
              className="!border-0 !bg-transparent"
              mode="inline"
              selectedKeys={entry ? [entry.id] : []}
              onSelect={({ key }) => review.select(key)}
              items={(["conflicts", "staged", "changes", "untracked"] as const).flatMap((group) => {
                const entries = review.entries.filter((item) => item.group === group);
                return entries.length
                  ? [
                      {
                        type: "group" as const,
                        key: group,
                        label: `${t(`editor.${group}`)} · ${entries.length}`,
                        children: entries.map((item) => ({
                          key: item.id,
                          icon: <DiffOutlined />,
                          title:
                            item.change.original !== item.change.path
                              ? `${item.change.original} → ${item.change.path}`
                              : item.change.path,
                          label: (
                            <span className="flex min-w-0 items-center justify-between gap-2">
                              <span className="truncate">{item.change.path}</span>
                              <span
                                className={
                                  item.change.conflict
                                    ? "text-[var(--ant-color-error)]"
                                    : "text-[var(--editor-muted)]"
                                }
                              >
                                {item.staged ? item.change.index : item.change.worktree}
                              </span>
                            </span>
                          ),
                        })),
                      },
                    ]
                  : [];
              })}
            />
          </div>
        </aside>
      </Splitter.Panel>
      <Splitter.Panel min={280}>
        <main className="flex h-full min-h-0 flex-col" aria-label={t("editor.reviewChanges")}>
          {entry && (entry.change.conflict || review.error) && (
            <div className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--editor-border)] px-4 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium" title={entry.change.path}>
                  {entry.change.path}
                </div>
                <div className="text-xs text-[var(--editor-muted)]">
                  {t(
                    entry.change.conflict
                      ? "editor.conflicts"
                      : entry.staged
                        ? "editor.reviewStagedBase"
                        : entry.group === "untracked"
                          ? "editor.reviewNewBase"
                          : "editor.reviewWorkingBase",
                  )}
                </div>
              </div>
              <Tag>{t(`editor.${entry.group}`)}</Tag>
              {canOpen && (
                <Button size="small" onClick={() => onOpen(entry.change.path)}>
                  {t("editor.reviewOpenFile")}
                </Button>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1">
            {review.loading ? (
              loading
            ) : entry?.change.conflict ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
                <Alert
                  type="warning"
                  showIcon
                  title={t("editor.conflicts")}
                  description={t("editor.reviewConflict")}
                />
                <Button onClick={onOpenVscode}>{t("editor.openVscode")}</Button>
              </div>
            ) : review.error ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
                <Alert
                  type="warning"
                  showIcon
                  title={t("editor.reviewUnavailable")}
                  description={<span className="break-words">{review.error}</span>}
                />
                <Button onClick={onOpenVscode}>{t("editor.openVscode")}</Button>
              </div>
            ) : review.diff ? (
              <Suspense fallback={loading}>
                <EditorDiff
                  {...review.diff}
                  embedded
                  dark={dark}
                  close={onAllFiles}
                  kind={entry?.staged ? "staged" : "working"}
                  onHunk={(index) => void git.hunk(review.diff!, index)}
                  onFileAction={() =>
                    void git.run(entry?.staged ? "unstage" : "stage", [review.diff!.path])
                  }
                  busy={git.busy}
                  actionsDisabled={dirtyPaths.includes(review.diff.path)}
                  onOpen={canOpen ? () => onOpen(review.diff!.path) : undefined}
                  sideBySide={sideBySide}
                  onSideChange={setSideBySide}
                />
              </Suspense>
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t(
                    git.status?.excludedChanges ? "editor.excludedChanges" : "editor.reviewEmpty",
                  )}
                >
                  <Button onClick={git.status?.excludedChanges ? onOpenVscode : onAllFiles}>
                    {t(git.status?.excludedChanges ? "editor.openVscode" : "editor.allFiles")}
                  </Button>
                </Empty>
              </div>
            )}
          </div>
        </main>
      </Splitter.Panel>
    </Splitter>
  );
}
