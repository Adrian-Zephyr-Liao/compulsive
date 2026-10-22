import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CompulsiveError } from "../errors.js";
import { writeJsonAtomic } from "../storage.js";
import { assertProjectRelativePath } from "./paths.js";
import type { RepositoryManager } from "../types.js";

export interface EditorPreferences {
  wrap: boolean;
  vim: boolean;
  autoSave: boolean;
  fontSize: number;
  lineHeight: number;
  sidebarWidth: number;
  panelSize: number;
  terminalPlacement: "bottom" | "side" | "editor";
}
export interface EditorSession {
  preferences: EditorPreferences;
  columns: Array<{
    id: string;
    active: string;
    tabs: Array<{
      path: string;
      pinned: boolean;
      cursor: number;
      scroll: number;
      preview: boolean;
    }>;
  }>;
  recent: string[];
  columnSizes: number[];
}
const locations = new WeakMap<RepositoryManager, string>();
export function registerEditorStorage(manager: RepositoryManager, dataDir: string) {
  locations.set(manager, join(dataDir, "editor-sessions.json"));
}
function validSession(value: unknown): value is EditorSession {
  if (!value || typeof value !== "object") return false;
  const s = value as EditorSession;
  const p = s.preferences;
  const bounded = (n: number, min: number, max: number) =>
    Number.isFinite(n) && n >= min && n <= max;
  if (
    !p ||
    ![p.wrap, p.vim, p.autoSave].every((v) => typeof v === "boolean") ||
    !bounded(p.fontSize, 10, 28) ||
    !bounded(p.lineHeight, 1.2, 2.5) ||
    !bounded(p.sidebarWidth, 160, 600) ||
    !bounded(p.panelSize, 100, 900) ||
    !["bottom", "side", "editor"].includes(p.terminalPlacement) ||
    !Array.isArray(s.columns) ||
    s.columns.length > 8 ||
    !Array.isArray(s.recent) ||
    s.recent.length > 100 ||
    !s.recent.every((v) => typeof v === "string" && v.length <= 100) ||
    !Array.isArray(s.columnSizes) ||
    s.columnSizes.length > 8 ||
    !s.columnSizes.every((v) => bounded(v, 0, 10000))
  )
    return false;
  try {
    return s.columns.every(
      (c) =>
        typeof c.id === "string" &&
        c.id.length <= 100 &&
        typeof c.active === "string" &&
        c.active.length <= 4096 &&
        Array.isArray(c.tabs) &&
        c.tabs.length <= 50 &&
        c.tabs.every((t) => {
          assertProjectRelativePath(t.path, false);
          return (
            typeof t.pinned === "boolean" &&
            typeof t.preview === "boolean" &&
            bounded(t.cursor, 0, 8 * 1024 * 1024) &&
            bounded(t.scroll, 0, 1e9)
          );
        }),
    );
  } catch {
    return false;
  }
}
const queues = new WeakMap<RepositoryManager, Promise<unknown>>();
export async function projectSession(
  manager: RepositoryManager,
  scope: { workspaceId: string; repositoryId: string },
  session?: unknown,
) {
  const workspace = (await manager.searchWorkspaces()).find((w) => w.id === scope.workspaceId);
  if (!workspace?.members.some((m) => m.repositoryId === scope.repositoryId))
    throw new CompulsiveError("NOT_FOUND", "Requirement member no longer exists.");
  const path = locations.get(manager);
  if (!path) throw new CompulsiveError("FILESYSTEM_FAILED", "Editor storage is unavailable.");
  if (
    session !== undefined &&
    (!validSession(session) || Buffer.byteLength(JSON.stringify(session)) > 128 * 1024)
  )
    throw new CompulsiveError("INVALID_INPUT", "Invalid editor layout or preferences.");
  const key = JSON.stringify([scope.workspaceId, scope.repositoryId]);
  const run = (queues.get(manager) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      let saved: Record<string, EditorSession> = {};
      try {
        const data = await readFile(path, "utf8");
        if (data.length > 4 * 1024 * 1024)
          throw new Error("Editor session store exceeds its limit.");
        const parsed: unknown = JSON.parse(data);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("Invalid editor session store.");
        saved = Object.fromEntries(Object.entries(parsed).filter(([, v]) => validSession(v)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (session !== undefined) {
        // Rebuild the accepted shape: never persist extra document text or terminal output.
        const s = session as EditorSession;
        delete saved[key];
        saved[key] = {
          preferences: {
            wrap: s.preferences.wrap,
            vim: s.preferences.vim,
            autoSave: s.preferences.autoSave,
            fontSize: s.preferences.fontSize,
            lineHeight: s.preferences.lineHeight,
            sidebarWidth: s.preferences.sidebarWidth,
            panelSize: s.preferences.panelSize,
            terminalPlacement: s.preferences.terminalPlacement,
          },
          columns: s.columns.map((c) => ({
            id: c.id,
            active: c.active,
            tabs: c.tabs.map((t) => ({
              path: t.path,
              pinned: t.pinned,
              cursor: t.cursor,
              scroll: t.scroll,
              preview: t.preview,
            })),
          })),
          recent: s.recent,
          columnSizes: s.columnSizes,
        };
        while (
          Object.keys(saved).length > 100 ||
          Buffer.byteLength(JSON.stringify(saved)) > 4 * 1024 * 1024
        )
          delete saved[Object.keys(saved)[0]!];
        await writeJsonAtomic(path, saved);
      }
      return saved[key] ?? null;
    });
  queues.set(manager, run);
  return run;
}
