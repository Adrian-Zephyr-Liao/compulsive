import { DownloadOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Collapse,
  Empty,
  Input,
  Progress,
  Select,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType } from "antd";
import { useState } from "react";

import type { WorktreeAuditItem, WorktreeCategory } from "../../../worktree-audit-types.js";
import { useI18n } from "../../app/i18n.js";
import type { WorkspaceRpc } from "../workspaces/types.js";
import { WorktreeAuditDrawer } from "./WorktreeAuditDrawer.js";
import { WorktreeRemovalDialog } from "./WorktreeRemovalDialog.js";
import { auditLabel } from "./worktreeAuditLabels.js";
import { useWorktreeAudit } from "./useWorktreeAudit.js";

interface Props {
  getRpc: () => Promise<WorkspaceRpc>;
  disabled: boolean;
  onRemoved: () => Promise<void>;
}
type Filter = "pending" | "all" | "ignored" | WorktreeCategory;

export function WorktreeAuditPanel({ getRpc, disabled, onRemoved }: Props) {
  const { t, formatDateTime } = useI18n();
  const { message } = AntApp.useApp();
  const audit = useWorktreeAudit(getRpc, onRemoved);
  const [filter, setFilter] = useState<Filter>("pending");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const running = audit.job?.status === "running";
  const locked = disabled || audit.busy || running;
  const items = audit.report?.items ?? [];
  const selected = items.find(({ id }) => id === selectedId);
  const filtered = items.filter((item) => {
    const visible =
      filter === "all" ||
      (filter === "ignored"
        ? item.ignored
        : filter === "pending"
          ? item.category !== "referenced" && !item.ignored
          : item.category === filter && !item.ignored);
    return (
      visible &&
      `${item.repositoryName} ${item.path} ${item.branch ?? ""}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
  });
  const columns: TableColumnsType<WorktreeAuditItem> = [
    {
      title: t("audit.repository"),
      key: "repository",
      width: 280,
      render: (_, item) => (
        <div className="flex min-w-0 flex-col gap-1">
          <Typography.Text strong ellipsis={{ tooltip: item.repositoryName }}>
            {item.repositoryName}
          </Typography.Text>
          <Typography.Text type="secondary" ellipsis={{ tooltip: item.path }}>
            {item.path}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: t("audit.branch"),
      dataIndex: "branch",
      width: 160,
      ellipsis: true,
      render: (branch: string | null) => (
        <Typography.Text ellipsis={{ tooltip: branch ?? t("audit.detached") }}>
          {branch ?? t("audit.detached")}
        </Typography.Text>
      ),
    },
    {
      title: t("audit.category"),
      key: "category",
      width: 180,
      render: (_, item) => (
        <div className="flex flex-wrap gap-1">
          <Tag color={item.category === "referenced" ? "default" : "warning"}>
            {auditLabel(item.category, t)}
          </Tag>
          {item.ignored && <Tag>{t("audit.ignored")}</Tag>}
        </div>
      ),
    },
    {
      title: t("audit.risks"),
      key: "risks",
      width: 220,
      render: (_, item) => (
        <div className="flex flex-wrap gap-1">
          {item.risks.slice(0, 2).map((risk) => (
            <Tag
              key={risk}
              color={risk === "conflicts" || risk === "unknown" ? "error" : "warning"}
            >
              {auditLabel(risk, t)}
            </Tag>
          ))}
          {item.risks.length > 2 && (
            <Button type="link" size="small" onClick={() => setSelectedId(item.id)}>
              +{item.risks.length - 2}
            </Button>
          )}
          {!item.risks.length && (
            <Typography.Text type="secondary">{t("audit.noRisks")}</Typography.Text>
          )}
        </div>
      ),
    },
    {
      title: t("audit.actions"),
      key: "actions",
      width: 280,
      fixed: "right",
      render: (_, item) => (
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Button className="!p-0" type="link" size="small" onClick={() => setSelectedId(item.id)}>
            {t("audit.details")}
          </Button>
          <Button
            className="!p-0"
            type="link"
            size="small"
            disabled={locked}
            onClick={() => void audit.ignore(item)}
          >
            {t(item.ignored ? "audit.restore" : "audit.ignore")}
          </Button>
          <Button
            className="!p-0"
            type="link"
            size="small"
            danger
            disabled={locked}
            loading={audit.previewingId === item.id}
            onClick={() => void audit.previewRemoval(item)}
          >
            {t("audit.remove")}
          </Button>
        </div>
      ),
    },
  ];
  function exportReport() {
    if (!audit.report) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(audit.report, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `cpl-worktree-audit-${audit.report.checkedAt.slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Typography.Title level={3} className="!m-0">
            {t("audit.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("audit.description")}</Typography.Text>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!audit.report} icon={<DownloadOutlined />} onClick={exportReport}>
            {t("audit.export")}
          </Button>
          {running ? (
            <Button disabled={disabled} onClick={() => void audit.cancel()}>
              {t("audit.cancel")}
            </Button>
          ) : (
            <Button
              type="primary"
              icon={<ReloadOutlined />}
              disabled={disabled || audit.loading || audit.busy}
              onClick={() => void audit.start()}
            >
              {t("audit.start")}
            </Button>
          )}
        </div>
      </header>
      <Typography.Text type="secondary">{t("audit.notice")}</Typography.Text>
      {audit.error && <Alert type="error" showIcon title={audit.error} />}
      {audit.retainedCommitRef && (
        <Alert
          type="info"
          showIcon
          title={t("audit.retainedCommit")}
          description={
            <Typography.Text copyable className="break-all">
              {audit.retainedCommitRef}
            </Typography.Text>
          }
        />
      )}
      {running && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <Typography.Text>
            {t("audit.progress", { completed: audit.job!.completed, total: audit.job!.total })}
          </Typography.Text>
          <Progress
            percent={
              audit.job!.total ? Math.round((audit.job!.completed / audit.job!.total) * 100) : 0
            }
            size="small"
          />
        </div>
      )}
      {audit.report && (
        <>
          {!audit.report.complete && <Alert type="warning" showIcon title={t("audit.partial")} />}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap gap-2">
              {(["unreferenced", "external", "missing", "unregistered"] as const).map(
                (category) => (
                  <Button
                    key={category}
                    size="small"
                    type={filter === category ? "primary" : "default"}
                    onClick={() => setFilter(category)}
                  >
                    {auditLabel(category, t)}{" "}
                    {items.filter((item) => item.category === category && !item.ignored).length}
                  </Button>
                ),
              )}
            </div>
            <Typography.Text type="secondary">
              {t("audit.checked", { time: formatDateTime(new Date(audit.report.checkedAt)) })}
            </Typography.Text>
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-4">
        <Select<Filter>
          aria-label={t("audit.category")}
          className="w-40"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "pending", label: t("audit.pending") },
            { value: "all", label: t("audit.all") },
            { value: "referenced", label: t("audit.referenced") },
            { value: "ignored", label: t("audit.ignored") },
            ...(["unreferenced", "external", "missing", "unregistered"] as const).map((value) => ({
              value,
              label: auditLabel(value, t),
            })),
          ]}
        />
        <Input
          className="min-w-48 flex-1"
          prefix={<SearchOutlined />}
          placeholder={t("audit.search")}
          aria-label={t("audit.search")}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          allowClear
        />
      </div>
      {audit.report ? (
        <Table<WorktreeAuditItem>
          loading={audit.loading}
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          size="small"
          tableLayout="fixed"
          scroll={{ x: 1140 }}
          pagination={{ pageSize: 10, showSizeChanger: false, hideOnSinglePage: true }}
        />
      ) : (
        <Empty description={t("audit.empty")} />
      )}
      {Boolean(audit.report?.errors.length) && (
        <Collapse
          items={[
            {
              key: "errors",
              label: `${t("audit.errors")} (${audit.report!.errors.length})`,
              children: (
                <div className="flex flex-col gap-4">
                  {audit.report!.errors.map((error, index) => (
                    <div key={index} className="flex flex-col gap-1 break-all">
                      <Typography.Text strong>{error.repository}</Typography.Text>
                      <Typography.Text type="danger">{error.message}</Typography.Text>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}
      <WorktreeAuditDrawer
        item={selected}
        disabled={locked}
        onClose={() => setSelectedId(undefined)}
        onIgnore={(item) => void audit.ignore(item)}
        onOpen={(item) => void audit.open(item)}
      />
      {audit.removal && (
        <WorktreeRemovalDialog
          key={audit.removal.item.fingerprint}
          plan={audit.removal}
          busy={audit.busy}
          onClose={audit.closeRemoval}
          onConfirm={(path, includeIgnored, force) =>
            void audit.remove(path, includeIgnored, force).then((removed) => {
              if (removed) void message.success(t("audit.removed"));
            })
          }
        />
      )}
    </div>
  );
}
