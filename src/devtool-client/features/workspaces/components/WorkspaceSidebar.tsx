import { DatabaseOutlined, FolderOutlined, PlusOutlined, SearchOutlined } from "@ant-design/icons";
import { Button, Empty, Flex, Input, Layout, Menu, Space, Tooltip, Typography } from "antd";

import { useI18n } from "../../../app/i18n.js";
import type { DevtoolWorkspace } from "../../../../devtool.js";

const { Sider } = Layout;
const { Text, Title } = Typography;

export interface WorkspaceSidebarProps {
  filteredWorkspaces: DevtoolWorkspace[];
  selectedWorkspaceId: string | undefined;
  workspaceQuery: string;
  workspaceRoot: string;
  onOpenCreate: () => void;
  onSelectWorkspace: (id: string) => void;
  onWorkspaceQueryChange: (value: string) => void;
}

export function WorkspaceSidebar({
  filteredWorkspaces,
  selectedWorkspaceId,
  workspaceQuery,
  workspaceRoot,
  onOpenCreate,
  onSelectWorkspace,
  onWorkspaceQueryChange,
}: WorkspaceSidebarProps) {
  const { t } = useI18n();
  return (
    <Sider
      className="relative z-[2] overflow-hidden border-r border-[var(--ant-color-split)] !bg-linear-to-b from-white/70 to-[#f8f9fd]"
      theme="light"
      width={256}
    >
      <Flex className="h-full" vertical>
        <div className="flex min-h-18 items-center gap-3 px-5 pt-3 pb-2">
          <img alt="Compulsive" className="size-10 shrink-0" src="./compulsive-logo.svg" />
          <div>
            <Title className="!m-0" level={4}>
              Compulsive
            </Title>
            <Text type="secondary">{t("brand.subtitle")}</Text>
          </div>
        </div>
        <div className="grid gap-3 px-5 pt-2 pb-3">
          <Button block icon={<PlusOutlined />} size="large" type="primary" onClick={onOpenCreate}>
            {t("sidebar.newRequirement")}
          </Button>
          <Input
            allowClear
            aria-label={t("sidebar.searchRequirement")}
            id="workspace-search"
            name="workspaceSearch"
            placeholder={t("sidebar.searchRequirement")}
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
          <Empty
            className="mt-8"
            description={t("sidebar.noMatches")}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        )}
        <div className="mt-auto border-t border-[var(--ant-color-split)] px-5 pt-3 pb-4">
          <Space
            align="start"
            className="w-full [&>.ant-space-item:last-child]:min-w-0 [&>.ant-space-item:last-child]:flex-1"
          >
            <DatabaseOutlined className="mt-1 shrink-0" />
            <Space className="w-full min-w-0" orientation="vertical" size={0}>
              <Text type="secondary">{t("sidebar.storageRoot")}</Text>
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
