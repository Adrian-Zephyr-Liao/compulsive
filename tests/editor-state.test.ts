import { describe, expect, it } from "vitest";
import {
  openEditorTab,
  closeEditorTab,
  moveEditorTab,
  fuzzyPaths,
  tabId,
  loadedEditorDocument,
  savedEditorDocument,
  pruneEditorStates,
  changedEditorDirectories,
} from "../src/devtool-client/features/editor/utils/editorState.js";
import { editorShortcut } from "../src/devtool-client/features/editor/utils/shortcuts.js";
import type { EditorColumn } from "../src/devtool-client/features/editor/utils/editorState.js";
const empty = (): EditorColumn[] => [{ id: "a", active: "", tabs: [] }];
describe("editor tabs and columns", () => {
  it("replaces only clean transient tabs and pins edited or explicitly opened files", () => {
    let columns = openEditorTab(empty(), "a", "one.ts", false);
    columns = openEditorTab(columns, "a", "two.ts", false);
    expect(columns[0]?.tabs.map((t) => t.path)).toEqual(["two.ts"]);
    columns = openEditorTab(columns, "a", "three.ts", true, false, ["two.ts"]);
    expect(columns[0]?.tabs.map((t) => t.path)).toEqual(["two.ts", "three.ts"]);
    columns = openEditorTab(columns, "a", "three.ts", false);
    expect(columns[0]?.tabs[1]?.pinned).toBe(true);
  });
  it("keeps source and rendered preview distinct and picks an adjacent tab on close", () => {
    let columns = openEditorTab(empty(), "a", "README.md", true);
    columns = openEditorTab(columns, "a", "README.md", true, true);
    expect(columns[0]?.tabs.map(tabId)).toEqual(["README.md", "preview:README.md"]);
    columns = closeEditorTab(columns, "a", "preview:README.md");
    expect(columns[0]?.active).toBe("README.md");
    expect(closeEditorTab(columns, "a", "README.md")).toEqual([{ id: "a", active: "", tabs: [] }]);
  });
  it("moves and reorders tabs without duplicates, retaining caret state", () => {
    let columns = openEditorTab(empty(), "a", "one.ts", true);
    columns = openEditorTab(columns, "a", "two.ts", true);
    columns[0]!.tabs[0]!.cursor = 12;
    columns.push({ id: "b", active: "", tabs: [] });
    columns = moveEditorTab(columns, "a", "b", "one.ts", 0);
    expect(columns[1]?.tabs[0]?.cursor).toBe(12);
    columns = moveEditorTab(columns, "a", "b", "two.ts", 0);
    expect(columns).toHaveLength(1);
    expect(columns[0]?.tabs.map((t) => t.path)).toEqual(["two.ts", "one.ts"]);
  });
  it("ranks fuzzy file paths and bounds palette results", () => {
    expect(fuzzyPaths(["src/parser.ts", "src/path.ts", "README.md"], "path")[0]).toBe(
      "src/path.ts",
    );
    expect(fuzzyPaths(["src/workspace.ts", "README.md"], "sws")).toEqual(["src/workspace.ts"]);
    expect(
      fuzzyPaths(
        Array.from({ length: 200 }, (_, i) => `file${i}.ts`),
        "",
      ),
    ).toHaveLength(100);
  });
  it("releases cached documents and undo history after their tabs are closed", () => {
    let columns = openEditorTab(empty(), "a", "one.ts", true);
    columns = openEditorTab(columns, "a", "two.ts", true);
    columns = openEditorTab(columns, "a", "README.md", true, true);
    const states = new Map([
      ["a:one.ts", "undo one"],
      ["a:two.ts", "undo two"],
      ["a:README.md", "old source"],
      ["removed:one.ts", "old split"],
    ]);
    pruneEditorStates(closeEditorTab(columns, "a", "one.ts"), states);
    expect([...states]).toEqual([["a:two.ts", "undo two"]]);
  });
  it("refreshes cached nested directory entries without refreshing unrelated branches", () => {
    const loaded = ["", "src", "src/components", "test"];
    expect(changedEditorDirectories(loaded, ["src/components/new.ts"])).toEqual([
      "",
      "src",
      "src/components",
    ]);
    expect(changedEditorDirectories(loaded, ["src"])).toEqual(["", "src", "src/components"]);
    expect(changedEditorDirectories(loaded, [""])).toEqual(loaded);
    expect(changedEditorDirectories(loaded, ["src-other/file.ts"])).toEqual([""]);
  });
});

describe("editor document transitions", () => {
  const disk = { path: "one.ts", version: "v1", content: "original", bytes: 8 };
  it("refreshes clean buffers but preserves dirty text and its version", () => {
    const clean = loadedEditorDocument(undefined, disk, false);
    const changed = { ...disk, version: "v2", content: "external" };
    expect(loadedEditorDocument(clean, changed, false)).toEqual({
      ...changed,
      saved: "external",
      conflict: false,
    });
    const dirty = { ...clean, content: "local edit" };
    expect(loadedEditorDocument(dirty, changed, false)).toEqual({ ...dirty, conflict: true });
    expect(loadedEditorDocument(dirty, disk, false)).toEqual(dirty);
    expect(dirty.saved).toBe("original");
  });
  it("replaces a dirty buffer only on an explicit reload", () => {
    const dirty = {
      ...loadedEditorDocument(undefined, disk, false),
      content: "local edit",
      conflict: true,
    };
    expect(loadedEditorDocument(dirty, disk, true)).toEqual({
      ...disk,
      saved: disk.content,
      conflict: false,
    });
  });
  it("retains keystrokes made while a save was in flight and ignores response text", () => {
    const current = { ...loadedEditorDocument(undefined, disk, false), content: "new keystrokes" };
    const response = { ...disk, version: "v2", content: "submitted edit", bytes: 14 };
    const saved = savedEditorDocument(current, response, "submitted edit");
    expect(saved.content).toBe("new keystrokes");
    expect(saved.saved).toBe("submitted edit");
    expect(saved.version).toBe("v2");
    expect(saved.bytes).toBe(14);
    expect(current.saved).toBe("original");
  });
});

describe("editor shortcuts", () => {
  it("preserves command routing and leaves plain typing untouched", () => {
    const key = (key: string, modifiers: Partial<KeyboardEvent> = {}) =>
      editorShortcut({
        key,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        ...modifiers,
      });
    expect(key("s")).toBeUndefined();
    expect(key("S", { metaKey: true })).toBe("files.save");
    expect(key("s", { ctrlKey: true, altKey: true })).toBe("files.saveAll");
    expect(key("p", { metaKey: true })).toBe("files.open");
    expect(key("p", { metaKey: true, shiftKey: true })).toBe("palette.commands");
    expect(key("w", { ctrlKey: true })).toBe("files.close");
    expect(key("b", { metaKey: true })).toBe("sidebar.toggle");
    expect(key("f", { metaKey: true, shiftKey: true })).toBe("editor.search");
    expect(key("\\", { metaKey: true })).toBe("editor.split");
    expect(key("g", { metaKey: true })).toBeUndefined();
    expect(key("g", { ctrlKey: true })).toBe("editor.line");
    expect(key("`", { ctrlKey: true })).toBe("terminal.toggle");
  });
});
