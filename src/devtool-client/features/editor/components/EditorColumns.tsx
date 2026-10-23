import { lazy, Suspense, useEffect, useRef, type ReactNode } from "react";
import { Breadcrumb, Button, Empty, Spin, Splitter, Tooltip } from "antd";
import { EyeOutlined, SaveOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import { tabId, type EditorTab } from "../utils/editorState.js";
import EditorFileTabs from "./EditorFileTabs.js";
import type { useEditorWorkbench } from "../hooks/useEditorWorkbench.js";
import type { EditorNavigation } from "../types.js";
const EditorCode = lazy(() => import("./EditorCode.js"));
const EditorPreview = lazy(() => import("./EditorPreview.js"));
export default function EditorColumns({
  editor: e,
  navigation,
  terminal,
  renderDiff,
}: {
  editor: ReturnType<typeof useEditorWorkbench>;
  navigation: EditorNavigation | undefined;
  terminal?: ReactNode;
  renderDiff: (tab: EditorTab) => ReactNode;
}) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current
      ?.querySelector<HTMLElement>(`[data-editor-column="${CSS.escape(e.activeColumn)}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [e.activeColumn]);
  return (
    <div ref={host} className="h-full w-full overflow-x-auto">
      <div style={{ height: "100%", minWidth: (e.columns.length + (terminal ? 1 : 0)) * 260 }}>
        <Splitter
          onResizeEnd={(sizes) => {
            e.setColumnSizes(sizes.slice(0, e.columns.length));
            if (terminal && sizes.at(-1))
              e.setPreferences((p) => ({
                ...p,
                panelSize: Math.max(100, Math.min(900, sizes.at(-1)!)),
              }));
          }}
        >
          {e.columns.map((column, columnIndex) => {
            const tab = column.tabs.find((t) => tabId(t) === column.active);
            const doc = tab ? e.documents[tab.path] : undefined;
            return (
              <Splitter.Panel
                key={column.id}
                min={220}
                {...(e.columnSizes[columnIndex] ? { defaultSize: e.columnSizes[columnIndex] } : {})}
              >
                <section
                  data-editor-column={column.id}
                  className="flex h-full min-h-0 flex-col"
                  onFocusCapture={() => e.setActiveColumn(column.id)}
                  onPointerDown={() => e.setActiveColumn(column.id)}
                >
                  <EditorFileTabs column={column} editor={e}>
                    {tab?.diff ? (
                      renderDiff(tab)
                    ) : (
                      <div className="flex h-full min-h-0 flex-col">
                        <div className="editor-minirow justify-between">
                          <div className="min-w-0 overflow-hidden" title={tab?.path}>
                            <Breadcrumb
                              className="editor-breadcrumb"
                              items={(tab?.path.split("/") ?? [t("editor.editor")]).map(
                                (title) => ({
                                  title,
                                }),
                              )}
                            />
                          </div>
                          {tab && (
                            <div className="flex shrink-0">
                              <Tooltip title={t("editor.previewSource")}>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<EyeOutlined />}
                                  aria-label={t("editor.previewSource")}
                                  disabled={!/\.(md|mdx|markdown|svg)$/i.test(tab.path)}
                                  onClick={() => e.preview(tab.path, column.id)}
                                />
                              </Tooltip>
                              <Tooltip title={t("editor.save")}>
                                <Button
                                  type="text"
                                  size="small"
                                  icon={<SaveOutlined />}
                                  aria-label={t("editor.save")}
                                  onClick={() => void e.save(tab.path).catch(e.report)}
                                />
                              </Tooltip>
                            </div>
                          )}
                        </div>
                        {doc?.conflict && (
                          <div className="flex items-center justify-between gap-3 border-b border-[var(--ant-color-warning-border)] bg-[var(--ant-color-warning-bg)] px-3 py-2 text-xs">
                            <span>{t("editor.diskConflict")}</span>
                            <Button
                              size="small"
                              onClick={() => void e.compare(doc.path).catch(e.report)}
                            >
                              {t("editor.compareDisk")}
                            </Button>
                            <Button size="small" onClick={() => void e.reload(doc.path)}>
                              {t("editor.reload")}
                            </Button>
                          </div>
                        )}
                        <div className="min-h-0 flex-1 overflow-hidden">
                          <Suspense
                            fallback={
                              <div className="p-6">
                                <Spin size="small" />
                              </div>
                            }
                          >
                            {tab && doc ? (
                              tab.preview || doc.asset ? (
                                <EditorPreview
                                  path={tab.path}
                                  content={doc.content}
                                  asset={doc.asset}
                                />
                              ) : (
                                <EditorCode
                                  key={`${column.id}:${tab.path}`}
                                  path={tab.path}
                                  content={doc.content}
                                  viewId={`${column.id}:${tab.path}`}
                                  preferences={e.preferences}
                                  states={e.states.current}
                                  views={e.views.current}
                                  cursor={tab.cursor}
                                  scroll={tab.scroll}
                                  navigation={
                                    navigation?.path === tab.path &&
                                    navigation.columnId === column.id
                                      ? navigation
                                      : undefined
                                  }
                                  onChange={(value) => e.edit(tab.path, value)}
                                  onPosition={(cursor, scroll) =>
                                    e.setColumns((all) =>
                                      all.map((c) =>
                                        c.id === column.id
                                          ? {
                                              ...c,
                                              tabs: c.tabs.map((t) =>
                                                tabId(t) === tabId(tab)
                                                  ? { ...t, cursor, scroll }
                                                  : t,
                                              ),
                                            }
                                          : c,
                                      ),
                                    )
                                  }
                                />
                              )
                            ) : tab ? (
                              <div className="p-6">
                                <Spin size="small" />
                              </div>
                            ) : (
                              <div className="flex h-full items-center justify-center p-6">
                                <Empty
                                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                                  description={
                                    <div className="flex flex-col gap-2">
                                      <span>{t("editor.empty")}</span>
                                      <span className="text-xs text-[var(--editor-muted)]">
                                        {t("editor.emptyHint")}
                                      </span>
                                    </div>
                                  }
                                />
                              </div>
                            )}
                          </Suspense>
                        </div>
                      </div>
                    )}
                  </EditorFileTabs>
                </section>
              </Splitter.Panel>
            );
          })}
          {terminal && (
            <Splitter.Panel min={260} defaultSize={e.preferences.panelSize}>
              {terminal}
            </Splitter.Panel>
          )}
        </Splitter>
      </div>
    </div>
  );
}
