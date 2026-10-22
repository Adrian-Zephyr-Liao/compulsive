import { Input, Modal } from "antd";
import { useI18n } from "../../../app/i18n.js";
import type { useEditorFileActions } from "../hooks/useEditorFileActions.js";

export default function EditorFileDialog({
  fileActions,
}: {
  fileActions: ReturnType<typeof useEditorFileActions>;
}) {
  const { t } = useI18n();
  return (
    <Modal
      open={Boolean(fileActions.dialog)}
      title={fileActions.dialog ? t(`editor.${fileActions.dialog.action}`) : ""}
      onCancel={fileActions.cancel}
      onOk={() => void fileActions.submit()}
      confirmLoading={fileActions.busy}
      okButtonProps={{
        danger: fileActions.dialog?.action === "trash",
        disabled:
          !fileActions.value.trim() ||
          (fileActions.dialog?.action === "trash" && fileActions.value !== fileActions.dialog.path),
      }}
      destroyOnHidden
    >
      <p className="mb-4 mt-4 text-xs text-[var(--editor-muted)]">
        {fileActions.dialog?.action === "trash" ? t("editor.trashConfirm") : t("editor.pathHint")}
      </p>
      {fileActions.dialog?.action === "trash" && (
        <code className="mb-4 block break-all">{fileActions.dialog.path}</code>
      )}
      <Input
        autoFocus
        aria-label={t("editor.relativePath")}
        value={fileActions.value}
        onChange={(e) => fileActions.setValue(e.target.value)}
        onPressEnter={() => {
          if (fileActions.value.trim()) void fileActions.submit();
        }}
      />
    </Modal>
  );
}
