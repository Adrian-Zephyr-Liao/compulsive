import { lazy, Suspense, useRef } from "react";
import { Button, Dropdown, Empty, Spin, Tabs, Tooltip } from "antd";
import { CloseOutlined, CodeOutlined, EllipsisOutlined, PlusOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import type { useEditorWorkbench } from "../hooks/useEditorWorkbench.js";
import type { useEditorTerminals } from "../hooks/useEditorTerminals.js";
const EditorTerminal = lazy(() => import("./EditorTerminal.js"));
interface Props {
  editor: Pick<ReturnType<typeof useEditorWorkbench>, "preferences" | "setPreferences" | "report">;
  terminals: ReturnType<typeof useEditorTerminals>;
  terminalOpen: boolean;
  setTerminalOpen: (open: boolean) => void;
}
export default function EditorTerminalDock({
  editor,
  terminals,
  terminalOpen,
  setTerminalOpen,
}: Props) {
  const { t } = useI18n();
  const opened = useRef(terminalOpen);
  if (terminalOpen) opened.current = true;
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-[var(--editor-bg)]"
      aria-hidden={!terminalOpen}
      inert={!terminalOpen}
    >
      <Tabs
        className={terminals.sessions.length ? "min-h-0 flex-1" : "shrink-0"}
        type="editable-card"
        size="small"
        activeKey={terminals.selected}
        onChange={terminals.setSelected}
        animated={false}
        locale={{
          removeAriaLabel: t("editor.closeTerminal"),
          addAriaLabel: t("editor.newTerminal"),
          dropdownAriaLabel: t("editor.more"),
        }}
        onEdit={(key, action) => {
          if (action === "add") terminals.create();
          else if (typeof key === "string") void terminals.close(key).catch(editor.report);
        }}
        addIcon={
          <Tooltip title={t("editor.newTerminal")}>
            <PlusOutlined />
          </Tooltip>
        }
        styles={{
          header: { background: "var(--editor-panel)", paddingTop: 8 },
          body: { height: "100%", overflow: "hidden" },
          content: { height: "100%" },
        }}
        tabBarExtraContent={
          <div className="flex items-center gap-1 px-2">
            {terminals.selected && (
              <Dropdown
                trigger={["click"]}
                menu={{
                  items: [
                    {
                      key: "restart",
                      label: t("editor.restart"),
                      onClick: () => terminals.create(terminals.selected),
                    },
                    ...(["bottom", "side", "editor"] as const).map((position) => ({
                      key: position,
                      label: t(`editor.${position}`),
                      onClick: () =>
                        editor.setPreferences((p) => ({ ...p, terminalPlacement: position })),
                    })),
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
            <Tooltip title={t("editor.close")}>
              <Button
                type="text"
                size="small"
                onClick={() => setTerminalOpen(false)}
                aria-label={t("editor.close")}
                icon={<CloseOutlined />}
              />
            </Tooltip>
          </div>
        }
        items={terminals.sessions.map((s, index) => ({
          key: s.id,
          label: `${s.title} ${index + 1}`,
          icon: <CodeOutlined />,
          closeIcon: (
            <Tooltip title={t("editor.closeTerminal")}>
              <CloseOutlined />
            </Tooltip>
          ),
          forceRender: true,
          children: opened.current && (
            <Suspense
              fallback={
                <div className="p-6 text-center">
                  <Spin />
                </div>
              }
            >
              <EditorTerminal
                key={s.id}
                id={s.id}
                active={terminalOpen && terminals.selected === s.id}
                write={terminals.write}
                resize={terminals.resize}
                wait={terminals.wait}
                report={editor.report}
              />
            </Suspense>
          ),
        }))}
      />
      {!terminals.sessions.length && opened.current && (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("editor.terminalEmpty")}>
            <Button onClick={() => terminals.create()}>{t("editor.newTerminal")}</Button>
          </Empty>
        </div>
      )}
    </div>
  );
}
