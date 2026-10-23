import type { EditorScope } from "../types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorDocuments } from "./useEditorDocuments.js";
import { useEditorGuards } from "./useEditorGuards.js";
import type { EditorState, EditorView } from "@uiw/react-codemirror";
import type { ProjectDirectory } from "../../../../project/files.js";
import type { EditorPreferences, EditorSession } from "../../../../project/session.js";
import { defaultEditorPreferences } from "../utils/editorState.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import { describeError } from "../../workspaces/utils/errors.js";
import { useI18n } from "../../../app/i18n.js";
import {
  openEditorTab,
  closeEditorTab,
  tabId,
  pruneEditorStates,
  changedEditorDirectories,
  type EditorColumn,
  type EditorTab,
} from "../utils/editorState.js";

export function useEditorWorkbench(
  getRpc: () => Promise<WorkspaceRpc>,
  scope: EditorScope,
  initialPath: string,
  connected = true,
  initialDiff?: EditorTab["diff"],
) {
  const { t } = useI18n();
  const {
    documents,
    docsRef,
    updateDocuments,
    alive,
    loadDocument,
    save,
    saveAll,
    editDocument,
    comparison,
    setComparison,
    compare,
    dirty,
  } = useEditorDocuments(getRpc, scope);
  const [columns, setColumns] = useState<EditorColumn[]>([{ id: "first", active: "", tabs: [] }]);
  const [activeColumn, setActiveColumn] = useState("first");
  useEffect(() => {
    if (!columns.some((c) => c.id === activeColumn)) setActiveColumn(columns[0]!.id);
  }, [columns, activeColumn]);
  const [preferences, setPreferences] = useState<EditorPreferences>(defaultEditorPreferences);
  const [directories, setDirectories] = useState<Record<string, ProjectDirectory>>({});
  const directoriesRef = useRef(directories);
  directoriesRef.current = directories;
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [columnSizes, setColumnSizes] = useState<number[]>([]);
  const states = useRef(new Map<string, EditorState>());
  const views = useRef(new Map<string, EditorView>());
  const closed = useRef<EditorTab[]>([]);
  const { workspaceId, repositoryId } = scope;
  const loadDirectory = useCallback(
    async (path: string) => {
      const result = await (
        await getRpc()
      ).call("list-project-directory", { workspaceId, repositoryId, path });
      if (alive.current) setDirectories((current) => ({ ...current, [path]: result }));
    },
    [getRpc, workspaceId, repositoryId],
  );
  const report = useCallback((failure: unknown) => {
    if (alive.current) setError(describeError(failure));
  }, []);
  useEffect(() => {
    setLoading(true);
    void Promise.all([
      loadDirectory(""),
      (async () => {
        const saved = await (
          await getRpc()
        ).call("get-editor-session", { workspaceId, repositoryId });
        if (!alive.current) return;
        let next = saved.session?.columns.length
          ? saved.session.columns
          : [{ id: "first", active: "", tabs: [] }];
        if (saved.session) {
          setPreferences(saved.session.preferences);
          setRecent(saved.session.recent);
          setColumnSizes(saved.session.columnSizes);
        }
        if (initialPath)
          next = openEditorTab(next, next[0]!.id, initialPath, true, false, [], initialDiff);
        setColumns(next);
        setActiveColumn(next[0]!.id);
        const paths = [
          ...new Set(next.flatMap((c) => c.tabs.filter((tab) => !tab.diff).map((tab) => tab.path))),
        ].slice(0, 50);
        await Promise.all(paths.map((path) => loadDocument(path).catch(report)));
      })(),
    ])
      .catch(report)
      .finally(() => {
        if (alive.current) {
          setReady(true);
          setLoading(false);
        }
      });
  }, [getRpc, workspaceId, repositoryId, loadDirectory, loadDocument, report]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      const session: EditorSession = { preferences, columns, recent, columnSizes };
      void getRpc()
        .then((rpc) => rpc.call("save-editor-session", { workspaceId, repositoryId, session }))
        .catch(report);
    }, 500);
    return () => clearTimeout(timer);
  }, [ready, preferences, columns, recent, columnSizes, getRpc, workspaceId, repositoryId, report]);
  useEffect(() => {
    if (!connected) return;
    let active = true;
    let cursor = 0;
    const loop = async () => {
      while (active) {
        try {
          const event = await (
            await getRpc()
          ).call("wait-project-files", { workspaceId, repositoryId, cursor });
          cursor = event.cursor;
          if (!active) return;
          if (event.paths.length) {
            const keys = Object.keys(docsRef.current).filter((path) =>
              event.paths.some(
                (changed) => !changed || path === changed || path.startsWith(`${changed}/`),
              ),
            );
            for (const path of keys) await loadDocument(path, "refresh").catch(report);
            for (const path of changedEditorDirectories(
              Object.keys(directoriesRef.current),
              event.paths,
            ))
              await loadDirectory(path).catch(report);
          }
        } catch (failure) {
          if (active) {
            report(failure);
            return;
          }
        }
      }
    };
    void loop();
    return () => {
      active = false;
    };
  }, [getRpc, workspaceId, repositoryId, loadDirectory, loadDocument, report, connected]);
  const { confirmDiscard } = useEditorGuards({
    dirtyCount: dirty.length,
    docsRef,
    save,
    saveAll,
    report,
  });
  useEffect(() => {
    if (!ready) return;
    pruneEditorStates(columns, states.current);
    const openPaths = new Set(
      columns.flatMap((c) => c.tabs.filter((tab) => !tab.diff).map((tab) => tab.path)),
    );
    updateDocuments((current) => {
      const entries = Object.entries(current).filter(
        ([path, doc]) => openPaths.has(path) || doc.content !== doc.saved,
      );
      if (entries.length === Object.keys(current).length) return current;
      const next = Object.fromEntries(entries);
      return next;
    });
  }, [columns, ready]);
  useEffect(() => {
    if (!preferences.autoSave || !dirty.length) return;
    const timer = setTimeout(() => void saveAll().catch(report), 1200);
    return () => clearTimeout(timer);
  }, [preferences.autoSave, documents]);
  async function open(path: string, pinned = false, preview = false, column = activeColumn) {
    if (Object.keys(docsRef.current).length >= 50 && !docsRef.current[path]) {
      setError(t("editor.documentLimit"));
      return;
    }
    setError("");
    setColumns((current) =>
      openEditorTab(
        current,
        column,
        path,
        pinned,
        preview,
        Object.values(docsRef.current)
          .filter((d) => d.saved !== d.content)
          .map((d) => d.path),
      ),
    );
    await loadDocument(path).catch(report);
    const parents = path.split("/").slice(0, -1);
    await Promise.all(
      parents.slice(0, 32).map((_, i) => loadDirectory(parents.slice(0, i + 1).join("/"))),
    ).catch(report);
  }
  function edit(path: string, content: string) {
    editDocument(path, content);
    setColumns((current) =>
      current.map((c) => ({
        ...c,
        tabs: c.tabs.map((tab) => (tab.path === path ? { ...tab, pinned: true } : tab)),
      })),
    );
  }
  function openDiff(path: string, staged: boolean, column = activeColumn) {
    setColumns((current) =>
      openEditorTab(
        current,
        column,
        path,
        true,
        false,
        dirty.map((d) => d.path),
        staged ? "staged" : "working",
      ),
    );
  }
  async function close(column: string, id: string) {
    const tab = columns.find((c) => c.id === column)?.tabs.find((tab) => tabId(tab) === id);
    if (!tab) return;
    const other = columns.some((c) =>
      c.tabs.some((t) => !t.diff && t.path === tab.path && (c.id !== column || tabId(t) !== id)),
    );
    if (!tab.diff && !other && !(await confirmDiscard(tab.path))) return;
    closed.current.push(tab);
    closed.current = closed.current.slice(-20);
    setColumns((current) => closeEditorTab(current, column, id));
    if (!tab.diff && !other) {
      updateDocuments((current) => {
        const next = { ...current };
        delete next[tab.path];
        return next;
      });
    }
  }
  async function reopen() {
    const tab = closed.current.pop();
    if (tab?.diff) openDiff(tab.path, tab.diff === "staged");
    else if (tab) await open(tab.path, true, tab.preview);
  }
  function split() {
    if (columns.length >= 8) return;
    const current = columns.find((c) => c.id === activeColumn);
    const tab = current?.tabs.find((t) => tabId(t) === current.active);
    const id = crypto.randomUUID();
    setColumns((all) => [
      ...all,
      { id, active: tab ? tabId(tab) : "", tabs: tab ? [{ ...tab, pinned: true }] : [] },
    ]);
    setActiveColumn(id);
  }
  function preview(path: string, sourceColumn: string) {
    const existing = columns.find((c) => c.tabs.some((tab) => tab.preview && tab.path === path));
    if (existing) {
      setColumns((current) => openEditorTab(current, existing.id, path, true, true));
      setActiveColumn(existing.id);
      return;
    }
    if (columns.length >= 8) {
      void open(path, true, true, sourceColumn);
      return;
    }
    const id = crypto.randomUUID();
    const tab = { path, pinned: true, preview: true, cursor: 0, scroll: 0 };
    setColumns((current) => {
      const next = current.map((c) => ({
        ...c,
        tabs: c.tabs.map((t) => (t.path === path ? { ...t, pinned: true } : t)),
      }));
      const index = next.findIndex((c) => c.id === sourceColumn);
      next.splice(index + 1, 0, { id, active: tabId(tab), tabs: [tab] });
      return next;
    });
    setActiveColumn(id);
  }
  const active = columns.find((c) => c.id === activeColumn) ?? columns[0]!;
  const tab = active.tabs.find((tab) => tabId(tab) === active.active);
  return {
    documents,
    docsRef,
    columns,
    setColumns,
    activeColumn,
    setActiveColumn,
    preferences,
    setPreferences,
    directories,
    loadDirectory,
    loading,
    error,
    setError,
    ready,
    dirty,
    active,
    tab,
    states,
    views,
    open,
    openDiff,
    edit,
    save,
    saveAll,
    close,
    reopen,
    split,
    preview,
    loadDocument,
    report,
    recent,
    setRecent,
    columnSizes,
    setColumnSizes,
    refresh: () => {
      for (const path of new Set(["", ...Object.keys(directoriesRef.current)]))
        void loadDirectory(path).catch(report);
    },
    reload: async (path: string) => {
      if (await confirmDiscard(path)) await loadDocument(path, "reload").catch(report);
    },
    comparison,
    setComparison,
    compare,
  };
}
