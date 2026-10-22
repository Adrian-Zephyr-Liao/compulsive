import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Alert, Segmented, Spin, Splitter, Tag, Typography } from "antd";
import { DiffOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useNavigate, useSearchParams } from "react-router";
import { useI18n } from "../../app/i18n.js";
import { useAppearance } from "../../app/appearance.js";
import type { DevtoolWorkspace } from "../../../devtool.js";
import type { WorkspaceRpc } from "../workspaces/types.js";
import { useEditorWorkbench } from "./hooks/useEditorWorkbench.js";
import { useEditorFileActions } from "./hooks/useEditorFileActions.js";
import { useEditorSearch } from "./hooks/useEditorSearch.js";
import { useEditorGit } from "./hooks/useEditorGit.js";
import { useEditorTerminals } from "./hooks/useEditorTerminals.js";
import EditorSidebar from "./components/EditorSidebar.js";
import EditorColumns from "./components/EditorColumns.js";
import type { EditorNavigation, EditorSidebarMode, EditorViewMode } from "./types.js";
import { editorViewMode } from "./utils/gitChanges.js";
import EditorReview from "./components/EditorReview.js";
import { useEditorCommands } from "./hooks/useEditorCommands.js";
import EditorPalette from "./components/EditorPalette.js";
import EditorFileDialog from "./components/EditorFileDialog.js";
import EditorPreferences from "./components/EditorPreferences.js";
import {
  EditorTitlebar,
  EditorRepositoryRail,
  EditorStatusBar,
} from "./components/EditorChrome.js";
import EditorTerminalDock from "./components/EditorTerminalDock.js";
const EditorDiff = lazy(() => import("./components/EditorDiff.js"));
interface Props {
  connected?: boolean | undefined;
  onWorkspaceChanged?: (() => Promise<void>) | undefined;
  workspace: DevtoolWorkspace;
  repositoryId: string;
  getRpc: () => Promise<WorkspaceRpc>;
  onOpenVscode: (id: string) => void;
  onThemeChange: (dark: boolean) => void;
  themeBusy?: boolean | undefined;
}
export default function EditorWorkspace({
  workspace,
  repositoryId,
  getRpc,
  onOpenVscode,
  onThemeChange,
  themeBusy = false,
  connected = true,
  onWorkspaceChanged,
}: Props) {
  const { t } = useI18n();
  const { dark } = useAppearance();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const scope = useMemo(
    () => ({ workspaceId: workspace.id, repositoryId }),
    [workspace.id, repositoryId],
  );
  const editor = useEditorWorkbench(getRpc, scope, params.get("file") ?? "", connected);
  const [mode, setSidebarMode] = useState<EditorSidebarMode>("files");
  const viewing = editorViewMode(params);
  const reviewing = viewing === "changes";
  const setView = (view: EditorViewMode) => {
    const next = new URLSearchParams(params);
    next.set("view", view);
    if (view === "changes") next.delete("file");
    else if (editor.tab) next.set("file", editor.tab.path);
    setParams(next, { replace: true });
  };
  const setMode = (nextMode: EditorSidebarMode) => {
    setSidebarMode(nextMode);
    setView("files");
  };
  const [sidebar, setSidebar] = useState(true);
  const [palette, setPalette] = useState<string>();
  const [settings, setSettings] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const showTerminal = (value: boolean | ((open: boolean) => boolean)) => {
    setView("files");
    setTerminalOpen(reviewing ? true : value);
  };
  const [navigation, setNavigation] = useState<EditorNavigation>();
  const fileActions = useEditorFileActions(
    getRpc,
    scope,
    editor.documents,
    editor.refresh,
    editor.report,
  );
  const search = useEditorSearch(
    getRpc,
    scope,
    editor.dirty.map((d) => d.path),
    editor.report,
    editor.refresh,
  );
  const git = useEditorGit(
    getRpc,
    scope,
    editor.dirty.map((d) => d.path),
    editor.report,
    () => {
      editor.refresh();
      void onWorkspaceChanged?.().catch(editor.report);
      for (const path of Object.keys(editor.docsRef.current))
        void editor.loadDocument(path, "refresh").catch(editor.report);
    },
  );
  const terminals = useEditorTerminals(getRpc, workspace.id, repositoryId, editor.report);
  const member = workspace.members.find((m) => m.repositoryId === repositoryId)!;
  const urlFile = params.get("file") ?? "";
  useEffect(() => {
    if (editor.ready && urlFile && editor.tab?.path !== urlFile) void editor.open(urlFile, true);
  }, [urlFile, editor.ready]);
  useEffect(() => {
    if (!reviewing && editor.ready && editor.tab?.path && urlFile !== editor.tab.path)
      setParams({ view: "files", file: editor.tab.path }, { replace: true });
  }, [editor.tab?.path, editor.ready, reviewing]);
  const open = (path: string, pinned = false) => {
    setParams({ view: "files", file: path }, { replace: true });
    void editor.open(path, pinned);
  };
  const go = (path: string, line = 1, column = 1) => {
    open(path, true);
    setNavigation({ path, line, column, columnId: editor.active.id, id: Date.now() });
  };
  const commands = useEditorCommands({
    editor: {
      ...editor,
      split: () => {
        setView("files");
        editor.split();
      },
    },
    git,
    terminals,
    setPalette,
    setSidebar,
    setMode,
    setTerminalOpen: showTerminal,
    setSettings,
  });
  async function leave(path: string) {
    void navigate(path);
  }
  const terminal = (
    <EditorTerminalDock
      editor={editor}
      terminals={terminals}
      terminalOpen={terminalOpen}
      setTerminalOpen={setTerminalOpen}
    />
  );
  const terminalInEditor = terminalOpen && editor.preferences.terminalPlacement === "editor";
  const dockOpen = terminalOpen && !terminalInEditor;
  const code = (
    <EditorColumns
      editor={editor}
      navigation={navigation}
      terminal={terminalInEditor ? terminal : undefined}
    />
  );
  const editors = (
    <Splitter
      key={editor.preferences.terminalPlacement}
      orientation={editor.preferences.terminalPlacement === "bottom" ? "vertical" : "horizontal"}
      onResizeEnd={(sizes) => {
        if (dockOpen && sizes[1])
          editor.setPreferences((p) => ({
            ...p,
            panelSize: Math.max(100, Math.min(900, sizes[1]!)),
          }));
      }}
    >
      <Splitter.Panel min={160} {...(!dockOpen ? { size: "100%" } : {})}>
        {code}
      </Splitter.Panel>
      <Splitter.Panel
        min={dockOpen ? 100 : 0}
        size={dockOpen ? editor.preferences.panelSize : 0}
        resizable={dockOpen}
      >
        {terminalInEditor ? null : terminal}
      </Splitter.Panel>
    </Splitter>
  );
  return (
    <section
      className={`cpl-editor flex h-full min-h-0 flex-col ${dark ? "editor-dark" : "editor-light"}`}
      aria-label={t("editor.title")}
    >
      <EditorTitlebar
        workspace={workspace}
        member={member}
        editor={{
          ...editor,
          split: () => {
            setView("files");
            editor.split();
          },
        }}
        leave={leave}
        setPalette={setPalette}
        setTerminalOpen={showTerminal}
        setSettings={setSettings}
      />
      {editor.error && (
        <Alert
          banner
          type="error"
          showIcon
          title={<span className="whitespace-pre-wrap break-words">{editor.error}</span>}
          closable={{ "aria-label": t("editor.closeError"), afterClose: () => editor.setError("") }}
        />
      )}
      <div className="flex min-h-0 flex-1">
        <EditorRepositoryRail
          workspace={workspace}
          repositoryId={repositoryId}
          leave={leave}
          onOpenVscode={onOpenVscode}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--editor-border)] px-4 py-2">
            <Segmented<EditorViewMode>
              value={viewing}
              onChange={setView}
              aria-label={t("editor.reviewView")}
              options={[
                { value: "changes", label: t("editor.reviewChanges"), icon: <DiffOutlined /> },
                { value: "files", label: t("editor.allFiles"), icon: <FolderOpenOutlined /> },
              ]}
            />
            {reviewing && (
              <span className="text-xs text-[var(--editor-muted)]">
                {editor.dirty.length ? (
                  <Tag color="warning">
                    {t("editor.reviewUnsaved", { count: editor.dirty.length })}
                  </Tag>
                ) : (
                  t("editor.reviewDisk")
                )}
              </span>
            )}
          </div>
          {git.recovery && (
            <Alert
              banner
              type="success"
              showIcon
              closable={{ afterClose: () => git.setRecovery("") }}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {t("editor.discardAllDone")}
                  <Typography.Text
                    code
                    copyable
                  >{`git stash apply --index ${git.recovery}`}</Typography.Text>
                </span>
              }
            />
          )}
          <div
            className={reviewing ? "min-h-0 flex-1" : "hidden"}
            aria-hidden={!reviewing}
            inert={!reviewing}
          >
            <EditorReview
              active={reviewing}
              getRpc={getRpc}
              scope={scope}
              git={git}
              dark={dark}
              onOpen={(path) => open(path, true)}
              onAllFiles={() => setView("files")}
              onOpenVscode={() => onOpenVscode(repositoryId)}
              report={editor.report}
              onCommit={() => {
                setSidebar(true);
                setMode("sourceControl");
              }}
            />
          </div>
          <div
            className={reviewing ? "hidden" : "min-h-0 flex-1"}
            aria-hidden={reviewing}
            inert={reviewing}
          >
            <Splitter
              onResizeEnd={(sizes) => {
                if (sizes[0] && sidebar)
                  editor.setPreferences((p) => ({
                    ...p,
                    sidebarWidth: Math.max(160, Math.min(600, sizes[0]!)),
                  }));
              }}
            >
              <Splitter.Panel
                min={sidebar ? 160 : 0}
                max={600}
                size={sidebar ? editor.preferences.sidebarWidth : 0}
                resizable={sidebar}
              >
                <EditorSidebar
                  visible={sidebar}
                  mode={mode}
                  onModeChange={setMode}
                  name={member.alias}
                  editor={editor}
                  git={git}
                  search={search}
                  open={open}
                  go={go}
                  onFileAction={(a, p) => void fileActions.action(a, p)}
                  dark={dark}
                />
              </Splitter.Panel>
              <Splitter.Panel min={300}>{editors}</Splitter.Panel>
            </Splitter>
          </div>
        </div>
      </div>
      <EditorStatusBar
        git={git}
        member={member}
        editor={editor}
        connected={connected}
        onGit={() => {
          setSidebar(true);
          setMode("sourceControl");
        }}
        onSettings={() => setSettings(true)}
      />
      <EditorPalette
        open={palette !== undefined}
        initial={palette ?? ""}
        close={() => setPalette(undefined)}
        commands={commands}
        recent={editor.recent}
        record={(id) =>
          editor.setRecent((all) => [id, ...all.filter((item) => item !== id)].slice(0, 50))
        }
        getRpc={getRpc}
        scope={scope}
        content={editor.tab ? (editor.documents[editor.tab.path]?.content ?? "") : ""}
        path={editor.tab?.path ?? ""}
        onFile={(path, line) => (line ? go(path, line) : open(path, true))}
        report={editor.report}
      />
      <EditorPreferences
        dark={dark}
        onThemeChange={onThemeChange}
        themeBusy={themeBusy}
        open={settings}
        close={() => setSettings(false)}
        value={editor.preferences}
        onChange={editor.setPreferences}
      />
      {editor.comparison && (
        <Suspense fallback={<Spin />}>
          <EditorDiff
            {...editor.comparison}
            dark={dark}
            close={() => editor.setComparison(undefined)}
          />
        </Suspense>
      )}
      <EditorFileDialog fileActions={fileActions} />
    </section>
  );
}
