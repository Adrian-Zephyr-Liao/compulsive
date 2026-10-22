import { GlobalOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Badge, Breadcrumb, Button, Flex, Layout, Select, Tooltip } from "antd";

import { useI18n } from "../../../app/i18n.js";

const { Header } = Layout;

export interface WorkspaceHeaderProps {
  dark: boolean;
  themeBusy: boolean;
  onThemeChange: (dark: boolean) => void;
  connectionLabel: string;
  connectionStatus: "error" | "processing" | "success";
  contextLabel: string | undefined;
  sectionLabel: string;
}

export function WorkspaceHeader({
  dark,
  themeBusy,
  onThemeChange,
  connectionLabel,
  connectionStatus,
  contextLabel,
  sectionLabel,
}: WorkspaceHeaderProps) {
  const { locale, setLocale, t } = useI18n();
  return (
    <Header className="flex !h-11 items-center justify-between border-b border-[var(--ant-color-split)] !bg-[var(--ant-color-bg-container)] !px-5 !py-0 !leading-normal text-[var(--ant-color-text)]">
      <Breadcrumb items={[{ title: sectionLabel }, { title: contextLabel ?? "" }]} />
      <Flex align="center" gap={16}>
        <Tooltip title={t(dark ? "appearance.light" : "appearance.dark")}>
          <Button
            type="text"
            size="small"
            disabled={themeBusy}
            aria-label={t(dark ? "appearance.light" : "appearance.dark")}
            icon={dark ? <SunOutlined /> : <MoonOutlined />}
            onClick={() => onThemeChange(!dark)}
          />
        </Tooltip>
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
