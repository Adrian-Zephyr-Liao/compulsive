import { useEffect, useRef, useState } from "react";
import { EditorState, EditorView, basicSetup, type Extension } from "@uiw/react-codemirror";
import { MergeView, unifiedMergeView, goToNextChunk, goToPreviousChunk } from "@codemirror/merge";
import {
  LanguageDescription,
  defaultHighlightStyle,
  syntaxHighlighting,
} from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import { Button, Modal, Segmented } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import EditorImageDiff from "./EditorImageDiff.js";
interface Props {
  images?: { original?: string; content?: string } | undefined;
  hunks?: string[] | undefined;
  staged?: boolean | undefined;
  onHunk?: ((index: number) => void) | undefined;
  path: string;
  original: string;
  content: string;
  close: () => void;
  dark: boolean;
  embedded?: boolean;
  sideBySide?: boolean;
  onSideChange?: (side: boolean) => void;
}
export default function EditorDiff(props: Props) {
  const { t } = useI18n();
  const [localSide, setLocalSide] = useState(true);
  const side = props.sideBySide ?? localSide;
  const [parent, setParent] = useState<HTMLDivElement | null>(null);
  const target = useRef<EditorView>(undefined);
  const [language, setLanguage] = useState<{ path: string; support: Extension }>();
  useEffect(() => {
    if (props.images) return;
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
  }, [props.path, props.images]);
  useEffect(() => {
    if (!parent || props.images) return;
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
          ".cm-collapsedLines": {
            background: "var(--editor-panel)",
            color: "var(--editor-muted)",
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            background: "var(--editor-selection)",
          },
        },
        { dark: props.dark },
      ),
    ];
    if (side) {
      const merge = new MergeView({
        parent,
        a: { doc: props.original, extensions },
        b: { doc: props.content, extensions },
        highlightChanges: true,
        gutter: true,
        collapseUnchanged: { margin: 3, minSize: 8 },
      });
      target.current = merge.b;
      return () => merge.destroy();
    }
    const editor = new EditorView({
      parent,
      state: EditorState.create({
        doc: props.content,
        extensions: [
          ...extensions,
          unifiedMergeView({
            original: props.original,
            mergeControls: false,
            highlightChanges: true,
            collapseUnchanged: { margin: 3, minSize: 8 },
          }),
        ],
      }),
    });
    target.current = editor;
    return () => editor.destroy();
  }, [parent, props.original, props.content, props.dark, props.images, props.path, language, side]);
  const body = props.images ? (
    <div className={props.embedded ? "min-h-0 flex-1" : "mt-4 h-[65vh]"}>
      <EditorImageDiff
        path={props.path}
        original={props.original}
        content={props.content}
        images={props.images}
      />
    </div>
  ) : (
    <>
      <div
        className={`flex shrink-0 flex-wrap items-center justify-between gap-3 ${props.embedded ? "border-b border-[var(--editor-border)] px-4 py-3" : "mb-3 mt-4"}`}
      >
        <Segmented
          value={side ? "side" : "inline"}
          options={[
            { label: t("editor.sideBySide"), value: "side" },
            { label: t("editor.inline"), value: "inline" },
          ]}
          onChange={(value) => {
            const next = value === "side";
            setLocalSide(next);
            props.onSideChange?.(next);
          }}
        />
        <div className="flex gap-2">
          <Button
            icon={<ArrowUpOutlined />}
            onClick={() => {
              if (target.current) goToPreviousChunk(target.current);
            }}
          >
            {t("editor.previousChange")}
          </Button>
          <Button
            icon={<ArrowDownOutlined />}
            onClick={() => {
              if (target.current) goToNextChunk(target.current);
            }}
          >
            {t("editor.nextChange")}
          </Button>
        </div>
      </div>
      {props.onHunk && props.hunks && props.hunks.length > 0 && (
        <div className="mb-3 flex max-h-20 flex-wrap gap-2 overflow-auto">
          {props.hunks.map((hunk, index) => (
            <Button
              key={`${hunk}:${index}`}
              size="small"
              onClick={() => props.onHunk?.(index)}
              title={hunk}
            >
              {t(props.staged ? "editor.hunkUnstage" : "editor.hunkStage")} {index + 1}
            </Button>
          ))}
        </div>
      )}
      <div
        ref={setParent}
        className={`editor-diff ${props.embedded ? "min-h-0 flex-1 overflow-auto" : "h-[65vh] overflow-auto border border-[var(--editor-border)]"}`}
      />
    </>
  );
  return props.embedded ? (
    <section
      className="flex h-full min-h-0 flex-col"
      aria-label={`${t("editor.diff")} · ${props.path}`}
    >
      {body}
    </section>
  ) : (
    <Modal
      open
      title={`${t("editor.diff")} · ${props.path}`}
      footer={null}
      width="90vw"
      onCancel={props.close}
      destroyOnHidden
    >
      {body}
    </Modal>
  );
}
