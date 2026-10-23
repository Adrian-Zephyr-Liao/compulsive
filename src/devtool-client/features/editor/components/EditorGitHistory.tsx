import { Alert, Button, Empty, Modal, Select, Spin, Typography } from "antd";
import { ClockCircleOutlined, FileTextOutlined, UserOutlined } from "@ant-design/icons";
import { lazy, Suspense, useEffect, useState } from "react";
import { useI18n } from "../../../app/i18n.js";
import type { useEditorHistory } from "../hooks/useEditorHistory.js";
import EditorHistoryList from "./EditorHistoryList.js";

const EditorDiff = lazy(() => import("./EditorDiff.js"));

export default function EditorGitHistory({
  history: h,
  dark,
}: {
  history: ReturnType<typeof useEditorHistory>;
  dark: boolean;
}) {
  const { t, formatDateTime } = useI18n();
  const [blame, setBlame] = useState(false);
  const [sideBySide, setSideBySide] = useState<boolean>();
  useEffect(() => setBlame(Boolean(h.path)), [h.open, h.path]);
  const loading = (
    <div className="flex h-full items-center justify-center p-6">
      <Spin />
    </div>
  );
  const error = h.detailError || h.diffError;
  return (
    <Modal
      open={h.open}
      centered
      title={
        <span className="flex items-center gap-2">
          <ClockCircleOutlined />
          {t("editor.history")}
        </span>
      }
      width="min(1440px, calc(100vw - 48px))"
      footer={null}
      onCancel={h.close}
      destroyOnHidden
      className="cpl-editor-overlay"
      styles={{
        container: { padding: 0, overflow: "hidden" },
        header: {
          padding: "16px 24px",
          marginBottom: 0,
          borderBottom: "1px solid var(--editor-border)",
        },
        body: { padding: 0 },
      }}
    >
      <div className="grid h-[78dvh] min-h-0 grid-cols-[minmax(280px,340px)_minmax(0,1fr)] overflow-hidden max-md:h-[82dvh] max-md:grid-cols-1 max-md:grid-rows-[200px_minmax(0,1fr)]">
        <div className="flex min-h-0 min-w-0 flex-col border-r border-[var(--editor-border)] max-md:border-b max-md:border-r-0">
          <EditorHistoryList
            history={{
              ...h,
              select: (id) => {
                setBlame(false);
                h.select(id);
              },
            }}
          />
        </div>
        <section
          className="flex min-h-0 min-w-0 flex-col bg-[var(--editor-bg)]"
          aria-label={t("editor.commitDetails")}
        >
          {blame ? (
            <>
              <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--editor-border)] px-6 py-4">
                <span className="min-w-0 truncate font-medium" title={h.path}>
                  {h.path}
                </span>
                <Button size="small" onClick={() => setBlame(false)}>
                  {t("editor.history")}
                </Button>
              </header>
              <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-xs">
                {h.loading ? (
                  loading
                ) : h.blame.length ? (
                  h.blame.map((line) => (
                    <div
                      key={line.line}
                      className="flex gap-4 whitespace-pre py-1"
                      title={`${line.author} · ${line.summary}`}
                    >
                      <span className="shrink-0 text-[var(--editor-muted)]">
                        {line.id.slice(0, 7)}
                      </span>
                      <span className="w-24 shrink-0 truncate text-[var(--editor-muted)]">
                        {line.author}
                      </span>
                      <span className="w-8 shrink-0 text-right text-[var(--editor-muted)]">
                        {line.line}
                      </span>
                      <span>{line.content}</span>
                    </div>
                  ))
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("editor.noResults")} />
                )}
                {h.blameTruncated && (
                  <p className="mt-4 text-[var(--editor-muted)]">{t("editor.searchLimited")}</p>
                )}
              </div>
            </>
          ) : h.current ? (
            <>
              <header className="flex shrink-0 flex-col gap-3 border-b border-[var(--editor-border)] px-6 py-5">
                <h3 className="m-0 break-words text-base font-semibold leading-6">
                  {h.current.subject}
                </h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--editor-muted)]">
                  <span className="inline-flex items-center gap-2">
                    <UserOutlined />
                    {h.current.author}
                  </span>
                  <time dateTime={h.current.date}>{formatDateTime(h.current.date)}</time>
                  <Typography.Text
                    copyable={{ text: h.current.id }}
                    className="!text-xs !text-[var(--editor-muted)]"
                  >
                    <span className="font-mono" title={h.current.id}>
                      {h.current.id.slice(0, 8)}
                    </span>
                  </Typography.Text>
                  {h.path && (
                    <Button type="link" size="small" onClick={() => setBlame(true)}>
                      {t("editor.blame")}
                    </Button>
                  )}
                </div>
              </header>
              {!h.detailLoading && !h.detailError && h.changed.length > 0 && (
                <div className="flex shrink-0 items-center gap-3 border-b border-[var(--editor-border)] px-4 py-3">
                  <FileTextOutlined className="text-[var(--editor-muted)]" />
                  <Select
                    className="min-w-0 flex-1"
                    aria-label={t("editor.historyFiles")}
                    value={h.file}
                    showSearch={{ optionFilterProp: "label" }}
                    options={h.changed.map((path) => ({ value: path, label: path }))}
                    onChange={h.selectFile}
                  />
                  <span className="shrink-0 text-xs text-[var(--editor-muted)]">
                    {t("editor.historyFileCount", { count: h.changed.length })}
                  </span>
                </div>
              )}
              <div className="min-h-0 flex-1" aria-busy={h.detailLoading || h.diffLoading}>
                {h.detailLoading || h.diffLoading ? (
                  loading
                ) : error ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 overflow-auto p-6">
                    <Alert
                      type="warning"
                      showIcon
                      title={t("editor.historyUnavailable")}
                      description={<span className="break-all">{error}</span>}
                    />
                    <Button onClick={h.retry}>{t("editor.historyRetry")}</Button>
                  </div>
                ) : h.diff ? (
                  <Suspense fallback={loading}>
                    <EditorDiff
                      {...h.diff}
                      kind="history"
                      revision={h.current.id}
                      embedded
                      dark={dark}
                      close={h.close}
                      sideBySide={sideBySide}
                      onSideChange={setSideBySide}
                    />
                  </Suspense>
                ) : (
                  <div className="flex h-full items-center justify-center p-6">
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description={t("editor.historyNoFiles")}
                    />
                  </div>
                )}
              </div>
            </>
          ) : h.loading ? (
            loading
          ) : (
            <div className="flex h-full items-center justify-center p-6">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("editor.historyEmpty")} />
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
