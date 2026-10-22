import { Button, Dropdown, Input, Modal, Spin } from "antd";
import {
  BranchesOutlined,
  ClockCircleOutlined,
  EllipsisOutlined,
  MinusOutlined,
  PlusOutlined,
  ReloadOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { lazy, Suspense } from "react";
import { useI18n } from "../../../app/i18n.js";
import type { useEditorGit } from "../hooks/useEditorGit.js";
import { BranchSelect } from "../../workspaces/components/BranchSelect.js";
import EditorGitHistory from "./EditorGitHistory.js";
import { groupGitChanges } from "../utils/gitChanges.js";
const EditorDiff = lazy(() => import("./EditorDiff.js"));
interface Props {
  git: ReturnType<typeof useEditorGit>;
  dark: boolean;
  report: (e: unknown) => void;
  open: (path: string) => void;
}
export default function EditorGit({ git: g, dark, report, open }: Props) {
  const { t } = useI18n();
  const changes = g.status?.changes.filter((c) => !c.ignored) ?? [];
  const groups = groupGitChanges(g.status);
  return (
    <>
      <div className="flex h-full min-h-0 flex-col">
        <div className="editor-minirow justify-between">
          <button className="min-w-0 truncate" onClick={() => void g.loadBranches()}>
            <BranchesOutlined /> {g.status?.branch || "HEAD"}
          </button>
          <div className="flex">
            <Button
              type="text"
              size="small"
              icon={<ClockCircleOutlined />}
              aria-label={t("editor.history")}
              onClick={() => void g.loadHistory()}
            />
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined spin={g.busy} />}
              aria-label={t("editor.gitRefresh")}
              onClick={() => void g.refresh().catch(report)}
            />
            <Dropdown
              trigger={["click"]}
              menu={{
                items: [
                  {
                    key: "discard-all",
                    label: t("editor.discardAll"),
                    danger: true,
                    disabled: g.busy || !changes.length,
                    onClick: () => void g.discardAll(),
                  },
                  ...(["fetch", "pull", "push", "amend", "undo"] as const).map((operation) => ({
                    key: operation,
                    label: t(`editor.${operation}`),
                    onClick: () => void g.run(operation),
                  })),
                  ...(g.status?.forcePushRequired
                    ? [
                        {
                          key: "force-push",
                          label: t("operation.forcePush"),
                          danger: true,
                          onClick: () => void g.run("push", [], true),
                        },
                      ]
                    : []),
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
          </div>
        </div>
        <div className="flex flex-col gap-2 border-b border-[var(--editor-border)] p-3">
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 6 }}
            aria-label={t("editor.commitMessage")}
            placeholder={t("editor.commitMessage")}
            value={g.message}
            onChange={(e) => g.setMessage(e.target.value)}
          />
          <Button
            icon={<ThunderboltOutlined />}
            loading={g.generating}
            disabled={g.busy || !groups[1].items.length || Boolean(groups[0].items.length)}
            onClick={() => void g.generateMessage()}
          >
            {t("editor.generateMessage")}
          </Button>
          <Button
            type="primary"
            loading={g.busy}
            disabled={
              g.busy ||
              !g.message.trim() ||
              !groups[1].items.length ||
              Boolean(groups[0].items.length)
            }
            onClick={() => void g.run("commit")}
          >
            {t("editor.commit")}
          </Button>
          {g.status?.upstream && (
            <p className="truncate text-xs text-[var(--editor-muted)]" title={g.status.upstream}>
              {g.status.upstream} · ↑{g.status.ahead} ↓{g.status.behind}
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto py-1">
          {g.status?.excludedChanges && (
            <p role="status" className="px-3 py-2 text-xs text-[var(--ant-color-warning-text)]">
              {t("editor.excludedChanges")}
            </p>
          )}
          {groups.map(
            (group) =>
              group.items.length > 0 && (
                <section key={group.key}>
                  <div className="editor-minirow justify-between !border-0 !px-3">
                    <span>
                      {t(`editor.${group.key}`)}{" "}
                      <span className="text-[var(--editor-muted)]">{group.items.length}</span>
                    </span>
                    {group.key !== "conflicts" && (
                      <Button
                        type="text"
                        size="small"
                        icon={group.staged ? <MinusOutlined /> : <PlusOutlined />}
                        aria-label={t(group.staged ? "editor.unstageAll" : "editor.stageAll")}
                        onClick={() =>
                          void g.run(
                            group.staged ? "unstage" : "stage",
                            group.items.map((c) => c.path),
                          )
                        }
                      />
                    )}
                  </div>
                  {group.items.map((change) => (
                    <div
                      key={change.path}
                      className="editor-result flex items-center gap-1 px-3 py-1"
                    >
                      <button
                        className="min-w-0 flex-1 truncate text-left text-sm"
                        title={change.path}
                        onClick={() =>
                          group.key === "conflicts" || group.key === "untracked"
                            ? open(change.path)
                            : void g.inspect(change.path, group.staged)
                        }
                      >
                        {change.path.split("/").pop()}{" "}
                        <span className="ml-1 text-xs text-[var(--editor-muted)]">
                          {change.path.includes("/")
                            ? change.path.slice(0, change.path.lastIndexOf("/"))
                            : ""}
                        </span>
                      </button>
                      <span
                        className={
                          change.conflict
                            ? "text-[var(--ant-color-error)]"
                            : "text-[var(--ant-color-warning)]"
                        }
                      >
                        {group.staged ? change.index : change.worktree}
                      </span>
                      <Dropdown
                        trigger={["click"]}
                        menu={{
                          items: [
                            {
                              key: "open",
                              label: t("editor.editor"),
                              onClick: () => open(change.path),
                            },
                            {
                              key: "stage",
                              label: t(group.staged ? "editor.unstage" : "editor.stage"),
                              onClick: () =>
                                void g.run(group.staged ? "unstage" : "stage", [change.path]),
                            },
                            ...(!group.staged &&
                            group.key !== "untracked" &&
                            group.key !== "conflicts"
                              ? [
                                  {
                                    key: "discard",
                                    label: t("editor.discard"),
                                    danger: true,
                                    onClick: () => void g.run("discard", [change.path]),
                                  },
                                ]
                              : []),
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
                    </div>
                  ))}
                </section>
              ),
          )}
          {g.status && !changes.length && !g.status.excludedChanges && (
            <p className="p-5 text-center text-xs text-[var(--editor-muted)]">
              {t("editor.clean")}
            </p>
          )}
        </div>
      </div>
      {g.diff && (
        <Suspense fallback={<Spin />}>
          <EditorDiff
            {...g.diff}
            onHunk={(index) => void g.hunk(index)}
            dark={dark}
            close={() => g.setDiff(undefined)}
          />
        </Suspense>
      )}
      <EditorGitHistory git={g} />
      <Modal
        open={g.branchOpen}
        title={t("editor.branch")}
        onCancel={() => g.setBranchOpen(false)}
        onOk={() => void g.switchBranch()}
        confirmLoading={g.busy}
        okButtonProps={{ disabled: !g.branch.trim() }}
      >
        <p className="mb-4 mt-4 text-xs text-[var(--editor-muted)]">{t("editor.branchHint")}</p>
        <BranchSelect
          value={g.branch}
          onChange={g.setBranch}
          branches={g.branches}
          loading={g.busy}
          onFocus={() => {}}
          ariaLabel={t("editor.branch")}
        />
      </Modal>
    </>
  );
}
