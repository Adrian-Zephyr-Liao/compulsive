import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { useEditorWorkbench } from "./useEditorWorkbench.js";
import type { useEditorGit } from "./useEditorGit.js";
import type { useEditorTerminals } from "./useEditorTerminals.js";
import type { EditorCommand, EditorSidebarMode } from "../types.js";
import { editorShortcut } from "../utils/shortcuts.js";

export function useEditorCommands({
  editor,
  git,
  terminals,
  setPalette,
  setSidebar,
  setMode,
  setTerminalOpen,
  setSettings,
}: {
  editor: ReturnType<typeof useEditorWorkbench>;
  git: Pick<ReturnType<typeof useEditorGit>, "refresh" | "loadHistory">;
  terminals: Pick<ReturnType<typeof useEditorTerminals>, "create">;
  setPalette: (query: string) => void;
  setSidebar: Dispatch<SetStateAction<boolean>>;
  setMode: (mode: EditorSidebarMode) => void;
  setTerminalOpen: Dispatch<SetStateAction<boolean>>;
  setSettings: (open: boolean) => void;
}) {
  const commands: EditorCommand[] = [
    { id: "files.open", label: "editor.quickOpen", shortcut: "⌘P", run: () => setPalette("") },
    {
      id: "files.save",
      label: "editor.save",
      shortcut: "⌘S",
      run: () => {
        if (editor.tab) void editor.save(editor.tab.path).catch(editor.report);
      },
    },
    {
      id: "files.saveAll",
      label: "editor.saveAll",
      shortcut: "⌘⌥S",
      run: () => void editor.saveAll().catch(editor.report),
    },
    { id: "editor.split", label: "editor.split", shortcut: "⌘\\", run: editor.split },
    {
      id: "editor.reopen",
      label: "editor.reopen",
      shortcut: "⌘⇧T",
      run: () => void editor.reopen(),
    },
    {
      id: "editor.search",
      label: "editor.search",
      shortcut: "⌘⇧F",
      run: () => {
        setSidebar(true);
        setMode("search");
      },
    },
    { id: "editor.symbols", label: "editor.symbols", shortcut: "⌘⇧O", run: () => setPalette("@") },
    { id: "editor.line", label: "editor.goLine", shortcut: "⌃G", run: () => setPalette(":") },
    {
      id: "editor.wrap",
      label: "editor.wrap",
      shortcut: "⌥Z",
      run: () => editor.setPreferences((p) => ({ ...p, wrap: !p.wrap })),
    },
    {
      id: "terminal.new",
      label: "editor.newTerminal",
      shortcut: "",
      run: () => {
        setTerminalOpen(true);
        terminals.create();
      },
    },
    {
      id: "terminal.toggle",
      label: "editor.terminal",
      shortcut: "⌃`",
      run: () => setTerminalOpen((v) => !v),
    },
    {
      id: "git.status",
      label: "editor.gitRefresh",
      shortcut: "",
      run: () => {
        setSidebar(true);
        setMode("sourceControl");
        void git.refresh().catch(editor.report);
      },
    },
    {
      id: "git.blame",
      label: "editor.blame",
      shortcut: "",
      run: () => {
        if (editor.tab) void git.loadHistory(0, "", editor.tab.path);
      },
    },
    {
      id: "editor.preferences",
      label: "editor.settings",
      shortcut: "⌘,",
      run: () => setSettings(true),
    },
  ];
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(".ant-modal, .xterm")) return;
      const command = editorShortcut(event);
      if (!command) return;
      event.preventDefault();
      if (command === "palette.commands") setPalette(">");
      else if (command === "sidebar.toggle") setSidebar((v) => !v);
      else if (command === "files.close") {
        if (editor.active.active) void editor.close(editor.active.id, editor.active.active);
      } else commands.find((c) => c.id === command)?.run();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return commands;
}
