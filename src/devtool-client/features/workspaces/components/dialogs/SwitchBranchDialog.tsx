import { Alert, Button, Form, Modal, Space, Typography } from "antd";

import { useI18n } from "../../../../app/i18n.js";
import type { RepositoryBranch } from "../../../../../types.js";
import type { WorktreeMember } from "../../types.js";
import { BranchSelect } from "../BranchSelect.js";

const { Paragraph, Text } = Typography;

export interface SwitchBranchDialogProps {
  branch: string;
  branches: RepositoryBranch[];
  branchLoading: boolean;
  busy: boolean;
  error: string;
  member: WorktreeMember | undefined;
  open: boolean;
  submitting: boolean;
  onBranchChange: (value: string) => void;
  onClose: () => void;
  onLoadBranches: () => void;
  onSubmit: () => void;
}

export function SwitchBranchDialog({
  branch,
  branches,
  branchLoading,
  busy,
  error,
  member,
  open,
  submitting,
  onBranchChange,
  onClose,
  onLoadBranches,
  onSubmit,
}: SwitchBranchDialogProps) {
  const { t } = useI18n();
  const action = member?.detached ? t("action.promote") : t("action.switchBranch");

  return (
    <Modal
      centered
      destroyOnHidden
      mask={{ closable: !busy }}
      open={open}
      title={action}
      width={560}
      footer={
        <Space>
          <Button disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!branch.trim() || busy}
            form="promote-form"
            htmlType="submit"
            loading={submitting}
            type="primary"
          >
            {action}
          </Button>
        </Space>
      }
      onCancel={() => !busy && onClose()}
    >
      <div className="mb-5">
        <Text strong>{member?.alias ?? ""}</Text>
        {member?.branch && (
          <Text type="secondary">
            {" · "}
            {t("switch.currentBranch")} <Text code>{member.branch}</Text>
          </Text>
        )}
        <Paragraph className="!mb-0 !mt-1" type="secondary">
          {t("switch.description")}
        </Paragraph>
      </div>
      <Form id="promote-form" layout="vertical" onFinish={onSubmit}>
        <Form.Item extra={t("switch.branchExtra")} label={t("switch.targetBranch")} required>
          <BranchSelect
            branches={branches}
            id="promote-branch"
            loading={branchLoading}
            name="promoteBranch"
            value={branch}
            onChange={onBranchChange}
            onFocus={onLoadBranches}
          />
        </Form.Item>
        {error && (
          <Alert
            className="!mt-4"
            description={error}
            title={t("switch.failed")}
            showIcon
            type="error"
          />
        )}
      </Form>
    </Modal>
  );
}
