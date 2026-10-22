import { Form, InputNumber, Modal, Segmented, Switch } from "antd";
import { useI18n } from "../../../app/i18n.js";
import type { EditorPreferences as Preferences } from "../../../../project/session.js";
export default function EditorPreferences({
  open,
  close,
  value,
  onChange,
  dark,
  onThemeChange,
  themeBusy,
}: {
  open: boolean;
  close: () => void;
  value: Preferences;
  onChange: (p: Preferences) => void;
  dark: boolean;
  onThemeChange: (dark: boolean) => void;
  themeBusy: boolean;
}) {
  const { t } = useI18n();
  const update = (patch: Partial<Preferences>) => onChange({ ...value, ...patch });
  return (
    <Modal
      open={open}
      onCancel={close}
      title={t("editor.settings")}
      footer={null}
      centered
      styles={{ body: { maxHeight: "calc(100dvh - 160px)", overflowY: "auto" } }}
    >
      <Form layout="vertical" className="!mt-6">
        <Form.Item label={t("appearance.label")} extra={t("appearance.globalHint")}>
          <Segmented
            aria-label={t("appearance.label")}
            disabled={themeBusy}
            value={dark ? "dark" : "light"}
            options={[
              { label: t("editor.dark"), value: "dark" },
              { label: t("editor.light"), value: "light" },
            ]}
            onChange={(v) => onThemeChange(v === "dark")}
          />
        </Form.Item>
        <div className="grid grid-cols-2 gap-4">
          <Form.Item label={t("editor.fontSize")} htmlFor="editor-font-size">
            <InputNumber
              style={{ width: "100%" }}
              id="editor-font-size"
              min={10}
              max={28}
              value={value.fontSize}
              onChange={(v) => {
                if (v) update({ fontSize: v });
              }}
            />
          </Form.Item>
          <Form.Item label={t("editor.lineHeight")} htmlFor="editor-line-height">
            <InputNumber
              style={{ width: "100%" }}
              id="editor-line-height"
              min={1.2}
              max={2.5}
              step={0.1}
              value={value.lineHeight}
              onChange={(v) => {
                if (v) update({ lineHeight: v });
              }}
            />
          </Form.Item>
        </div>
        {(["wrap", "vim", "autoSave"] as const).map((key) => (
          <Form.Item
            key={key}
            label={t(`editor.${key}`)}
            htmlFor={`editor-${key}`}
            layout="horizontal"
            labelAlign="left"
            labelCol={{ flex: "auto" }}
            wrapperCol={{ flex: "none" }}
            colon={false}
          >
            <Switch
              id={`editor-${key}`}
              aria-label={t(`editor.${key}`)}
              checked={value[key]}
              onChange={(v) => update({ [key]: v })}
            />
          </Form.Item>
        ))}
        <Form.Item label={t("editor.terminalPlacement")}>
          <Segmented
            value={value.terminalPlacement}
            options={(["bottom", "side", "editor"] as const).map((key) => ({
              value: key,
              label: t(`editor.${key}`),
            }))}
            onChange={(v) => update({ terminalPlacement: v })}
          />
        </Form.Item>
        <p className="text-xs text-[var(--editor-muted)]">{t("editor.preferencesLocal")}</p>
      </Form>
    </Modal>
  );
}
