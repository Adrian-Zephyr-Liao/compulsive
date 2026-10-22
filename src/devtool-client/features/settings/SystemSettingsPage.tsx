import { DatabaseOutlined, SettingOutlined, ToolOutlined } from "@ant-design/icons";
import { Flex, Tabs, Tag, Typography } from "antd";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useMatch, useNavigate } from "react-router";
import type { DoctorCheck, ManagerConfig } from "../../../types.js";
import { useI18n } from "../../app/i18n.js";
import { routePaths } from "../../app/routes.js";
import type { WorkspaceRpc } from "../workspaces/types.js";
import { WorktreeAuditPanel } from "./WorktreeAuditPanel.js";
import { DoctorPanel } from "./DoctorPanel.js";
import { StorageSettingsPanel } from "./StorageSettingsPanel.js";
import { useDoctor, useStorageSettings, type ConfigFormValues } from "./useSettingsState.js";

const { Text, Title } = Typography;
type SettingsSection = "configuration" | "doctor";

export interface SystemSettingsPageProps {
  getRpc: () => Promise<WorkspaceRpc>;
  config: ManagerConfig;
  disabled: boolean;
  saving: boolean;
  onRunDoctor: () => Promise<DoctorCheck[]>;
  onWorktreeRemoved: () => Promise<void>;
  onSave: (config: ConfigFormValues) => Promise<void>;
}

export function SystemSettingsPage({
  getRpc,
  config,
  disabled,
  saving,
  onRunDoctor,
  onWorktreeRemoved,
  onSave,
}: SystemSettingsPageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const activeSection: SettingsSection = useMatch(`${routePaths.doctor}/*`)
    ? "doctor"
    : "configuration";
  const worktreeAuditActive = Boolean(useMatch(routePaths.worktreeAudit));
  const storage = useStorageSettings(config);
  const doctor = useDoctor(onRunDoctor);
  const failed = doctor.doctorChecks?.filter((check) => !check.ok).length ?? 0;
  const navigationItems: Array<{
    description: string;
    icon: ReactNode;
    key: SettingsSection;
    label: string;
  }> = [
    {
      description: t("settings.configurationNavDescription"),
      icon: <DatabaseOutlined />,
      key: "configuration",
      label: t("settings.configurationTab"),
    },
    {
      description: t("settings.doctorNavDescription"),
      icon: <ToolOutlined />,
      key: "doctor",
      label: t("settings.doctorTab"),
    },
  ];

  return (
    <div
      className={`mx-auto w-full px-6 py-6 ${worktreeAuditActive ? "max-w-[1600px]" : "max-w-[1180px]"}`}
    >
      <div className="mb-6 flex items-start gap-4">
        <Flex
          align="center"
          className="size-10 shrink-0 rounded-lg bg-[var(--ant-color-primary-bg)] text-lg text-[var(--ant-color-primary-text)]"
          justify="center"
        >
          <SettingOutlined />
        </Flex>
        <div>
          <Title className="!mb-1" level={2}>
            {t("settings.title")}
          </Title>
          <Text type="secondary">{t("settings.description")}</Text>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] lg:grid lg:grid-cols-[224px_minmax(0,1fr)]">
        <nav
          aria-label={t("settings.title")}
          className="grid grid-cols-2 gap-2 border-b border-[var(--ant-color-split)] bg-[var(--ant-color-fill-quaternary)] p-4 lg:block lg:border-b-0 lg:border-r"
        >
          {navigationItems.map((item) => {
            const active = activeSection === item.key;
            return (
              <button
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-start gap-2 rounded-lg border p-4 text-left transition-colors lg:mb-2 ${
                  active
                    ? "border-[var(--ant-color-primary-border)] bg-[var(--ant-color-bg-container)] text-[var(--ant-color-primary-text)]"
                    : "border-transparent text-[var(--ant-color-text)] hover:bg-[var(--ant-color-fill-tertiary)]"
                }`}
                key={item.key}
                type="button"
                onClick={() =>
                  void navigate(item.key === "doctor" ? routePaths.doctor : routePaths.settings)
                }
              >
                <span className="mt-1 text-base">{item.icon}</span>
                <span className="min-w-0">
                  <span className="block font-medium">{item.label}</span>
                  <span
                    className={`mt-1 block text-xs leading-5 ${
                      active
                        ? "text-[var(--ant-color-primary-text)]"
                        : "text-[var(--ant-color-text-tertiary)]"
                    }`}
                  >
                    {item.description}
                  </span>
                  {item.key === "doctor" && doctor.doctorChecks && failed > 0 && (
                    <Tag className="!mt-2" color="error" variant="filled">
                      {t("doctor.failedSummary", { count: failed })}
                    </Tag>
                  )}
                </span>
              </button>
            );
          })}
        </nav>
        <div className="min-w-0 p-6">
          <Routes>
            <Route index element={<Navigate replace to={routePaths.settings} />} />
            <Route
              path="storage"
              element={
                <StorageSettingsPanel
                  {...storage}
                  disabled={disabled}
                  saving={saving}
                  onSave={onSave}
                />
              }
            />
            <Route
              path="doctor/*"
              element={
                <Tabs
                  activeKey={worktreeAuditActive ? "worktrees" : "base"}
                  onChange={(key) =>
                    navigate(key === "worktrees" ? routePaths.worktreeAudit : routePaths.doctor)
                  }
                  items={[
                    {
                      key: "base",
                      label: t("audit.tabBase"),
                      children: <DoctorPanel {...doctor} disabled={disabled} />,
                    },
                    {
                      key: "worktrees",
                      label: t("audit.title"),
                      children: (
                        <WorktreeAuditPanel
                          disabled={disabled}
                          getRpc={getRpc}
                          onRemoved={onWorktreeRemoved}
                        />
                      ),
                    },
                  ]}
                />
              }
            />
            <Route path="*" element={<Navigate replace to={routePaths.settings} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
