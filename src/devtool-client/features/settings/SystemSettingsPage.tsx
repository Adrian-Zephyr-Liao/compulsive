import {
  CheckCircleFilled,
  CloseCircleFilled,
  DatabaseOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SettingOutlined,
  ToolOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Alert, Button, Collapse, Flex, Form, Input, Select, Tag, Typography } from "antd";
import type { FormRule } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, Route, Routes, useMatch, useNavigate } from "react-router";

import type { DoctorCheck, ManagerConfig } from "../../../types.js";
import { useI18n } from "../../app/i18n.js";
import { routePaths } from "../../app/routes.js";

const { Paragraph, Text, Title } = Typography;

interface ConfigFormValues {
  rootDir: string;
  workspaceRoot: string;
  scanRoots: string[];
}

type SettingsSection = "configuration" | "doctor";

export interface SystemSettingsPageProps {
  config: ManagerConfig;
  disabled: boolean;
  saving: boolean;
  onRunDoctor: () => Promise<DoctorCheck[]>;
  onSave: (config: ConfigFormValues) => Promise<void>;
}

function doctorCategory(check: DoctorCheck): "environment" | "paths" | "requirements" {
  if (check.name === "git" || check.name === "clipboard") return "environment";
  if (check.name === "storage" || check.name === "workspace-root") return "paths";
  return "requirements";
}

