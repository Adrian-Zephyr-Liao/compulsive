import { useEffect, useMemo, useRef, useState } from "react";
import { Empty, Input, Modal, Spin } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import { fuzzyPaths } from "../utils/editorState.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type { EditorCommand, EditorScope } from "../types.js";
interface Props {
  open: boolean;
  initial: string;
  close: () => void;
  commands: EditorCommand[];
  recent: string[];
  record: (id: string) => void;
  getRpc: () => Promise<WorkspaceRpc>;
  scope: EditorScope;
  content: string;
  path: string;
  onFile: (path: string, line?: number) => void;
  report: (e: unknown) => void;
}
export default function EditorPalette(props: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [paths, setPaths] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [loading, setLoading] = useState(false);
  const active = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!props.open) return;
    setQuery(props.initial);
    setSelected(0);
    setLoading(true);
    let valid = true;
    void props
      .getRpc()
      .then((rpc) => rpc.call("index-project-files", props.scope))
      .then((index) => {
        if (valid) setPaths(index.files);
      })
      .catch(props.report)
      .finally(() => {
        if (valid) setLoading(false);
      });
    return () => {
      valid = false;
    };
  }, [props.open, props.initial, props.getRpc, props.scope.workspaceId, props.scope.repositoryId]);
  const rows = useMemo(() => {
    if (query.startsWith(">"))
      return props.commands
        .filter((c) =>
          `${t(c.label)} ${c.id}`.toLowerCase().includes(query.slice(1).trim().toLowerCase()),
        )
        .sort((a, b) => {
          const ai = props.recent.indexOf(a.id),
            bi = props.recent.indexOf(b.id);
          return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
        })
        .map((c) => ({
          id: c.id,
          label: t(c.label),
          detail: c.shortcut,
          run: () => {
            props.record(c.id);
            c.run();
          },
        }));
    if (query.startsWith(":")) {
      const line = Number(query.slice(1));
      return Number.isInteger(line) && line > 0 && props.path
        ? [
            {
              id: "line",
              label: `${t("editor.goLine")} ${line}`,
              detail: props.path,
              run: () => props.onFile(props.path, line),
            },
          ]
        : [];
    }
    if (query.startsWith("@")) {
      // shortcut: syntax-neutral symbol hints; replace with language-server symbols when LSP is added.
      return props.content
        .split("\n")
        .map((line, index) => ({ line, index }))
        .filter(
          (row) =>
            /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const|let|def|fn|func|struct)\s+/.test(
              row.line,
            ) && row.line.toLowerCase().includes(query.slice(1).toLowerCase()),
        )
        .slice(0, 100)
        .map((row) => ({
          id: `symbol-${row.index}`,
          label: row.line.trim(),
          detail: String(row.index + 1),
          run: () => props.onFile(props.path, row.index + 1),
        }));
    }
    return fuzzyPaths(paths, query).map((path) => ({
      id: path,
      label: path.split("/").pop() ?? path,
      detail: path,
      run: () => props.onFile(path),
    }));
  }, [query, paths, props.commands, props.recent, props.path, props.content, t]);
  useEffect(() => {
    setSelected(0);
  }, [query]);
  useEffect(() => {
    // Scrolling can return a Promise, not an effect cleanup function.
    active.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const choose = (index: number) => {
    props.close();
    rows[index]?.run();
  };
  return (
    <Modal
      open={props.open}
      footer={null}
      closable={false}
      width={620}
      style={{ top: 48 }}
      onCancel={props.close}
      classNames={{ body: "!p-0" }}
      destroyOnHidden
    >
      <Input
        autoFocus
        variant="borderless"
        prefix={<SearchOutlined />}
        placeholder={t("editor.quickOpen")}
        value={query}
        role="combobox"
        aria-expanded
        aria-controls="editor-palette-results"
        aria-activedescendant={rows[selected] ? `editor-palette-${selected}` : undefined}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((i) => Math.min(rows.length - 1, i + 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((i) => Math.max(0, i - 1));
          }
          if (e.key === "Enter") {
            e.preventDefault();
            choose(selected);
          }
        }}
        className="!h-12 !px-4"
      />
      <div
        role="listbox"
        id="editor-palette-results"
        className="max-h-[55vh] overflow-auto border-y border-[var(--editor-border)] py-1"
      >
        {loading && (
          <div className="p-3 text-center">
            <Spin size="small" />
          </div>
        )}
        {!loading && !rows.length && (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("editor.noResults")} />
        )}
        {rows.map((row, index) => (
          <button
            key={row.id}
            ref={index === selected ? active : undefined}
            id={`editor-palette-${index}`}
            role="option"
            aria-selected={index === selected}
            className={`editor-result flex min-h-10 w-full items-center justify-between gap-4 px-4 py-2 text-left text-sm ${index === selected ? "bg-[var(--editor-selection)]" : ""}`}
            onMouseEnter={() => setSelected(index)}
            onClick={() => choose(index)}
          >
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="min-w-0 max-w-[55%] truncate text-xs text-[var(--editor-muted)]">
              {row.detail}
            </span>
          </button>
        ))}
      </div>
      <div className="flex justify-between px-4 py-2 text-xs text-[var(--editor-muted)]">
        <span>
          {t("editor.navigate")} · {t("editor.enter")}
        </span>
        <span>{t("editor.escape")}</span>
      </div>
    </Modal>
  );
}
