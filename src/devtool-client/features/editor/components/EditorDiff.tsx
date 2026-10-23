import { useEffect, useRef, useState } from "react";
import { Button, Dropdown, Empty, Modal, Segmented, Tag, Tooltip } from "antd";
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  EllipsisOutlined,
  ExpandOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import EditorDiffCode, { type DiffNavigation, type DiffPosition } from "./EditorDiffCode.js";
import EditorImageDiff from "./EditorImageDiff.js";

interface Props {
  images?: { original?: string; content?: string } | undefined;
  hunks?: string[] | undefined;
  staged?: boolean | undefined;
  onHunk?: ((index: number) => void) | undefined;
  onFileAction?: (() => void) | undefined;
  onOpen?: (() => void) | undefined;
  onRefresh?: (() => void) | undefined;
  busy?: boolean | undefined;
  actionsDisabled?: boolean | undefined;
  notice?: string | undefined;
  kind?: "staged" | "working" | "history" | "disk";
  revision?: string | undefined;
  path: string;
  original: string;
  content: string;
  close: () => void;
  dark: boolean;
  embedded?: boolean;
  sideBySide?: boolean | undefined;
  onSideChange?: (side: boolean) => void;
}

export default function EditorDiff(props: Props) {
  const { t } = useI18n();
  const host = useRef<HTMLElement>(null);
  const position = useRef<DiffPosition | undefined>(undefined);
  const [wide, setWide] = useState(false);
  const [localSide, setLocalSide] = useState<boolean>();
  const [fullscreen, setFullscreen] = useState(false);
  const [navigation, setNavigation] = useState<DiffNavigation>({
    current: 0,
    total: 0,
    move: () => {},
  });
  const side = props.sideBySide ?? localSide ?? wide;
  const kind = props.kind ?? (props.staged ? "staged" : "working");
  const identity = `${kind}:${props.path}`;
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setWide((entry?.contentRect.width ?? 0) >= 1000),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [fullscreen]);
  const labels =
    kind === "staged"
      ? ["HEAD", t("editor.diffIndex")]
      : kind === "working"
        ? [t("editor.diffIndex"), t("editor.diffWorking")]
        : kind === "history"
          ? [`${props.revision?.slice(0, 8) ?? "commit"}^`, props.revision?.slice(0, 8) ?? "commit"]
          : [t("editor.diffDisk"), t("editor.diffBuffer")];
  const readonly = kind === "history" || kind === "disk";
  const empty = !props.images && props.original === props.content;
  const frame = (
    <section
      ref={host}
      className="flex h-full min-h-0 flex-col bg-[var(--editor-bg)]"
      aria-label={`${t("editor.diff")} · ${props.path}`}
      aria-busy={props.busy}
    >
      <header className="flex min-h-16 shrink-0 items-center justify-between gap-4 border-b border-[var(--editor-border)] px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{props.path.split("/").pop()}</span>
            <Tag>
              {t(
                readonly
                  ? "editor.diffReadOnly"
                  : kind === "staged"
                    ? "editor.staged"
                    : "editor.changes",
              )}
            </Tag>
          </div>
          <div className="mt-1 truncate text-xs text-[var(--editor-muted)]" title={props.path}>
            {props.path}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {props.onOpen && (
            <Button size="small" type="text" onClick={props.onOpen}>
              {t("editor.reviewOpenFile")}
            </Button>
          )}
          {props.onRefresh && (
            <Tooltip title={t("editor.gitRefresh")}>
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                aria-label={t("editor.gitRefresh")}
                onClick={props.onRefresh}
                disabled={Boolean(props.busy)}
              />
            </Tooltip>
          )}
          {props.embedded && !fullscreen && kind !== "history" && (
            <Tooltip title={t("editor.diffFullscreen")}>
              <Button
                type="text"
                size="small"
                icon={<ExpandOutlined />}
                aria-label={t("editor.diffFullscreen")}
                onClick={() => setFullscreen(true)}
              />
            </Tooltip>
          )}
          {props.onFileAction && !readonly && (
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "file",
                    label: t(props.staged ? "editor.diffUnstageFile" : "editor.diffStageFile"),
                    disabled: Boolean(props.busy || props.actionsDisabled),
                    onClick: props.onFileAction,
                  },
                ],
              }}
            >
              <Button
                type="text"
                size="small"
                icon={<EllipsisOutlined />}
                aria-label={t("editor.more")}
              />
            </Dropdown>
          )}
        </div>
      </header>
      {props.notice && (
        <p
          role="status"
          className="m-0 border-b border-[var(--editor-border)] px-4 py-2 text-xs text-[var(--ant-color-warning-text)]"
        >
          {props.notice}
        </p>
      )}
      {!props.images && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--editor-border)] px-4 py-2">
          <Segmented
            size="small"
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
          <div className="flex items-center gap-1">
            <Tooltip title={t("editor.previousChange")}>
              <Button
                type="text"
                size="small"
                icon={<ArrowUpOutlined />}
                aria-label={t("editor.previousChange")}
                disabled={empty || !navigation.total || navigation.current <= 1}
                onClick={() => navigation.move(-1)}
              />
            </Tooltip>
            <span
              role="status"
              className="min-w-12 text-center text-xs tabular-nums text-[var(--editor-muted)]"
            >
              {empty ? "0 / 0" : `${navigation.current} / ${navigation.total}`}
            </span>
            <Tooltip title={t("editor.nextChange")}>
              <Button
                type="text"
                size="small"
                icon={<ArrowDownOutlined />}
                aria-label={t("editor.nextChange")}
                disabled={empty || !navigation.total || navigation.current >= navigation.total}
                onClick={() => navigation.move(1)}
              />
            </Tooltip>
          </div>
        </div>
      )}
      <div
        className={`grid shrink-0 border-b border-[var(--editor-border)] bg-[var(--editor-panel)] text-xs text-[var(--editor-muted)] ${side && !props.images ? "grid-cols-2" : "grid-cols-1"}`}
      >
        {side && !props.images ? (
          labels.map((label, index) => (
            <div
              key={index}
              className={`truncate px-4 py-2 ${index ? "border-l border-[var(--editor-border)]" : ""}`}
            >
              {label}
            </div>
          ))
        ) : (
          <div className="flex items-center gap-2 px-4 py-2">
            <span>{labels[0]}</span>
            <span aria-hidden>→</span>
            <span>{labels[1]}</span>
          </div>
        )}
      </div>
      {props.images ? (
        <div className="min-h-0 flex-1">
          <EditorImageDiff
            path={props.path}
            original={props.original}
            content={props.content}
            images={props.images}
          />
        </div>
      ) : empty ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("editor.diffEmpty")} />
        </div>
      ) : (
        <EditorDiffCode
          path={props.path}
          original={props.original}
          content={props.content}
          dark={props.dark}
          side={side}
          hunks={props.hunks}
          onHunk={readonly ? undefined : props.onHunk}
          hunkLabel={t(props.staged ? "editor.hunkUnstage" : "editor.hunkStage")}
          busy={props.busy || props.actionsDisabled}
          identity={identity}
          onNavigation={setNavigation}
          position={position}
        />
      )}
    </section>
  );
  return props.embedded && !fullscreen ? (
    frame
  ) : (
    <Modal
      open
      centered
      title={t("editor.diff")}
      footer={null}
      width="calc(100vw - 48px)"
      className="cpl-editor-overlay"
      styles={{
        body: { height: "78dvh", padding: 0 },
        container: { padding: 0, overflow: "hidden" },
        header: {
          padding: "16px 24px",
          marginBottom: 0,
          borderBottom: "1px solid var(--editor-border)",
        },
      }}
      onCancel={() => (fullscreen ? setFullscreen(false) : props.close())}
      destroyOnHidden
    >
      {frame}
    </Modal>
  );
}
