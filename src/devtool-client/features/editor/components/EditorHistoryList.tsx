import { Button, Empty, Spin, theme } from "antd";
import { useI18n } from "../../../app/i18n.js";
import type { useEditorHistory } from "../hooks/useEditorHistory.js";
import { gitGraph } from "../utils/gitGraph.js";

export default function EditorHistoryList({
  history: h,
}: {
  history: ReturnType<typeof useEditorHistory>;
}) {
  const { t, locale, formatDateTime } = useI18n();
  const { token } = theme.useToken();
  const graph = gitGraph(h.commits);
  const graphWidth = Math.max(24, ...graph.map((row) => row.width));
  const colors = [token.colorPrimary, token.colorInfo, token.colorSuccess, token.colorWarning];
  const shortDate = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  return (
    <aside
      className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--editor-panel)]"
      aria-label={t("editor.history")}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-[var(--editor-border)] px-4 text-xs text-[var(--editor-muted)]">
        <span>{t("editor.allBranches")}</span>
        <span>{t("editor.historyCount", { count: h.commits.length })}</span>
      </div>
      <nav
        className="min-h-0 flex-1 overflow-auto py-2"
        aria-label={t("editor.selectCommit")}
        aria-busy={h.loading}
      >
        {!h.commits.length && !h.error && (
          <div className="flex h-full min-h-24 items-center justify-center p-4">
            {h.loading ? (
              <Spin />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("editor.historyEmpty")} />
            )}
          </div>
        )}
        {h.commits.map((commit, index) => {
          const row = graph[index]!;
          const active = h.current?.id === commit.id;
          return (
            <Button
              key={commit.id}
              type="text"
              block
              className="editor-history-row"
              styles={{
                root: {
                  display: "flex",
                  height: 64,
                  padding: 0,
                  border: 0,
                  borderRadius: 0,
                  color: token.colorText,
                  background: active ? token.colorPrimaryBg : undefined,
                },
              }}
              aria-current={active ? "true" : undefined}
              title={`${commit.subject}\n${commit.id}\n${commit.author} · ${formatDateTime(commit.date)}`}
              onClick={() => h.select(commit.id)}
            >
              <div className="flex h-full w-full min-w-0 items-start gap-2 pl-3 pr-4 text-left">
                <svg width={graphWidth} height={64} className="shrink-0" aria-hidden="true">
                  {row.incoming && (
                    <path
                      d={`M ${row.column * 12 + 8} 0 V 20`}
                      stroke={colors[row.column % colors.length]}
                      fill="none"
                      strokeWidth={1.5}
                    />
                  )}
                  {row.edges.map((edge, edgeIndex) => (
                    <path
                      key={edgeIndex}
                      d={`M ${edge.from * 12 + 8} ${edge.parent ? 20 : 0} C ${edge.from * 12 + 8} 44 ${edge.to * 12 + 8} 44 ${edge.to * 12 + 8} 64`}
                      stroke={colors[edge.to % colors.length]}
                      fill="none"
                      strokeWidth={1.5}
                    />
                  ))}
                  {active && (
                    <circle
                      cx={row.column * 12 + 8}
                      cy={20}
                      r={6}
                      fill="var(--editor-selection)"
                      stroke={token.colorPrimary}
                    />
                  )}
                  <circle
                    cx={row.column * 12 + 8}
                    cy={20}
                    r={3}
                    fill={colors[row.column % colors.length]}
                  />
                </svg>
                <div className="min-w-0 flex-1 py-2">
                  <div className="truncate text-sm font-medium leading-6">{commit.subject}</div>
                  <div className="flex min-w-0 items-center gap-2 text-xs leading-5 text-[var(--editor-muted)]">
                    <span className="shrink-0 font-mono">{commit.id.slice(0, 7)}</span>
                    <span className="min-w-0 flex-1 truncate">{commit.author}</span>
                    <time className="shrink-0" dateTime={commit.date}>
                      {shortDate.format(new Date(commit.date))}
                    </time>
                  </div>
                </div>
              </div>
            </Button>
          );
        })}
      </nav>
      {(h.hasMore || h.error) && (
        <div className="shrink-0 border-t border-[var(--editor-border)] p-3">
          {h.error && (
            <p role="alert" className="mb-2 break-words text-xs text-[var(--ant-color-error-text)]">
              {h.error}
            </p>
          )}
          <Button
            block
            loading={h.loading}
            onClick={() => void h.loadHistory(h.commits.length, "", h.path)}
          >
            {t(h.error ? "editor.historyRetry" : "editor.moreHistory")}
          </Button>
        </div>
      )}
    </aside>
  );
}
