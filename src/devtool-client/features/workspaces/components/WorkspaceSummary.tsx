import {
  BranchesOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  MoreOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Space, Tooltip, Typography } from "antd";

const { Text, Title } = Typography;

export interface WorkspaceSummaryProps {
  absolutePath: string;
  busy: boolean;
  developmentCount: number;
  memberCount: number;
  name: string;
  statusLabel: string;
  onClone: () => void;
  onDelete: () => void;
}

export function WorkspaceSummary({
  absolutePath,
  busy,
  developmentCount,
  memberCount,
  name,
  statusLabel,
  onClone,
  onDelete,
}: WorkspaceSummaryProps) {
  return (
    <section className="box-border grid min-h-[152px] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-4 rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] px-5 py-4">
      <div className="grid size-12 place-items-center rounded-lg bg-[var(--ant-color-primary-bg)] text-2xl text-[var(--ant-color-primary)]">
        <FolderOpenOutlined />
      </div>
      <div className="grid min-w-0 gap-0">
        <Title className="!m-0 !text-2xl !leading-8" level={2}>
          {name}
        </Title>
        <Tooltip title={absolutePath}>
          <Text className="!max-w-[760px]" ellipsis type="secondary">
            {absolutePath}
          </Text>
        </Tooltip>
        <Text className="mt-2" type="secondary">
          隔离管理开发仓库与参考代码，保持每个任务的分支上下文独立。
        </Text>
        <Space
          className="mt-3 [&_.anticon]:mr-2 [&_.anticon]:!text-[var(--ant-color-text-secondary)]"
          size={24}
          wrap
        >
          <Text>
            <DatabaseOutlined /> {memberCount} 个仓库
          </Text>
          <Text>
            <BranchesOutlined /> {developmentCount} 开发分支
          </Text>
          <Text>
            <ClockCircleOutlined /> {statusLabel}
          </Text>
        </Space>
      </div>
      <Space className="pt-2" size={12} wrap>
        <Button
          disabled={!memberCount || busy}
          icon={<BranchesOutlined />}
          size="large"
          onClick={onClone}
        >
          克隆工作区
        </Button>
        <Dropdown
          menu={{
            items: [
              {
                key: "delete",
                danger: true,
                icon: <DeleteOutlined />,
                label: "删除工作区",
              },
            ],
            onClick: ({ key }) => {
              if (key === "delete") onDelete();
            },
          }}
          trigger={["click"]}
        >
          <Button icon={<MoreOutlined />} size="large">
            更多
          </Button>
        </Dropdown>
      </Space>
    </section>
  );
}
