import {
  CheckCircleFilled,
  CloseCircleFilled,
  FolderOpenOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  ToolOutlined,
} from "@ant-design/icons";
import { Alert, Button, Collapse, Flex, Tag, Typography } from "antd";
import { useMemo } from "react";
import type { DoctorCheck } from "../../../types.js";
import { useI18n } from "../../app/i18n.js";
import type { useDoctor } from "./useSettingsState.js";

const { Paragraph, Text, Title } = Typography;
function doctorCategory(check: DoctorCheck): "environment" | "paths" | "requirements" {
  if (check.name === "git" || check.name === "clipboard") return "environment";
  if (check.name === "storage" || check.name === "workspace-root") return "paths";
  return "requirements";
}

interface DoctorPanelProps extends ReturnType<typeof useDoctor> {
  disabled: boolean;
}

export function DoctorPanel({
  doctorChecks,
  doctorRunning,
  doctorCheckedAt,
  runDoctor,
  disabled,
}: DoctorPanelProps) {
  const { formatDateTime, t } = useI18n();
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

  return (
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
              className="size-10 shrink-0 rounded-lg bg-[var(--ant-color-primary-bg)] text-lg text-[var(--ant-color-primary-text)]"
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
}
