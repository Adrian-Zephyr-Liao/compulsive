import {
  BranchesOutlined,
  CheckCircleFilled,
  CodeOutlined,
  LinkOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Flex,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { TableProps } from "antd";

import { useI18n } from "../../../app/i18n.js";
import type { WorkspaceMember, WorkspaceStatusResult } from "../../../../types.js";

const { Text, Title } = Typography;

export interface RepositoryStatusCounts {
  all: number;
  attention: number;
  conflicts: number;
  unpushed: number;
}

export interface WorkspaceFeedback {
  error: boolean;
  message: string;
  title: string;
}

export interface RepositoryPanelProps {
  busy: boolean;
  branchSyncing: boolean;
  columns: NonNullable<TableProps<WorkspaceMember>["columns"]>;
  feedback: WorkspaceFeedback | undefined;
  filteredMembers: WorkspaceMember[];
  members: WorkspaceMember[];
  mode: string;
  query: string;
  state: string;
  status: WorkspaceStatusResult | undefined;
  statusCounts: RepositoryStatusCounts;
  statusLoading: boolean;
  onAddRepository: () => void;
  onBatchSync: () => void;
  onCheckStatus: () => void;
  onCloseFeedback: () => void;
  onCopyCommand: () => void;
  onModeChange: (value: string) => void;
  onOpenChatgpt: () => void;
  onQueryChange: (value: string) => void;
  onStateChange: (value: string) => void;
  onSyncWorkspace: () => void;
}

export function RepositoryPanel({
  busy,
  branchSyncing,
  columns,
  feedback,
  filteredMembers,
  members,
  mode,
  query,
  state,
  status,
  statusCounts,
  statusLoading,
  onAddRepository,
  onBatchSync,
  onCheckStatus,
  onCloseFeedback,
  onCopyCommand,
  onModeChange,
  onOpenChatgpt,
  onQueryChange,
  onStateChange,
  onSyncWorkspace,
}: RepositoryPanelProps) {
  const { formatDateTime, t } = useI18n();
  const mergedCount = status?.members.filter((item) => item.mergedIntoDefault).length ?? 0;

  return (
    <section className="box-border min-w-0 bg-transparent">
      <div className="mb-2 flex min-h-12 items-center justify-between gap-5 pr-2 pl-1">
        <Title className="!m-0" level={3}>
          {t("repository.title")}
        </Title>
        <Space className="justify-end" size={8} wrap>
          <Button icon={<MessageOutlined />} size="large" onClick={onOpenChatgpt}>
            {t("repository.openChatgpt")}
          </Button>
          <Button icon={<CodeOutlined />} size="large" onClick={onCopyCommand}>
            {t("repository.copyCommand")}
          </Button>
          <Tooltip title={t("repository.batchSyncTip")}>
            <Button
              disabled={busy || !members.some((member) => member.mode === "worktree")}
              icon={<BranchesOutlined />}
              loading={branchSyncing}
              size="large"
              onClick={onBatchSync}
            >
              {t("repository.batchSync")}
            </Button>
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: "sync",
                  icon: <LinkOutlined />,
                  label: t("repository.repairLinks"),
                  disabled: busy,
                },
              ],
              onClick: ({ key }) => {
                if (key === "sync") onSyncWorkspace();
              },
            }}
            trigger={["click"]}
          >
            <Button icon={<MoreOutlined />} size="large">
              {t("common.more")}
            </Button>
          </Dropdown>
          <Button icon={<PlusOutlined />} size="large" type="primary" onClick={onAddRepository}>
            {t("repository.add")}
          </Button>
        </Space>
      </div>
      <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-3">
        <div className="mb-3 flex min-h-10 items-center justify-between gap-4">
          <Space size={8} wrap>
            <Segmented<string>
              aria-label={t("repository.statusFilter")}
              options={[
                { value: "all", label: t("repository.filterAll", { count: statusCounts.all }) },
                {
                  value: "attention",
                  label: t("repository.filterAttention", { count: statusCounts.attention }),
                },
                {
                  value: "unpushed",
                  label: t("repository.filterUnpushed", { count: statusCounts.unpushed }),
                },
                {
                  value: "conflicts",
                  label: t("repository.filterConflicts", { count: statusCounts.conflicts }),
                },
              ]}
              value={state}
              onChange={onStateChange}
            />
            {Boolean(mergedCount) && (
              <Tooltip title={t("repository.mergedTip")}>
                <Tag className="!m-0 !px-2 !py-1" color="success" icon={<CheckCircleFilled />}>
                  {t("repository.mergedCount", { count: mergedCount })}
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Text className="shrink-0" type="secondary">
            {t("repository.lastChecked", {
              time: status ? formatDateTime(status.checkedAt) : t("repository.notChecked"),
            })}
          </Text>
        </div>
        <div className="mb-3 flex w-full">
          <Space
            className="!grid w-full grid-cols-[176px_minmax(240px,1fr)_auto] [&>.ant-space-item]:min-w-0 [&_.ant-input-affix-wrapper]:w-full [&_.ant-select]:w-full"
            size={8}
            wrap
          >
            <Select
              aria-label={t("repository.typeFilter")}
              size="large"
              options={[
                { value: "all", label: t("repository.allTypes") },
                { value: "worktree", label: t("repository.developmentRepositories") },
                { value: "reference", label: t("repository.referenceRepositories") },
                { value: "link", label: t("repository.directoryLinks") },
              ]}
              value={mode}
              onChange={onModeChange}
            />
            <Input
              allowClear
              aria-label={t("repository.search")}
              placeholder={t("repository.search")}
              prefix={<SearchOutlined />}
              size="large"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
            <Button
              disabled={statusLoading || busy}
              icon={<SyncOutlined />}
              loading={statusLoading}
              size="large"
              onClick={onCheckStatus}
            >
              {t("repository.checkStatus")}
            </Button>
          </Space>
        </div>
        {feedback && (
          <Alert
            closable={{ onClose: onCloseFeedback }}
            className="mb-3"
            description={feedback.message}
            title={feedback.title}
            showIcon
            type={feedback.error ? "error" : "success"}
          />
        )}
        {members.length ? (
          <Table<WorkspaceMember>
            className="overflow-hidden rounded-md border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] [&_.ant-table]:rounded-lg [&_.ant-table-tbody>tr>td]:overflow-hidden [&_.ant-table-thead>tr>th]:text-sm [&_.ant-table-thead>tr>th]:font-semibold [&_.ant-table-thead>tr>th]:leading-8"
            columns={columns}
            dataSource={filteredMembers}
            locale={{
              emptyText: (
                <Empty
                  description={t("repository.noMatches")}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ),
            }}
            pagination={false}
            rowKey="repositoryId"
            scroll={{ x: 940 }}
            size="middle"
            tableLayout="fixed"
          />
        ) : (
          <Flex align="center" className="min-h-[300px]" gap={12} justify="center" vertical>
            <Empty description={t("repository.empty")} image={Empty.PRESENTED_IMAGE_SIMPLE} />
            <Button icon={<PlusOutlined />} onClick={onAddRepository}>
              {t("repository.add")}
            </Button>
          </Flex>
        )}
      </div>
    </section>
  );
}
