import { Alert, Button, Descriptions, Drawer, Table, Tag, Typography } from "antd";

import type { WorktreeAuditItem } from "../../../worktree-audit-types.js";
import { useI18n } from "../../app/i18n.js";
import { auditLabel } from "./worktreeAuditLabels.js";

interface Props {
  item: WorktreeAuditItem | undefined;
  disabled: boolean;
  onClose: () => void;
  onIgnore: (item: WorktreeAuditItem) => void;
  onOpen: (item: WorktreeAuditItem) => void;
}

export function WorktreeAuditDrawer({ item, disabled, onClose, onIgnore, onOpen }: Props) {
  const { t } = useI18n();
  const rows = item
    ? ([
        ["audit.repository", item.repositoryPath],
        ["audit.category", auditLabel(item.category, t)],
        ["audit.references", item.references.join(", ") || t("audit.none")],
        ["audit.branch", item.branch ?? t("audit.detached")],
        ["audit.head", item.head ?? "—"],
        ["audit.commonDirectory", item.commonDirectory],
        ["audit.locked", item.locked ?? "—"],
        ["audit.prunable", item.prunable ?? "—"],
        ["audit.upstream", item.upstream ?? "—"],
        ["audit.ahead", item.ahead ?? "—"],
        ["audit.unpublished", item.unpublished ?? "—"],
        ["audit.operations", item.operations.join(", ") || t("audit.none")],
      ] as const)
    : [];
  return (
    <Drawer
      title={item?.repositoryName}
      open={Boolean(item)}
      onClose={onClose}
      size="large"
      destroyOnHidden
      footer={
        item && (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={disabled || item.exists !== true || item.category === "unregistered"}
              onClick={() => onOpen(item)}
            >
              {t("audit.vscode")}
            </Button>
            <Button disabled={disabled} onClick={() => onIgnore(item)}>
              {t(item.ignored ? "audit.restore" : "audit.ignore")}
            </Button>
          </div>
        )
      }
    >
      {item && (
        <div className="flex flex-col gap-6">
          <Typography.Text className="break-all" copyable>
            {item.path}
          </Typography.Text>
          <Typography.Text type="secondary">{t("audit.notice")}</Typography.Text>
          {item.error && <Alert type="error" showIcon title={item.error} />}
          <div className="flex flex-wrap gap-2">
            {item.risks.map((risk) => (
              <Tag
                key={risk}
                color={risk === "conflicts" || risk === "unknown" ? "error" : "warning"}
              >
                {auditLabel(risk, t)}
              </Tag>
            ))}
            {!item.risks.length && (
              <Typography.Text type="secondary">{t("audit.noRisks")}</Typography.Text>
            )}
          </div>
          <Descriptions
            column={1}
            size="small"
            bordered
            items={rows.map(([key, value]) => ({
              key,
              label: t(key),
              children: <span className="break-all">{value}</span>,
            }))}
          />
          <section className="flex flex-col gap-4">
            <Typography.Text type="secondary">{t("audit.ignoredSummary")}</Typography.Text>
            <Typography.Title level={5} className="!m-0">
              {t("audit.changes")} ({item.changes.length})
            </Typography.Title>
            <Table
              size="small"
              rowKey={(change) => `${change.status}:${change.path}`}
              dataSource={item.changes}
              pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
              locale={{ emptyText: t("audit.noChanges") }}
              columns={[
                {
                  title: "Git",
                  dataIndex: "status",
                  width: 64,
                  render: (status: string) => <code>{status}</code>,
                },
                {
                  title: t("audit.repository"),
                  dataIndex: "path",
                  render: (path: string, change) => (
                    <span className="break-all">
                      {change.from ? `${change.from} → ` : ""}
                      {path}
                    </span>
                  ),
                },
              ]}
            />
          </section>
          <Typography.Text type="secondary">{t("audit.ignoreNote")}</Typography.Text>
        </div>
      )}
    </Drawer>
  );
}
