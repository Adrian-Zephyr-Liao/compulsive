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
  const mergedCount = status?.members.filter((item) => item.mergedIntoDefault).length ?? 0;

  return (
    <section className="box-border min-w-0 bg-transparent">
      <div className="mb-2 flex min-h-12 items-center justify-between gap-5 pr-2 pl-1">
        <Title className="!m-0" level={3}>
          仓库
        </Title>
        <Space className="justify-end" size={8} wrap>
          <Button icon={<MessageOutlined />} size="large" onClick={onOpenChatgpt}>
            在 ChatGPT 中打开
          </Button>
          <Button icon={<CodeOutlined />} size="large" onClick={onCopyCommand}>
            复制 cd 命令
          </Button>
          <Tooltip title="逐个同步干净的开发分支与参考仓库，冲突会保留在对应仓库中">
            <Button
              disabled={busy || !members.some((member) => member.mode === "worktree")}
              icon={<BranchesOutlined />}
              loading={branchSyncing}
              size="large"
              onClick={onBatchSync}
            >
              批量同步
            </Button>
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: "sync",
                  icon: <LinkOutlined />,
                  label: "修复工作区链接",
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
              更多
            </Button>
          </Dropdown>
          <Button icon={<PlusOutlined />} size="large" type="primary" onClick={onAddRepository}>
            添加仓库
          </Button>
        </Space>
      </div>
      <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-3">
        <div className="mb-3 flex min-h-10 items-center justify-between gap-4">
          <Space size={8} wrap>
            <Segmented<string>
              aria-label="仓库状态筛选"
              options={[
                { value: "all", label: `全部 ${statusCounts.all}` },
                { value: "attention", label: `需处理 ${statusCounts.attention}` },
                { value: "unpushed", label: `待推送 ${statusCounts.unpushed}` },
                { value: "conflicts", label: `冲突 ${statusCounts.conflicts}` },
              ]}
              value={state}
              onChange={onStateChange}
            />
            {Boolean(mergedCount) && (
              <Tooltip title="远端开发分支的最新提交已包含在对应主分支中">
                <Tag className="!m-0 !px-2 !py-1" color="success" icon={<CheckCircleFilled />}>
                  {mergedCount} 个分支已合入
                </Tag>
              </Tooltip>
            )}
          </Space>
          <Text className="shrink-0" type="secondary">
            最后检查：{status ? new Date(status.checkedAt).toLocaleString() : "尚未检查"}
          </Text>
        </div>
        <div className="mb-3 flex w-full">
          <Space
            className="!grid w-full grid-cols-[176px_minmax(240px,1fr)_auto] [&>.ant-space-item]:min-w-0 [&_.ant-input-affix-wrapper]:w-full [&_.ant-select]:w-full"
            size={8}
            wrap
          >
            <Select
              aria-label="仓库类型"
              size="large"
              options={[
                { value: "all", label: "全部类型" },
                { value: "worktree", label: "开发仓库" },
                { value: "reference", label: "参考仓库" },
                { value: "link", label: "目录链接" },
              ]}
              value={mode}
              onChange={onModeChange}
            />
            <Input
              allowClear
              aria-label="搜索仓库"
              placeholder="搜索仓库名称或路径"
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
              检查状态
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
                <Empty description="没有匹配的仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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
            <Empty description="还没有仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            <Button icon={<PlusOutlined />} onClick={onAddRepository}>
              添加仓库
            </Button>
          </Flex>
        )}
      </div>
    </section>
  );
}
