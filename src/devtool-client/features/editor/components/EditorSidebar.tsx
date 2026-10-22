import { Segmented } from "antd";
import { BranchesOutlined, FileOutlined, SearchOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import type { EditorSidebarMode, FileAction } from "../types.js";
import type { useEditorWorkbench } from "../hooks/useEditorWorkbench.js";
import type { useEditorGit } from "../hooks/useEditorGit.js";
import type { useEditorSearch } from "../hooks/useEditorSearch.js";
import EditorExplorer from "./EditorExplorer.js";
import EditorSearch from "./EditorSearch.js";
import EditorGit from "./EditorGit.js";

export default function EditorSidebar({
  visible,
  mode,
  onModeChange,
  name,
  editor,
  git,
  search,
  open,
  go,
  onFileAction,
  dark,
}: {
  visible: boolean;
  mode: EditorSidebarMode;
  onModeChange: (mode: EditorSidebarMode) => void;
  name: string;
  editor: ReturnType<typeof useEditorWorkbench>;
  git: ReturnType<typeof useEditorGit>;
  search: ReturnType<typeof useEditorSearch>;
  open: (path: string, pinned?: boolean) => void;
  go: (path: string, line: number, column: number) => void;
  onFileAction: (action: FileAction, path: string) => void;
  dark: boolean;
}) {
  const { t } = useI18n();
  return (
    <aside
      className="flex h-full min-h-0 flex-col bg-[var(--editor-panel)]"
      aria-hidden={!visible}
      inert={!visible}
    >
      <div className="shrink-0 border-b border-[var(--editor-border)] p-2">
        <Segmented
          block
          aria-label={t("editor.title")}
          value={mode}
          onChange={onModeChange}
          options={(
            [
              { key: "files", icon: <FileOutlined /> },
              { key: "search", icon: <SearchOutlined /> },
              { key: "sourceControl", icon: <BranchesOutlined /> },
            ] as const
          ).map((item) => ({
            value: item.key,
            icon: item.icon,
            label: <span className="sr-only">{t(`editor.${item.key}`)}</span>,
            tooltip: t(`editor.${item.key}`),
          }))}
        />
      </div>
      <div className="min-h-0 flex-1">
        {mode === "files" ? (
          <EditorExplorer
            directories={editor.directories}
            loading={editor.loading}
            path={editor.tab?.path ?? ""}
            changes={git.status?.changes ?? []}
            load={editor.loadDirectory}
            open={open}
            action={onFileAction}
            refresh={editor.refresh}
            report={editor.report}
            name={name}
          />
        ) : mode === "search" ? (
          <EditorSearch search={search} open={go} report={editor.report} />
        ) : (
          <EditorGit
            git={git}
            dark={dark}
            report={editor.report}
            open={(path) => open(path, true)}
          />
        )}
      </div>
    </aside>
  );
}
