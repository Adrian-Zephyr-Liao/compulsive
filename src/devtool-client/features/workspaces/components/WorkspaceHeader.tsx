import { GlobalOutlined } from "@ant-design/icons";
import { Badge, Breadcrumb, Flex, Layout, Select } from "antd";

import { useI18n } from "../../../app/i18n.js";

const { Header } = Layout;

export interface WorkspaceHeaderProps {
  connectionLabel: string;
  connectionStatus: "error" | "processing" | "success";
  workspaceName: string | undefined;
}

export function WorkspaceHeader({
  connectionLabel,
  connectionStatus,
  workspaceName,
}: WorkspaceHeaderProps) {
  const { locale, setLocale, t } = useI18n();
  return (
    <Header className="flex !h-11 items-center justify-between border-b border-[var(--ant-color-split)] !bg-white/90 !px-5 !py-0 !leading-normal text-[var(--ant-color-text)] backdrop-blur-sm">
      <Breadcrumb items={[{ title: t("header.requirement") }, { title: workspaceName ?? "" }]} />
      <Flex align="center" gap={16}>
        <Select
          aria-label={t("language.label")}
          className="w-28"
          options={[
            { label: t("language.zh"), value: "zh-CN" },
            { label: t("language.en"), value: "en-US" },
          ]}
          prefix={<GlobalOutlined />}
          size="small"
          value={locale}
          variant="borderless"
          onChange={setLocale}
        />
        <Badge status={connectionStatus} text={connectionLabel} />
      </Flex>
    </Header>
  );
}
