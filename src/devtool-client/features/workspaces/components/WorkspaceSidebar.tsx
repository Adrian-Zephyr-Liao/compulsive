import {
  DatabaseOutlined,
  FolderAddOutlined,
  FolderOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Button, Empty, Flex, Form, Input, Layout, Menu, Space, Tooltip, Typography } from "antd";

import type { DevtoolWorkspace } from "../../../../devtool.js";

const { Sider } = Layout;
const { Text, Title } = Typography;

export interface WorkspaceSidebarProps {
  busy: boolean;
  filteredWorkspaces: DevtoolWorkspace[];
  newWorkspaceName: string;
  selectedWorkspaceId: string | undefined;
  showCreate: boolean;
  workspaceQuery: string;
  workspaceRoot: string;
  onCreateWorkspace: () => void;
  onNewWorkspaceNameChange: (value: string) => void;
  onSelectWorkspace: (id: string) => void;
  onToggleCreate: () => void;
  onWorkspaceQueryChange: (value: string) => void;
}

export function WorkspaceSidebar({
  busy,
  filteredWorkspaces,
  newWorkspaceName,
  selectedWorkspaceId,
  showCreate,
  workspaceQuery,
  workspaceRoot,
  onCreateWorkspace,
  onNewWorkspaceNameChange,
  onSelectWorkspace,
  onToggleCreate,
  onWorkspaceQueryChange,
}: WorkspaceSidebarProps) {
  return (
    <Sider
      className="relative z-[2] overflow-hidden border-r border-[var(--ant-color-split)] !bg-linear-to-b from-white/70 to-[#f8f9fd]"
      theme="light"
      width={256}
    >
      <Flex className="h-full" vertical>
        <div className="flex min-h-18 items-center gap-3 px-5 pt-3 pb-2">
          <div
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-lg bg-linear-to-br from-[#6f68f4] to-[#4d47d7] text-xl font-semibold text-white shadow-[0_6px_16px_rgba(91,85,231,0.2)]"
          >
            C
          </div>
          <div>
            <Title className="!m-0" level={4}>
              Compulsive
            </Title>
            <Text type="secondary">Workspace Manager</Text>
          </div>
        </div>
        <div className="grid gap-3 px-5 pt-2 pb-3">
          <Button
            block
            icon={<PlusOutlined />}
            size="large"
            type="primary"
            onClick={onToggleCreate}
          >
            新建工作区
          </Button>
          {showCreate && (
            <Form
              className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-4"
              layout="vertical"
              onFinish={onCreateWorkspace}
            >
              <Form.Item className="!mb-2" label="工作区名称" required>
                <Input
                  autoFocus
                  id="new-workspace-name"
                  name="workspaceName"
                  placeholder="例如 feature-report"
                  prefix={<FolderAddOutlined />}
                  value={newWorkspaceName}
                  onChange={(event) => onNewWorkspaceNameChange(event.target.value)}
                />
              </Form.Item>
              <Button
                block
                disabled={!newWorkspaceName.trim() || busy}
                htmlType="submit"
                type="primary"
              >
                创建
              </Button>
            </Form>
          )}
          <Input
            allowClear
            aria-label="搜索工作区"
            id="workspace-search"
            name="workspaceSearch"
            placeholder="搜索工作区"
            prefix={<SearchOutlined />}
            size="large"
            value={workspaceQuery}
            onChange={(event) => onWorkspaceQueryChange(event.target.value)}
          />
        </div>
        {filteredWorkspaces.length ? (
          <Menu
            className="min-h-0 flex-1 overflow-y-auto !border-r-0 !bg-transparent px-2"
            classNames={{
              item: "!my-1 !h-11 !px-4 !leading-normal after:!right-auto after:!left-0 after:!rounded-sm after:!border-r-[3px]",
              itemIcon: "!mt-0.5 !text-lg",
            }}
            items={filteredWorkspaces.map((workspace) => ({
              key: workspace.id,
              icon: <FolderOutlined />,
              label: (
                <div className="block w-full min-w-0">
                  <Flex gap={8} justify="space-between">
                    <Text className="!max-w-[152px] !text-sm" ellipsis strong>
                      {workspace.name}
                    </Text>
                    <Text className="!text-xs" type="secondary">
                      {workspace.members.length}
                    </Text>
                  </Flex>
                </div>
              ),
            }))}
            mode="inline"
            selectedKeys={selectedWorkspaceId ? [selectedWorkspaceId] : []}
            onClick={({ key }) => onSelectWorkspace(key)}
          />
        ) : (
          <Empty className="mt-8" description="没有匹配项" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
        <div className="mt-auto border-t border-[var(--ant-color-split)] px-5 pt-3 pb-4">
          <Space
            align="start"
            className="w-full [&>.ant-space-item:last-child]:min-w-0 [&>.ant-space-item:last-child]:flex-1"
          >
            <DatabaseOutlined className="mt-1 shrink-0" />
            <Space className="w-full min-w-0" orientation="vertical" size={0}>
              <Text type="secondary">存储根目录</Text>
              <Tooltip title={workspaceRoot}>
                <Text className="block w-full !text-xs" ellipsis>
                  {workspaceRoot || "—"}
                </Text>
              </Tooltip>
            </Space>
          </Space>
        </div>
      </Flex>
    </Sider>
  );
}
