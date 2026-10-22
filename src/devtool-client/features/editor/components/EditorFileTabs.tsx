import type { DragEvent, ReactNode } from "react";
import { Badge, Tabs, Tooltip } from "antd";
import { CloseOutlined, EyeOutlined, FileTextOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import { moveEditorTab, tabId, type EditorColumn } from "../utils/editorState.js";
import type { useEditorWorkbench } from "../hooks/useEditorWorkbench.js";

export default function EditorFileTabs({
  column,
  editor: e,
  children,
}: {
  column: EditorColumn;
  editor: Pick<ReturnType<typeof useEditorWorkbench>, "documents" | "setColumns" | "close">;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const drop = (event: DragEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const data: unknown = JSON.parse(event.dataTransfer.getData("application/cpl-editor-tab"));
      if (
        data &&
        typeof data === "object" &&
        "from" in data &&
        "id" in data &&
        typeof data.from === "string" &&
        typeof data.id === "string"
      ) {
        const { from, id } = data;
        e.setColumns((all) => moveEditorTab(all, from, column.id, id, index));
      }
    } catch {
      // Non-editor drops leave tabs and unsaved buffers unchanged.
    }
  };
  if (!column.tabs.length)
    return (
      <>
        <div
          className="h-12 shrink-0 border-b border-[var(--editor-border)]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => drop(event, 0)}
        />
        {children}
      </>
    );
  return (
    <Tabs
      className="editor-file-tabs min-h-0 flex-1"
      type="editable-card"
      size="small"
      hideAdd
      activeKey={column.active}
      animated={false}
      styles={{ body: { height: "100%", overflow: "hidden" }, content: { height: "100%" } }}
      more={{ trigger: "click" }}
      locale={{ removeAriaLabel: t("editor.close"), dropdownAriaLabel: t("editor.more") }}
      onChange={(active) =>
        e.setColumns((all) => all.map((c) => (c.id === column.id ? { ...c, active } : c)))
      }
      onEdit={(key, action) => {
        if (action === "remove" && typeof key === "string") void e.close(column.id, key);
      }}
      renderTabBar={(props, DefaultTabBar) => (
        <div
          className="editor-tabs shrink-0 pt-2"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => drop(event, column.tabs.length)}
        >
          <DefaultTabBar {...props} />
        </div>
      )}
      items={column.tabs.map((item, index) => {
        const id = tabId(item);
        const doc = e.documents[item.path];
        const dirty = doc !== undefined && doc.content !== doc.saved;
        return {
          key: id,
          closeIcon: (
            <Tooltip title={t("editor.close")}>
              <CloseOutlined />
            </Tooltip>
          ),
          label: (
            <Tooltip title={item.path}>
              <span
                className={`flex max-w-48 items-center gap-2 ${item.pinned ? "" : "italic"}`}
                draggable
                onDoubleClick={() =>
                  e.setColumns((all) =>
                    all.map((c) =>
                      c.id === column.id
                        ? {
                            ...c,
                            tabs: c.tabs.map((tab) =>
                              tabId(tab) === id ? { ...tab, pinned: true } : tab,
                            ),
                          }
                        : c,
                    ),
                  )
                }
                onAuxClick={(event) => {
                  if (event.button === 1) {
                    event.preventDefault();
                    void e.close(column.id, id);
                  }
                }}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "application/cpl-editor-tab",
                    JSON.stringify({ from: column.id, id }),
                  )
                }
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => drop(event, index)}
              >
                {item.preview ? <EyeOutlined /> : <FileTextOutlined />}
                <span className="truncate">{item.path.split("/").pop()}</span>
                {dirty && (
                  <Badge color="var(--editor-accent)" title={t("editor.dirty", { count: 1 })} />
                )}
              </span>
            </Tooltip>
          ),
          children: column.active === id ? children : null,
          destroyOnHidden: true,
        };
      })}
    />
  );
}
