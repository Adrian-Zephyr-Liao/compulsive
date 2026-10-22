import { useState } from "react";
import { Checkbox } from "antd";
import { useI18n } from "../../../app/i18n.js";

export default function EditorDiscardOptions({
  branch,
  count,
  onBackupChange,
}: {
  branch: string;
  count: number;
  onBackupChange: (backup: boolean) => void;
}) {
  const { t } = useI18n();
  const [backup, setBackup] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <p>{t("editor.discardAllWarning", { branch, count })}</p>
      <Checkbox
        checked={backup}
        onChange={(event) => {
          setBackup(event.target.checked);
          onBackupChange(event.target.checked);
        }}
      >
        {t("editor.discardBackup")}
      </Checkbox>
      <p
        className={`text-xs ${backup ? "text-[var(--ant-color-text-secondary)]" : "text-[var(--ant-color-error-text)]"}`}
      >
        {t(backup ? "editor.discardBackupHint" : "editor.discardNoBackupHint")}
      </p>
    </div>
  );
}
