import {
  DatabaseOutlined,
  FolderOpenOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Button, Flex, Form, Input, Select, Typography } from "antd";
import type { FormRule } from "antd";
import type { ReactNode } from "react";
import { useI18n } from "../../app/i18n.js";
import type { ConfigFormValues, useStorageSettings } from "./useSettingsState.js";

const { Paragraph, Text, Title } = Typography;

interface StorageSettingsPanelProps extends ReturnType<typeof useStorageSettings> {
  disabled: boolean;
  saving: boolean;
  onSave: (config: ConfigFormValues) => Promise<void>;
}

export function StorageSettingsPanel({
  form,
  dirty,
  onDirtyChange,
  onReset,
  disabled,
  saving,
  onSave,
}: StorageSettingsPanelProps) {
  const { t } = useI18n();
  const pathRules = [
    { required: true, message: t("settings.pathRequired") },
    {
      validator: (_: unknown, value: string | undefined) =>
        !value || value.startsWith("/")
          ? Promise.resolve()
          : Promise.reject(new Error(t("settings.absolutePath"))),
    },
  ];

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

  return (
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
        onValuesChange={() => onDirtyChange(true)}
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
            <Button disabled={!dirty || saving} onClick={onReset}>
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
}
