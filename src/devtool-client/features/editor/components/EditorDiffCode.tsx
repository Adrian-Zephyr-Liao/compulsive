import { useEffect, useRef, useState, type RefObject } from "react";
import {
  basicSetup,
  Decoration,
  EditorState,
  EditorView,
  WidgetType,
  type Extension,
} from "@uiw/react-codemirror";
import { getChunks, MergeView, unifiedMergeView } from "@codemirror/merge";
import {
  LanguageDescription,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { diffHunks, type DiffHunk } from "../utils/diffHunks.js";

export interface DiffNavigation {
  current: number;
  total: number;
  move: (direction: number) => void;
}
export interface DiffPosition {
  identity: string;
  line: number;
  scroll: number;
}

class HunkAction extends WidgetType {
  constructor(
    readonly hunk: DiffHunk,
    readonly label: string,
    readonly action: () => void,
    readonly disabled: boolean,
    readonly mirror = false,
  ) {
    super();
  }
  toDOM() {
    const row = document.createElement("div");
    row.className = "editor-hunk-bar";
    const range = document.createElement("span");
    range.textContent = this.hunk.header;
    range.title = this.hunk.header;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = this.label;
    button.setAttribute("aria-label", `${this.label} ${this.hunk.index + 1}`);
    button.disabled = this.disabled;
    button.addEventListener("click", this.action);
    row.append(range, button);
    if (this.mirror) {
      row.setAttribute("aria-hidden", "true");
      range.style.visibility = "hidden";
      button.style.visibility = "hidden";
      button.tabIndex = -1;
    }
    return row;
  }
  ignoreEvent() {
    return true;
  }
}

export default function EditorDiffCode(props: {
  path: string;
  original: string;
  content: string;
  dark: boolean;
  side: boolean;
  hunks?: string[] | undefined;
  onHunk?: ((index: number) => void) | undefined;
  hunkLabel: string;
  busy?: boolean | undefined;
  identity: string;
  onNavigation: (navigation: DiffNavigation) => void;
  position: RefObject<DiffPosition | undefined>;
}) {
  const [parent, setParent] = useState<HTMLDivElement | null>(null);
  const [language, setLanguage] = useState<{ path: string; support: Extension }>();
  const latest = useRef(props);
  latest.current = props;
  const { position } = props;
  useEffect(() => {
    let active = true;
    void LanguageDescription.matchFilename(languages, props.path)
      ?.load()
      .then((support) => {
        if (active) setLanguage({ path: props.path, support });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [props.path]);
  useEffect(() => {
    if (!parent) return;
    const extensions = [
      basicSetup({
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        highlightSelectionMatches: false,
      }),
      language?.path === props.path ? language.support : [],
      syntaxHighlighting(props.dark ? oneDarkHighlightStyle : defaultHighlightStyle),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.theme(
        {
          "&": {
            fontSize: "13px",
            height: "100%",
            backgroundColor: "var(--editor-bg)",
            color: "var(--editor-text)",
          },
          ".cm-scroller": {
            fontFamily: '"SFMono-Regular",Consolas,"Liberation Mono",monospace',
            lineHeight: "1.7",
            overflow: "auto",
          },
          ".cm-gutters": {
            backgroundColor: "var(--editor-panel)",
            color: "var(--editor-muted)",
            border: "none",
          },
          "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
            backgroundColor: "var(--ant-color-error-bg)",
          },
          "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
            backgroundColor: "var(--ant-color-success-bg)",
          },
          "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
            background: "var(--ant-color-error-border)",
            borderRadius: "2px",
          },
          "&.cm-merge-b .cm-changedText": {
            background: "var(--ant-color-success-border)",
            borderRadius: "2px",
          },
          "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": {
            background: "var(--ant-color-error-text)",
          },
          "&.cm-merge-b .cm-changedLineGutter, .cm-inlineChangedLineGutter": {
            background: "var(--ant-color-success-text)",
          },
          ".cm-collapsedLines": { background: "var(--editor-panel)", color: "var(--editor-muted)" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            background: "var(--editor-selection)",
          },
        },
        { dark: props.dark },
      ),
    ];
    const doc = EditorState.create({ doc: props.content }).doc;
    const baseDoc = EditorState.create({ doc: props.original }).doc;
    const actions = props.onHunk ? diffHunks(props.hunks ?? [], baseDoc.lines, doc.lines) : [];
    // Match block heights in the base pane so context lines stay aligned too.
    const widgets = (mirror = false) =>
      Decoration.set(
        actions.map((hunk) =>
          Decoration.widget({
            widget: new HunkAction(
              hunk,
              props.hunkLabel,
              () => {
                if (!latest.current.busy) latest.current.onHunk?.(hunk.index);
              },
              Boolean(props.busy),
              mirror,
            ),
            block: true,
            side: -1,
          }).range(mirror ? baseDoc.line(hunk.oldLine).from : doc.line(hunk.line).from),
        ),
        true,
      );
    const publish = (view: EditorView) => {
      const chunks = getChunks(view.state)?.chunks ?? [];
      const head = view.state.selection.main.head;
      let index = chunks.findIndex((chunk) => head <= chunk.endB);
      if (index < 0) index = chunks.length - 1;
      latest.current.onNavigation({
        current: chunks.length ? index + 1 : 0,
        total: chunks.length,
        move(direction) {
          const next = chunks[Math.max(0, Math.min(chunks.length - 1, index + direction))];
          if (next)
            view.dispatch({
              selection: { anchor: Math.min(next.fromB, view.state.doc.length) },
              effects: EditorView.scrollIntoView(Math.min(next.fromB, view.state.doc.length), {
                y: "center",
              }),
            });
        },
      });
    };
    const currentExtensions = [
      EditorView.decorations.of(widgets()),
      EditorView.updateListener.of((event) => {
        if (event.selectionSet) publish(event.view);
      }),
    ];
    const merge = props.side
      ? new MergeView({
          parent,
          a: {
            doc: props.original,
            extensions: [...extensions, EditorView.decorations.of(widgets(true))],
          },
          b: { doc: props.content, extensions: [...extensions, ...currentExtensions] },
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 8 },
        })
      : undefined;
    const view =
      merge?.b ??
      new EditorView({
        parent,
        state: EditorState.create({
          doc: props.content,
          extensions: [
            ...extensions,
            ...currentExtensions,
            unifiedMergeView({
              original: props.original,
              mergeControls: false,
              highlightChanges: true,
              collapseUnchanged: { margin: 3, minSize: 8 },
            }),
          ],
        }),
      });
    const previous = position.current;
    const first = actions[0]
      ? view.state.doc.line(actions[0].line).from
      : (getChunks(view.state)?.chunks[0]?.fromB ?? 0);
    const anchor =
      previous?.identity === props.identity
        ? view.state.doc.line(Math.min(previous.line, view.state.doc.lines)).from
        : Math.min(first, view.state.doc.length);
    view.dispatch({
      selection: { anchor },
      effects: EditorView.scrollIntoView(anchor, { y: "start", yMargin: 40 }),
    });
    publish(view);
    const scrollDOM = merge?.dom ?? view.scrollDOM;
    const sizing = new ResizeObserver(() => {
      for (const pane of merge ? [merge.a, merge.b] : [view]) {
        const gutter = pane.dom.querySelector(".cm-gutters")?.getBoundingClientRect().width ?? 0;
        pane.contentDOM.style.setProperty(
          "--diff-pane-width",
          `${Math.max(0, pane.scrollDOM.clientWidth - gutter)}px`,
        );
      }
    });
    sizing.observe(view.dom);
    if (merge) sizing.observe(merge.a.dom);
    const frame = requestAnimationFrame(() => {
      if (previous?.identity === props.identity) scrollDOM.scrollTop = previous.scroll;
    });
    return () => {
      cancelAnimationFrame(frame);
      sizing.disconnect();
      position.current = {
        identity: props.identity,
        line: view.state.doc.lineAt(view.state.selection.main.head).number,
        scroll: scrollDOM.scrollTop,
      };
      if (merge) merge.destroy();
      else view.destroy();
    };
  }, [
    parent,
    props.original,
    props.content,
    props.dark,
    props.path,
    props.side,
    props.identity,
    props.hunks,
    props.hunkLabel,
    props.busy,
    position,
    Boolean(props.onHunk),
    language,
  ]);
  return <div ref={setParent} className="editor-diff min-h-0 flex-1 overflow-hidden" />;
}
