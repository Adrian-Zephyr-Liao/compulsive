import { CodeOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Button, Drawer, Empty, Listy, Tooltip, Typography } from "antd";

import { useI18n } from "../../../app/i18n.js";
import type { DevtoolWorkspace } from "../../../../devtool.js";
import type { WorkspaceMember, WorkspaceMemberStatus } from "../../../../types.js";

const { Text } = Typography;

export interface RepositoryDetailDrawerProps {
  busy: boolean;
  codexTask: "starting" | "running" | undefined;
  member: WorkspaceMember | undefined;
  status: WorkspaceMemberStatus | undefined;
  workspace: DevtoolWorkspace | undefined;
  onClose: () => void;
  onOpenCodex: (workspace: DevtoolWorkspace, member: WorkspaceMember) => void;
  onOpenVscode: (workspace: DevtoolWorkspace, member: WorkspaceMember) => void;
}

export function RepositoryDetailDrawer({
  busy,
  codexTask,
  member,
  status,
  workspace,
  onClose,
  onOpenCodex,
  onOpenVscode,
}: RepositoryDetailDrawerProps) {
  const { t } = useI18n();
  const hasConflicts = Boolean(status?.conflicts.length);

  return (
    <Drawer
      closable={{ "aria-label": t("drawer.close") }}
      destroyOnHidden
      extra={
        member && workspace && !hasConflicts ? (
          <Button icon={<CodeOutlined />} onClick={() => onOpenVscode(workspace, member)}>
            {t("drawer.openVscode")}
          </Button>
        ) : null
      }
      open={Boolean(member)}
      size={480}
      title={
        member
          ? `${member.alias} · ${hasConflicts ? t("drawer.conflictDetails") : t("drawer.localDetails")}`
          : t("drawer.localDetails")
      }
      onClose={onClose}
    >
      {member &&
        workspace &&
        (!status?.conflicts.length && !status?.changes.length ? (
          <Empty description={t("drawer.noChanges")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="grid gap-6">
            {hasConflicts && (
              <section className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-3">
                <Text strong>{t("drawer.chooseMethod")}</Text>
                <Text className="mt-1 mb-3 block" type="secondary">
                  {t("drawer.methodDescription")}
                </Text>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    block
                    disabled={busy}
                    icon={<CodeOutlined />}
                    type="primary"
                    onClick={() => onOpenVscode(workspace, member)}
                  >
                    {t("drawer.manualVscode")}
                  </Button>
                  <Tooltip title={t("drawer.codexTip")}>
                    <Button
                      block
                      disabled={busy || Boolean(codexTask)}
                      icon={<ThunderboltOutlined />}
                      loading={Boolean(codexTask)}
                      onClick={() => onOpenCodex(workspace, member)}
                    >
                      {codexTask === "starting"
                        ? t("drawer.starting")
                        : codexTask === "running"
                          ? t("drawer.codexRunning")
                          : t("drawer.handToCodex")}
                    </Button>
                  </Tooltip>
                </div>
              </section>
            )}
            {Boolean(status?.conflicts.length) && (
              <section>
                <Text className="mb-2 block" strong type="danger">
                  {t("drawer.conflictFiles", { count: status!.conflicts.length })}
                </Text>
                <Listy<string>
                  className="rounded-md border border-[var(--ant-color-border-secondary)]"
                  classNames={{ item: "!px-3 !py-2" }}
                  items={status!.conflicts}
                  rowKey={(item) => item}
                  itemRender={(item) => <Text code>{item}</Text>}
                />
              </section>
            )}
            {Boolean(status?.changes.length) && (
              <section>
                <Text className="mb-2 block" strong>
                  {t("drawer.changes", { count: status!.changes.length })}
                </Text>
                <Listy<string>
                  className="rounded-md border border-[var(--ant-color-border-secondary)]"
                  classNames={{ item: "!px-3 !py-2" }}
                  items={status!.changes}
                  rowKey={(item) => item}
                  itemRender={(item) => <Text code>{item}</Text>}
                />
              </section>
            )}
          </div>
        ))}
    </Drawer>
  );
}
