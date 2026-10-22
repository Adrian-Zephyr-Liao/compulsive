import { Badge, Breadcrumb, Button, Tooltip, Typography } from "antd";
import {
  ArrowLeftOutlined,
  BranchesOutlined,
  CodeOutlined,
  GlobalOutlined,
  LayoutOutlined,
  SaveOutlined,
  SearchOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import { routePaths } from "../../../app/routes.js";
import type { DevtoolWorkspace } from "../../../../devtool.js";
import type { useEditorWorkbench } from "../hooks/useEditorWorkbench.js";
import type { useEditorGit } from "../hooks/useEditorGit.js";
type Member = DevtoolWorkspace["members"][number];
type Editor = ReturnType<typeof useEditorWorkbench>;
export function EditorTitlebar({
  workspace,
  member,
  editor,
  leave,
  setPalette,
  setTerminalOpen,
  setSettings,
}: {
  workspace: DevtoolWorkspace;
  member: Member;
  editor: Pick<Editor, "saveAll" | "report" | "split">;
  leave: (path: string) => Promise<void>;
  setPalette: (value: string) => void;
  setTerminalOpen: (value: (open: boolean) => boolean) => void;
  setSettings: (open: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <header className="editor-titlebar flex h-12 shrink-0 items-center gap-2 border-b border-[var(--editor-border)] px-4">
      <Tooltip title={t("editor.back")}>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={() => void leave(routePaths.requirement(workspace.id))}
          aria-label={t("editor.back")}
        />
      </Tooltip>
      <div className="min-w-0 flex-1" title={`${workspace.name} / ${member.alias}`}>
        <Breadcrumb
          className="editor-breadcrumb"
          items={[{ title: workspace.name }, { title: member.alias }]}
        />
      </div>
      <Button
        className="editor-quickopen min-w-0 max-w-96 flex-1"
        icon={<SearchOutlined />}
        onClick={() => setPalette("")}
      >
        <span className="flex-1 truncate text-left">{t("editor.quickOpen")}</span>
        <Typography.Text keyboard>⌘P</Typography.Text>
      </Button>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {(
          [
            {
              key: "saveAll",
              icon: <SaveOutlined />,
              run: () => void editor.saveAll().catch(editor.report),
            },
            { key: "split", icon: <LayoutOutlined />, run: editor.split },
            { key: "terminal", icon: <CodeOutlined />, run: () => setTerminalOpen((v) => !v) },
            { key: "settings", icon: <SettingOutlined />, run: () => setSettings(true) },
          ] as const
        ).map((item) => (
          <Tooltip key={item.key} title={t(`editor.${item.key}`)}>
            <Button
              type="text"
              icon={item.icon}
              onClick={item.run}
              aria-label={t(`editor.${item.key}`)}
            />
          </Tooltip>
        ))}
      </div>
    </header>
  );
}
export function EditorRepositoryRail({
  workspace,
  repositoryId,
  leave,
  onOpenVscode,
}: {
  workspace: DevtoolWorkspace;
  repositoryId: string;
  leave: (path: string) => Promise<void>;
  onOpenVscode: (id: string) => void;
}) {
  const { t, locale, setLocale } = useI18n();
  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-[var(--editor-border)] bg-[var(--editor-panel)] py-4"
      aria-label={workspace.name}
    >
      <img src="./compulsive-logo.svg" alt="Compulsive" className="mb-2 size-8 shrink-0" />
      {workspace.members.map((m) => (
        <Tooltip key={m.repositoryId} title={m.alias} placement="right">
          <Button
            type="text"
            className={`shrink-0 ${m.repositoryId === repositoryId ? "!bg-[var(--editor-selection)] !text-[var(--editor-accent)]" : "text-[var(--editor-muted)]"}`}
            style={{ width: 32, paddingInline: 0 }}
            onClick={() => void leave(routePaths.codePreview(workspace.id, m.repositoryId))}
            aria-current={m.repositoryId === repositoryId ? "page" : undefined}
            aria-label={m.alias}
          >
            {m.alias
              .split(/[-_]/)
              .map((v) => v[0])
              .join("")
              .slice(0, 2)
              .toUpperCase()}
          </Button>
        </Tooltip>
      ))}
      <div className="mt-auto flex flex-col gap-2 pt-4">
        <Tooltip title={t("editor.openVscode")} placement="right">
          <Button
            type="text"
            icon={<CodeOutlined />}
            aria-label={t("editor.openVscode")}
            onClick={() => onOpenVscode(repositoryId)}
          />
        </Tooltip>
        <Tooltip title={locale === "zh-CN" ? "English" : "中文"} placement="right">
          <Button
            type="text"
            icon={<GlobalOutlined />}
            onClick={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
            aria-label={locale === "zh-CN" ? "English" : "中文"}
          />
        </Tooltip>
      </div>
    </nav>
  );
}
export function EditorStatusBar({
  git,
  member,
  editor,
  connected,
  onGit,
  onSettings,
}: {
  git: Pick<ReturnType<typeof useEditorGit>, "status">;
  member: Member;
  editor: Pick<Editor, "dirty" | "preferences">;
  connected: boolean;
  onGit: () => void;
  onSettings: () => void;
}) {
  const { t } = useI18n();
  const branch = git.status?.branch || (member.mode === "worktree" && member.branch) || "HEAD";
  return (
    <footer className="editor-status flex min-h-8 shrink-0 items-center justify-between gap-4 border-t border-[var(--editor-border)] px-3 text-xs">
      <div className="flex min-w-0 items-center gap-3">
        <Tooltip title={branch}>
          <Button
            type="text"
            size="small"
            icon={<BranchesOutlined />}
            className="min-w-0 max-w-56"
            onClick={onGit}
          >
            <span className="truncate">{branch}</span>
          </Button>
        </Tooltip>
        <span className="shrink-0 text-[var(--editor-muted)]">
          {t(editor.dirty.length ? "editor.dirty" : "editor.saved", {
            count: editor.dirty.length,
          })}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-[var(--editor-muted)]">
        <span className="hidden lg:inline">
          {t(
            member.mode === "worktree" && !member.detached
              ? "editor.development"
              : "editor.reference",
          )}
        </span>
        <Tooltip title={t("editor.settings")}>
          <Button type="text" size="small" onClick={onSettings}>
            {editor.preferences.vim ? "Vim · " : ""}
            {editor.preferences.fontSize}px
          </Button>
        </Tooltip>
        <span className="flex items-center gap-2">
          <Badge status={connected ? "success" : "warning"} />
          {t(connected ? "editor.local" : "connection.reconnecting")}
        </span>
      </div>
    </footer>
  );
}
