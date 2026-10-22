import { Button, Modal } from "antd";
import { useI18n } from "../../../app/i18n.js";
import type { useEditorGit } from "../hooks/useEditorGit.js";
import { gitGraph } from "../utils/gitGraph.js";

export default function EditorGitHistory({ git: g }: { git: ReturnType<typeof useEditorGit> }) {
  const { t, formatDateTime } = useI18n();
  const graph = gitGraph(g.history?.commits ?? []);
  const graphWidth = Math.max(20, ...graph.map((row) => row.width));
  const graphColor = (column: number) =>
    ["#ad91e8", "#7faad9", "#8bb995", "#d3b37a", "#cf91a6", "#7abbbf"][column % 6]!;
  return (
    <Modal
      open={g.historyOpen}
      title={t("editor.history")}
      width={900}
      footer={null}
      onCancel={() => g.setHistoryOpen(false)}
    >
      <div className="mt-4 grid max-h-[65vh] grid-cols-[minmax(0,1fr)_260px] gap-4 overflow-auto">
        <div>
          {g.history?.commits.map((commit, index) => (
            <button
              key={commit.id}
              className="editor-result flex h-15 w-full items-center gap-3 border-b border-[var(--editor-border)] px-2 text-left text-xs"
              onClick={() => void g.loadHistory(0, commit.id)}
            >
              <svg width={graphWidth} height={60} className="shrink-0" aria-hidden="true">
                {graph[index]?.incoming && (
                  <path
                    d={`M${8 + graph[index]!.column * 12} 0V20`}
                    fill="none"
                    stroke={graphColor(graph[index]!.column)}
                  />
                )}
                {graph[index]?.edges.map((edge, i) => (
                  <path
                    key={i}
                    d={`M${8 + edge.from * 12} ${edge.parent ? 20 : 0}C${8 + edge.from * 12} 40 ${8 + edge.to * 12} 40 ${8 + edge.to * 12} 60`}
                    fill="none"
                    stroke={graphColor(edge.from)}
                  />
                ))}
                <circle
                  cx={8 + (graph[index]?.column ?? 0) * 12}
                  cy={20}
                  r={3.5}
                  fill={graphColor(graph[index]?.column ?? 0)}
                />
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{commit.subject}</span>
                <span className="mt-1 block truncate text-[var(--editor-muted)]">
                  {commit.id.slice(0, 8)} · {commit.author} · {formatDateTime(commit.date)}
                </span>
              </span>
            </button>
          ))}
          <Button
            className="!mt-3"
            loading={g.busy}
            onClick={() => void g.loadHistory(g.history?.commits.length ?? 0)}
          >
            {t("editor.moreHistory")}
          </Button>
        </div>
        <div>
          {g.revision && (
            <p className="mb-3 text-xs text-[var(--editor-accent)]">
              {t("editor.selectedCommit", { hash: g.revision.slice(0, 8) })}
            </p>
          )}
          {g.history?.changed.map((path) => (
            <button
              key={path}
              className="editor-result block w-full truncate px-2 py-2 text-left text-xs"
              title={path}
              onClick={() => void g.inspect(path, false, g.revision)}
            >
              {path}
            </button>
          ))}
          {Boolean(g.history?.blame.length) && (
            <div className="max-h-[55vh] overflow-auto">
              {g.history?.blame.map((line) => (
                <div
                  key={line.line}
                  className="border-b border-[var(--editor-border)] py-2 text-xs"
                  title={`${line.id}\n${line.summary}`}
                >
                  <div className="mb-1 flex gap-2 text-[var(--editor-muted)]">
                    <span>{line.line}</span>
                    <code>{line.id.slice(0, 8)}</code>
                    <span className="truncate">{line.author}</span>
                  </div>
                  <pre className="overflow-x-auto">{line.content}</pre>
                </div>
              ))}
              {g.history?.blameTruncated && <p>{t("editor.searchLimited")}</p>}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
