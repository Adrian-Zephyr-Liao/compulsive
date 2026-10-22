import { useEffect, useMemo, useRef, useState } from "react";
import {
  EditorState,
  EditorView,
  Compartment,
  StateEffect,
  Transaction,
  keymap,
  basicSetup,
  type Extension,
} from "@uiw/react-codemirror";
import { LanguageDescription, syntaxTree, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { indentWithTab } from "@codemirror/commands";
import { vim } from "@replit/codemirror-vim";
import { indentationMarkers } from "@replit/codemirror-indentation-markers";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { useI18n } from "../../../app/i18n.js";
import { useAppearance } from "../../../app/appearance.js";
import type { EditorPreferences } from "../../../../project/session.js";
interface Props {
  navigation?: { line: number; column: number; id: number } | undefined;
  path: string;
  content: string;
  viewId: string;
  preferences: EditorPreferences;
  states: Map<string, EditorState>;
  views: Map<string, EditorView>;
  cursor: number;
  scroll: number;
  onChange: (content: string) => void;
  onPosition: (cursor: number, scroll: number) => void;
}
export default function EditorCode(props: Props) {
  const { t } = useI18n();
  const { dark } = useAppearance();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(undefined);
  const current = useRef(props);
  current.current = props;
  const configuration = useMemo(() => new Compartment(), []);
  const externalUpdate = useRef<(content: string) => void>(() => {});
  const [language, setLanguage] = useState<Extension>([]);
  const [position, setPosition] = useState("1:1");
  const [context, setContext] = useState("");
  const lineSeparator = props.content.includes("\r\n") ? "\r\n" : "\n";
  useEffect(() => {
    let active = true;
    setLanguage([]);
    void LanguageDescription.matchFilename(languages, props.path)
      ?.load()
      .then((s) => {
        if (active) setLanguage(s);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [props.path]);
  const extensions = useMemo(
    () => [
      basicSetup(),
      ...(dark ? [syntaxHighlighting(oneDarkHighlightStyle)] : []),
      language,
      keymap.of([indentWithTab]),
      indentationMarkers(),
      EditorState.lineSeparator.of(lineSeparator),
      EditorState.phrases.of({
        Find: t("editor.find"),
        next: t("editor.next"),
        previous: t("editor.previous"),
        all: t("editor.allMatches"),
        "match case": t("editor.matchCase"),
        regexp: t("editor.regexp"),
        "by word": t("editor.wholeWord"),
        close: t("editor.closeSearch"),
        "Go to line": t("editor.goToLine"),
        go: t("editor.go"),
        Replace: t("editor.replace"),
        "replace all": t("editor.replaceAll"),
      }),
      ...(props.preferences.wrap ? [EditorView.lineWrapping] : []),
      ...(props.preferences.vim ? [vim()] : []),
      EditorView.contentAttributes.of({ "aria-label": t("editor.code") }),
      EditorView.theme(
        {
          "&": {
            height: "100%",
            fontSize: `${props.preferences.fontSize}px`,
            backgroundColor: "var(--editor-bg)",
            color: "var(--editor-text)",
          },
          ".cm-scroller": {
            overflow: "auto",
            fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
            lineHeight: String(props.preferences.lineHeight),
          },
          ".cm-gutters": {
            backgroundColor: "var(--editor-bg)",
            color: "var(--editor-muted)",
            border: "none",
            minWidth: "42px",
          },
          ".cm-activeLineGutter,.cm-activeLine": { backgroundColor: "var(--editor-hover)" },
          ".cm-content": { padding: "8px 0 120px" },
          ".cm-line": { padding: "0 16px" },
          ".cm-cursor": { borderLeftColor: "var(--editor-accent)" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor: "var(--editor-selection)",
          },
          ".cm-panels,.cm-tooltip": {
            backgroundColor: "var(--editor-panel)",
            color: "var(--editor-text)",
          },
          ".cm-searchMatch": { backgroundColor: "#b58b4944" },
          ".cm-searchMatch-selected": { backgroundColor: "#a7796855" },
        },
        { dark },
      ),
    ],
    [dark, language, lineSeparator, props.preferences, t],
  );
  useEffect(() => {
    if (!host.current) return;
    const initial = current.current;
    let syncing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listener = EditorView.updateListener.of((update) => {
      initial.states.set(initial.viewId, update.state);
      if (update.docChanged && !syncing) current.current.onChange(update.state.sliceDoc());
      const point = update.state.selection.main.head;
      const line = update.state.doc.lineAt(point);
      setPosition(`${line.number}:${point - line.from + 1}`);
      if (timer) clearTimeout(timer);
      timer = setTimeout(
        () => current.current.onPosition(point, update.view.scrollDOM.scrollTop),
        350,
      );
      if (update.viewportChanged || update.docChanged) {
        const top = update.view.viewport.from;
        let node = syntaxTree(update.state).resolveInner(top, 1);
        let text = "";
        for (let depth = 0; node.parent && depth < 12; depth++, node = node.parent)
          if (/Function|Class|Method|Declaration/.test(node.name) && node.from < top) {
            text = update.state.doc.lineAt(node.from).text.slice(0, 180);
            break;
          }
        setContext(text);
      }
    });
    const cached = initial.states.get(initial.viewId);
    const editor = new EditorView({
      parent: host.current,
      state:
        cached ??
        EditorState.create({
          doc: initial.content,
          selection: { anchor: Math.min(initial.cursor, initial.content.length) },
          extensions: [],
        }),
    });
    editor.dispatch({
      effects: StateEffect.reconfigure.of([configuration.of(extensions), listener]),
    });
    if (editor.state.sliceDoc() !== initial.content) {
      syncing = true;
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: initial.content },
        annotations: Transaction.addToHistory.of(false),
      });
      syncing = false;
    }
    editor.scrollDOM.scrollTop = initial.scroll;
    initial.views.set(initial.viewId, editor);
    view.current = editor;
    externalUpdate.current = (content: string) => {
      const previous = editor.state.doc.toString();
      const next = content.replaceAll("\r\n", "\n");
      let from = 0;
      let oldEnd = previous.length;
      let newEnd = next.length;
      while (from < oldEnd && from < newEnd && previous[from] === next[from]) from++;
      while (oldEnd > from && newEnd > from && previous[oldEnd - 1] === next[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      syncing = true;
      editor.dispatch({
        changes: {
          from,
          to: oldEnd,
          insert: next.slice(from, newEnd).replaceAll("\n", editor.state.lineBreak),
        },
        annotations: Transaction.addToHistory.of(false),
      });
      syncing = false;
    };
    return () => {
      if (timer) clearTimeout(timer);
      initial.states.set(initial.viewId, editor.state);
      current.current.onPosition(editor.state.selection.main.head, editor.scrollDOM.scrollTop);
      initial.views.delete(initial.viewId);
      editor.destroy();
      view.current = undefined;
    };
  }, [props.viewId]);
  useEffect(() => {
    view.current?.dispatch({ effects: configuration.reconfigure(extensions) });
  }, [extensions, configuration]);
  useEffect(() => {
    if (view.current && view.current.state.sliceDoc() !== props.content)
      externalUpdate.current(props.content);
  }, [props.content]);
  useEffect(() => {
    const editor = view.current;
    const target = props.navigation;
    if (!editor || !target) return;
    const line = editor.state.doc.line(Math.max(1, Math.min(target.line, editor.state.doc.lines)));
    editor.dispatch({
      selection: { anchor: Math.min(line.to, line.from + Math.max(0, target.column - 1)) },
      scrollIntoView: true,
    });
    editor.focus();
  }, [props.navigation?.id]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      {context && (
        <div className="truncate border-b border-[var(--editor-border)] px-14 py-1 font-mono text-xs text-[var(--editor-muted)]">
          {context}
        </div>
      )}
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
      <div className="editor-minirow justify-end gap-4">
        <span>{t("editor.position", { value: position })}</span>
        <span>UTF-8 · {props.content.includes("\r\n") ? "CRLF" : "LF"}</span>
      </div>
    </div>
  );
}
