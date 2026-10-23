import type { EditorSession, EditorPreferences } from "../../../../project/session.js";
import type { EditorDocument } from "../types.js";

export function loadedEditorDocument(
  previous: EditorDocument | undefined,
  file: Omit<EditorDocument, "saved" | "conflict">,
  reload: boolean,
): EditorDocument {
  if (previous && previous.content !== previous.saved && !reload)
    return { ...previous, conflict: previous.version !== file.version };
  return { ...file, saved: file.content, conflict: false };
}

export function savedEditorDocument(
  current: EditorDocument,
  file: Pick<EditorDocument, "version" | "bytes">,
  content: string,
): EditorDocument {
  return { ...current, version: file.version, bytes: file.bytes, saved: content, conflict: false };
}
export const defaultEditorPreferences: EditorPreferences = {
  wrap: false,
  vim: false,
  autoSave: false,
  fontSize: 13,
  lineHeight: 1.7,
  sidebarWidth: 250,
  panelSize: 240,
  terminalPlacement: "bottom",
};
export type EditorColumn = EditorSession["columns"][number];
export type EditorTab = EditorColumn["tabs"][number];
export function pruneEditorStates<T>(columns: EditorColumn[], states: Map<string, T>): void {
  const open = new Set(
    columns.flatMap((c) =>
      c.tabs.filter((tab) => !tab.preview && !tab.diff).map((tab) => `${c.id}:${tab.path}`),
    ),
  );
  for (const key of states.keys()) if (!open.has(key)) states.delete(key);
}

export function changedEditorDirectories(loaded: string[], changed: string[]): string[] {
  return loaded.filter((directory) =>
    changed.some(
      (path) =>
        !path ||
        !directory ||
        path === directory ||
        path.startsWith(`${directory}/`) ||
        directory.startsWith(`${path}/`),
    ),
  );
}
export const tabId = (tab: Pick<EditorTab, "path" | "preview" | "diff">) =>
  tab.diff ? `\0diff:${tab.diff}:${tab.path}` : `${tab.preview ? "preview:" : ""}${tab.path}`;
export function openEditorTab(
  columns: EditorColumn[],
  columnId: string,
  path: string,
  pinned: boolean,
  preview = false,
  dirtyPaths: string[] = [],
  diff?: EditorTab["diff"],
): EditorColumn[] {
  return columns.map((column) => {
    if (column.id !== columnId) return column;
    const id = tabId({ path, preview, ...(diff && { diff }) });
    const existing = column.tabs.find((tab) => tabId(tab) === id);
    if (existing)
      return {
        ...column,
        active: id,
        tabs: column.tabs.map((tab) =>
          tab === existing ? { ...tab, pinned: tab.pinned || pinned } : tab,
        ),
      };
    const tabs = column.tabs.filter(
      (tab) => tab.pinned || (!tab.diff && dirtyPaths.includes(tab.path)),
    );
    return {
      ...column,
      active: id,
      tabs: [...tabs, { path, pinned, preview, cursor: 0, scroll: 0, ...(diff && { diff }) }],
    };
  });
}
export function closeEditorTab(
  columns: EditorColumn[],
  columnId: string,
  id: string,
): EditorColumn[] {
  const result = columns.map((column) => {
    if (column.id !== columnId) return column;
    const index = column.tabs.findIndex((tab) => tabId(tab) === id);
    const tabs = column.tabs.filter((tab) => tabId(tab) !== id);
    return {
      ...column,
      tabs,
      active:
        column.active === id
          ? tabs[Math.max(0, index - 1)]
            ? tabId(tabs[Math.max(0, index - 1)]!)
            : ""
          : column.active,
    };
  });
  return result.length > 1 ? result.filter((c) => c.tabs.length) : result;
}
export function moveEditorTab(
  columns: EditorColumn[],
  from: string,
  to: string,
  id: string,
  index: number,
): EditorColumn[] {
  const tab = columns.find((c) => c.id === from)?.tabs.find((t) => tabId(t) === id);
  if (!tab) return columns;
  const result = columns.map((c) => {
    const tabs = c.tabs.filter((t) => (c.id !== from && c.id !== to) || tabId(t) !== id);
    if (c.id === to)
      tabs.splice(Math.max(0, Math.min(index, tabs.length)), 0, { ...tab, pinned: true });
    return {
      ...c,
      tabs,
      active: c.id === to ? id : c.active === id ? (tabs[0] ? tabId(tabs[0]) : "") : c.active,
    };
  });
  return result.filter((c) => c.tabs.length || c.id === to);
}
export function fuzzyPaths(paths: string[], query: string): string[] {
  const q = query.toLowerCase();
  return paths
    .map((path) => {
      const p = path.toLowerCase();
      let at = 0,
        score = 0;
      for (const letter of q) {
        const found = p.indexOf(letter, at);
        if (found < 0) return { path, score: Infinity };
        score += found - at;
        at = found + 1;
      }
      return { path, score: score + (p.includes(q) ? 0 : 100) + p.length / 1000 };
    })
    .filter((row) => Number.isFinite(row.score))
    .sort((a, b) => a.score - b.score)
    .slice(0, 100)
    .map((row) => row.path);
}
