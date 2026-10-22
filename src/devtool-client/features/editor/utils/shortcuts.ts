type ShortcutEvent = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

export function editorShortcut(event: ShortcutEvent): string | undefined {
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  if (mod && key === "s") return event.altKey ? "files.saveAll" : "files.save";
  if (mod && key === "p") return event.shiftKey ? "palette.commands" : "files.open";
  if (mod && key === "\\") return "editor.split";
  if (mod && event.shiftKey && key === "f") return "editor.search";
  if (mod && event.shiftKey && key === "o") return "editor.symbols";
  if (mod && event.shiftKey && key === "t") return "editor.reopen";
  if (event.ctrlKey && key === "g") return "editor.line";
  if (event.ctrlKey && key === "`") return "terminal.toggle";
  if (event.altKey && key === "z") return "editor.wrap";
  if (mod && key === ",") return "editor.preferences";
  if (mod && key === "b") return "sidebar.toggle";
  if (mod && key === "w") return "files.close";
  return undefined;
}
