import { useEffect, useState } from "react";
import { Button, Dropdown, Spin, Tree, Tooltip } from "antd";
import type { TreeDataNode } from "antd";
import {
  CodeOutlined,
  FileAddOutlined,
  FileTextOutlined,
  FolderAddOutlined,
  FolderOutlined,
  ReloadOutlined,
  VerticalAlignTopOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import type { ProjectDirectory } from "../../../../project/files.js";
import type { ProjectGitChange } from "../../../../project/git.js";
import type { FileAction } from "../types.js";
interface Props {
  directories: Record<string, ProjectDirectory>;
  loading: boolean;
  path: string;
  changes: ProjectGitChange[];
  load: (path: string) => Promise<void>;
  open: (path: string, pinned?: boolean) => void;
  action: (action: FileAction, path: string) => void;
  refresh: () => void;
  report: (e: unknown) => void;
  name: string;
}
export default function EditorExplorer(props: Props) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState<string[]>([]);
  useEffect(() => {
    const parents = props.path.split("/").slice(0, -1);
    setExpanded((current) => [
      ...new Set([...current, ...parents.map((_, i) => parents.slice(0, i + 1).join("/"))]),
    ]);
  }, [props.path]);
  const nodes = (parent: string): TreeDataNode[] =>
    (props.directories[parent]?.entries ?? []).map((entry) => {
      const change = props.changes.find((c) => c.path === entry.path);
      const ignored =
        change?.ignored ||
        props.changes.some((c) => c.ignored && entry.path.startsWith(`${c.path}/`));
      const menu = (["newFile", "newFolder", "rename", "reveal", "trash"] as const).map(
        (action) => ({
          key: action,
          label: t(`editor.${action}`),
          danger: action === "trash",
          onClick: ({ domEvent }: { domEvent: { stopPropagation(): void } }) => {
            domEvent.stopPropagation();
            props.action(
              action,
              entry.directory && action.startsWith("new") ? `${entry.path}/` : entry.path,
            );
          },
        }),
      );
      return {
        key: entry.path,
        isLeaf: !entry.directory,
        icon: entry.directory ? (
          <FolderOutlined />
        ) : /\.(?:[cm]?[jt]sx?|json|css|html|vue|py|go|rs)$/.test(entry.name) ? (
          <CodeOutlined className="text-[var(--editor-accent)]" />
        ) : (
          <FileTextOutlined />
        ),
        title: (
          <Dropdown trigger={["contextMenu"]} menu={{ items: menu }}>
            <span
              className={`flex min-w-0 items-center gap-2 ${ignored ? "opacity-40" : ""}`}
              onDoubleClick={() => {
                if (!entry.directory) props.open(entry.path, true);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {change && !ignored && (
                <span
                  className={
                    change.conflict
                      ? "text-[var(--ant-color-error)]"
                      : "text-[var(--ant-color-warning)]"
                  }
                >
                  {change.index === "?" ? "U" : change.index.trim() || change.worktree.trim()}
                </span>
              )}
            </span>
          </Dropdown>
        ),
        ...(props.directories[entry.path] ? { children: nodes(entry.path) } : {}),
      };
    });
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="editor-minirow justify-between">
        <span className="truncate font-medium">{props.name}</span>
        <div className="flex gap-1">
          {(
            [
              {
                key: "newFile",
                icon: <FileAddOutlined />,
                click: () => props.action("newFile", ""),
              },
              {
                key: "newFolder",
                icon: <FolderAddOutlined />,
                click: () => props.action("newFolder", ""),
              },
              { key: "refresh", icon: <ReloadOutlined />, click: props.refresh },
              { key: "collapse", icon: <VerticalAlignTopOutlined />, click: () => setExpanded([]) },
            ] as const
          ).map((action) => (
            <Tooltip key={action.key} title={t(`editor.${action.key}`)}>
              <Button
                type="text"
                size="small"
                aria-label={t(`editor.${action.key}`)}
                icon={action.icon}
                onClick={action.click}
              />
            </Tooltip>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {props.loading ? (
          <div className="p-6 text-center">
            <Spin size="small" />
          </div>
        ) : (
          <Tree
            blockNode
            showIcon
            selectedKeys={props.path ? [props.path] : []}
            expandedKeys={expanded}
            onExpand={(keys) => setExpanded(keys.map(String))}
            treeData={nodes("")}
            loadedKeys={Object.keys(props.directories)}
            loadData={(node) => props.load(String(node.key)).catch(props.report)}
            onSelect={(_, info) => {
              if (info.node.isLeaf) props.open(String(info.node.key));
            }}
          />
        )}
        {Object.values(props.directories).some((d) => d.truncated) && (
          <p className="px-3 text-xs text-[var(--editor-muted)]">
            {t("editor.directoryTruncated")}
          </p>
        )}
      </div>
    </div>
  );
}