export function SystemSettingsPage({
  config,
  disabled,
  saving,
  onRunDoctor,
  onSave,
}: SystemSettingsPageProps) {
  const { formatDateTime, t } = useI18n();
  const navigate = useNavigate();
  const [form] = Form.useForm<ConfigFormValues>();
  const activeSection: SettingsSection = useMatch(routePaths.doctor) ? "doctor" : "configuration";
  const [dirty, setDirty] = useState(false);
  const [doctorRunning, setDoctorRunning] = useState(false);
  const [doctorChecks, setDoctorChecks] = useState<DoctorCheck[]>();
  const [doctorCheckedAt, setDoctorCheckedAt] = useState<Date>();

  useEffect(() => {
    form.setFieldsValue(config);
    setDirty(false);
  }, [config, form]);

  const baseChecks = useMemo(
    () => doctorChecks?.filter((check) => doctorCategory(check) !== "requirements") ?? [],
    [doctorChecks],
  );
  const requirementChecks = useMemo(
    () => doctorChecks?.filter((check) => doctorCategory(check) === "requirements") ?? [],
    [doctorChecks],
  );
  const failedRequirementChecks = requirementChecks.filter((check) => !check.ok);
  const healthyRequirementChecks = requirementChecks.filter((check) => check.ok);
  const passed = doctorChecks?.filter((check) => check.ok).length ?? 0;
  const failed = (doctorChecks?.length ?? 0) - passed;

  const pathRules = [
    { required: true, message: t("settings.pathRequired") },
    {
      validator: (_: unknown, value: string | undefined) =>
        !value || value.startsWith("/")
          ? Promise.resolve()
          : Promise.reject(new Error(t("settings.absolutePath"))),
    },
  ];

  function doctorLabel(check: DoctorCheck): string {
    const labels: Record<string, string> = {
      git: t("doctor.check.git"),
      storage: t("doctor.check.storage"),
      "workspace-root": t("doctor.check.workspaceRoot"),
      workspaces: t("doctor.check.workspaces"),
      clipboard: t("doctor.check.clipboard"),
    };
    return labels[check.name] ?? check.name.replace(/^workspace:/, "");
  }

  async function runDoctor(): Promise<void> {
    setDoctorRunning(true);
    try {
      setDoctorChecks(await onRunDoctor());
      setDoctorCheckedAt(new Date());
    } catch {
      // The app-level notification reports the transport or doctor failure.
    } finally {
      setDoctorRunning(false);
    }
  }

  function renderDoctorRows(checks: DoctorCheck[]) {
    return checks.map((check) => (
      <div
        className="flex items-start gap-4 border-b border-[var(--ant-color-split)] p-4 last:border-b-0"
        key={check.name}
      >
        {check.ok ? (
          <CheckCircleFilled className="mt-1 text-[var(--ant-color-success)]" />
        ) : (
          <CloseCircleFilled className="mt-1 text-[var(--ant-color-error)]" />
        )}
        <div className="min-w-0 flex-1">
          <Text strong>{doctorLabel(check)}</Text>
          <Paragraph className="!mb-0 !mt-1 break-all !text-xs" type="secondary">
            {check.detail}
          </Paragraph>
        </div>
        <Tag color={check.ok ? "success" : "error"} variant="filled">
          {check.ok ? t("doctor.statusPassed") : t("doctor.statusFailed")}
        </Tag>
      </div>
    ));
  }

  const settingRows: Array<{
    control: ReactNode;
    description: string;
    icon: ReactNode;
    label: string;
    name: keyof ConfigFormValues;
    rules: FormRule[];
  }> = [
    {
      description: t("settings.repositoryRootExtra"),
      icon: <DatabaseOutlined />,
      label: t("settings.repositoryRoot"),
      name: "rootDir",
      control: <Input id="rootDir" prefix={<DatabaseOutlined />} size="large" />,
      rules: pathRules,
    },
    {
      description: t("settings.requirementRootExtra"),
      icon: <FolderOpenOutlined />,
      label: t("settings.requirementRoot"),
      name: "workspaceRoot",
      control: <Input id="workspaceRoot" prefix={<FolderOpenOutlined />} size="large" />,
      rules: pathRules,
    },
    {
      description: t("settings.scanRootsExtra"),
      icon: <SafetyCertificateOutlined />,
      label: t("settings.scanRoots"),
      name: "scanRoots",
      control: (
        <Select
          aria-label={t("settings.scanRoots")}
          mode="tags"
          open={false}
          placeholder={t("settings.scanRootsPlaceholder")}
          size="large"
          tokenSeparators={[","]}
        />
      ),
      rules: [
        {
          validator: (_: unknown, values: string[] | undefined) =>
            (values ?? []).every((value) => value.startsWith("/"))
              ? Promise.resolve()
              : Promise.reject(new Error(t("settings.absolutePath"))),
        },
      ],
    },
  ];

  const configuration = (
    <section aria-labelledby="settings-configuration-title">
      <div className="mb-6">
        <Title className="!mb-1" id="settings-configuration-title" level={3}>
          {t("settings.configTitle")}
        </Title>
        <Text type="secondary">{t("settings.configDescription")}</Text>
      </div>

      <Form<ConfigFormValues>
        form={form}
        requiredMark={false}
        onFinish={(values) => void onSave(values).catch(() => undefined)}
        onValuesChange={() => setDirty(true)}
      >
        <div className="divide-y divide-[var(--ant-color-split)] border-y border-[var(--ant-color-split)]">
          {settingRows.map((row) => (
            <div
              className="grid gap-4 py-4 xl:grid-cols-[minmax(192px,0.8fr)_minmax(288px,1.4fr)] xl:gap-8"
              key={row.name}
            >
              <Flex align="flex-start" gap={8}>
                <span className="mt-1 text-[var(--ant-color-text-tertiary)]">{row.icon}</span>
                <div>
                  <label
                    className="block font-medium text-[var(--ant-color-text)]"
                    htmlFor={row.name}
                  >
                    {row.label}
                  </label>
                  <Paragraph className="!mb-0 !mt-1 !text-xs !leading-5" type="secondary">
                    {row.description}
                  </Paragraph>
                </div>
              </Flex>
              <Form.Item className="!mb-0" name={row.name} rules={row.rules}>
                {row.control}
              </Form.Item>
            </div>
          ))}
        </div>

        <div className="grid gap-4 pt-4 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <Flex align="flex-start" className="min-w-0 max-w-[560px]" gap={8}>
            <WarningOutlined className="mt-1 text-[var(--ant-color-warning)]" />
            <div>
              <Text className="text-sm" strong>
                {t("settings.changeWarning")}
              </Text>
              <Paragraph className="!mb-0 !text-xs !leading-5" type="secondary">
                {t("settings.changeWarningDescription")}
              </Paragraph>
            </div>
          </Flex>
          <Flex align="center" gap={8} justify="flex-end">
            <Text className="mr-1 !text-xs" type={dirty ? "warning" : "secondary"}>
              {dirty ? t("settings.unsavedState") : t("settings.savedState")}
            </Text>
            <Button
              disabled={!dirty || saving}
              onClick={() => {
                form.setFieldsValue(config);
                setDirty(false);
              }}
            >
              {t("settings.reset")}
            </Button>
            <Button
              disabled={disabled || !dirty}
              htmlType="submit"
              icon={<SaveOutlined />}
              loading={saving}
              type="primary"
            >
              {t("settings.save")}
            </Button>
          </Flex>
        </div>
      </Form>
    </section>
  );

  const diagnostics = (
    <section aria-labelledby="settings-doctor-title">
      <div className="mb-6">
        <Flex align="flex-start" gap={16} justify="space-between">
          <div>
            <Title className="!mb-1" id="settings-doctor-title" level={3}>
              {t("doctor.title")}
            </Title>
            <Text type="secondary">{t("doctor.description")}</Text>
          </div>
          {doctorChecks && (
            <Button
              disabled={disabled}
              icon={<ReloadOutlined />}
              loading={doctorRunning}
              onClick={() => void runDoctor()}
            >
              {t("doctor.runAgain")}
            </Button>
          )}
        </Flex>
        <div className="mt-2 flex items-center gap-2">
          <InfoCircleOutlined className="text-[var(--ant-color-text-tertiary)]" />
          <Text className="!text-xs" type="secondary">
            {t("doctor.readOnly")}
          </Text>
        </div>
      </div>

      {!doctorChecks ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[var(--ant-color-fill-quaternary)] p-6">
          <Flex align="flex-start" gap={16}>
            <Flex
              align="center"
              className="size-10 shrink-0 rounded-lg bg-[var(--ant-color-primary-bg)] text-lg text-[var(--ant-color-primary)]"
              justify="center"
            >
              <ToolOutlined />
            </Flex>
            <div>
              <Title className="!mb-1" level={5}>
                {t("doctor.notRunTitle")}
              </Title>
              <Text type="secondary">{t("doctor.notRunDescription")}</Text>
            </div>
          </Flex>
          <Button
            disabled={disabled}
            icon={<ToolOutlined />}
            loading={doctorRunning}
            type="primary"
            onClick={() => void runDoctor()}
          >
            {t("doctor.run")}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <Alert
            description={
              <Flex gap={16} wrap>
                <Text className="!text-xs" type="secondary">
                  {t("doctor.passedSummary", { count: passed })}
                </Text>
                <Text className="!text-xs" type={failed ? "danger" : "secondary"}>
                  {t("doctor.failedSummary", { count: failed })}
                </Text>
                {doctorCheckedAt && (
                  <Text className="!text-xs" type="secondary">
                    {t("doctor.lastRun", { time: formatDateTime(doctorCheckedAt) })}
                  </Text>
                )}
              </Flex>
            }
            showIcon
            title={failed ? t("doctor.needsAttention") : t("doctor.allHealthy")}
            type={failed ? "error" : "success"}
          />

          <div className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
            <div className="flex items-center gap-2 border-b border-[var(--ant-color-split)] px-4 py-2">
              <SafetyCertificateOutlined />
              <Text strong>{t("doctor.foundation")}</Text>
              <Tag variant="filled">{baseChecks.length}</Tag>
            </div>
            <div className="grid md:grid-cols-2 md:[&>*:nth-child(odd)]:border-r md:[&>*:nth-last-child(-n+2)]:border-b-0">
              {renderDoctorRows(baseChecks)}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)]">
            <div className="flex items-center gap-2 border-b border-[var(--ant-color-split)] px-4 py-2">
              <FolderOpenOutlined />
              <Text strong>{t("doctor.requirements")}</Text>
              {failedRequirementChecks.length ? (
                <Tag color="error" variant="filled">
                  {t("doctor.issueMembers", { count: failedRequirementChecks.length })}
                </Tag>
              ) : (
                <Tag color="success" variant="filled">
                  {t("doctor.requirementsHealthy")}
                </Tag>
              )}
            </div>
            {failedRequirementChecks.length > 0 && (
              <div className="bg-[var(--ant-color-error-bg)]">
                {renderDoctorRows(failedRequirementChecks)}
              </div>
            )}
            {healthyRequirementChecks.length > 0 && (
              <Collapse
                bordered={false}
                className="bg-[var(--ant-color-bg-container)]"
                items={[
                  {
                    key: "healthy-members",
                    label: t("doctor.healthyMembers", { count: healthyRequirementChecks.length }),
                    styles: { body: { padding: 0 }, header: { padding: "8px 16px" } },
                    children: (
                      <div className="border-t border-[var(--ant-color-split)]">
                        {renderDoctorRows(healthyRequirementChecks)}
                      </div>
                    ),
                  },
                ]}
                size="small"
              />
            )}
          </div>
        </div>
      )}
    </section>
  );

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
    <div className="mx-auto w-full max-w-[1180px] px-6 py-6">
      <div className="mb-6 flex items-start gap-4">
        <Flex
          align="center"
          className="size-10 shrink-0 rounded-lg bg-[var(--ant-color-primary-bg)] text-lg text-[var(--ant-color-primary)]"
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
                    ? "border-[var(--ant-color-primary-border)] bg-[var(--ant-color-bg-container)] text-[var(--ant-color-primary)]"
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
                  {item.key === "doctor" && doctorChecks && failed > 0 && (
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
            <Route path="storage" element={configuration} />
            <Route path="doctor" element={diagnostics} />
            <Route path="*" element={<Navigate replace to={routePaths.settings} />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
