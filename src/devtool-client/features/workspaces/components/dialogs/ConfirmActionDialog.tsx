import { WarningOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Modal, Typography } from "antd";

import { useI18n } from "../../../../app/i18n.js";
import type { ConfirmState } from "../../types.js";

const { Paragraph } = Typography;

export interface ConfirmActionDialogProps {
  acknowledged: boolean;
  busy: boolean;
  open: boolean;
  state: ConfirmState | undefined;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmActionDialog({
  acknowledged,
  busy,
  open,
  state,
  onAcknowledgedChange,
  onClose,
  onConfirm,
}: ConfirmActionDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      centered
      mask={{ closable: !busy }}
      open={open && Boolean(state)}
      title={state?.title}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            danger={state?.action !== "convert-to-reference"}
            disabled={state?.action === "delete-workspace" && !acknowledged}
            loading={busy}
            type="primary"
            onClick={onConfirm}
          >
            {state?.confirmLabel ?? t("confirm.default")}
          </Button>
        </>
      }
      onCancel={() => !busy && onClose()}
    >
      <Paragraph>{state?.message}</Paragraph>
      <Alert
        description={state?.warning ?? t("confirm.defaultWarning")}
        icon={<WarningOutlined />}
        showIcon
        type="warning"
      />
      {state?.action === "delete-workspace" && (
        <Checkbox
          checked={acknowledged}
          className="mt-4"
          onChange={(event) => onAcknowledgedChange(event.target.checked)}
        >
          {t("confirm.acknowledge")}
        </Checkbox>
      )}
    </Modal>
  );
}
