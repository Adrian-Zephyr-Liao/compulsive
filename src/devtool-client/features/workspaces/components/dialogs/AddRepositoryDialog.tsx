import { Button, Form, Input, Modal, Select, Space, Typography } from "antd";

import { useI18n } from "../../../../app/i18n.js";
import type { RepositoryBranch, RepositoryRecord } from "../../../../../types.js";
import { BranchSelect } from "../BranchSelect.js";

const { Paragraph } = Typography;

export interface AddRepositoryDialogProps {
  alias: string;
  branch: string;
  branches: RepositoryBranch[];
  branchLoading: boolean;
  busy: boolean;
  open: boolean;
  repositories: RepositoryRecord[];
  selectedRepositoryId: string;
  submitting: boolean;
  onAliasChange: (value: string) => void;
  onBranchChange: (value: string) => void;
  onClose: () => void;
  onLoadBranches: () => void;
  onRepositoryChange: (repositoryId: string) => void;
  onSubmit: () => void;
}

export function AddRepositoryDialog({
  alias,
  branch,
  branches,
  branchLoading,
  busy,
  open,
  repositories,
  selectedRepositoryId,
  submitting,
  onAliasChange,
  onBranchChange,
  onClose,
  onLoadBranches,
  onRepositoryChange,
  onSubmit,
}: AddRepositoryDialogProps) {
  const { t } = useI18n();
  return (
    <Modal
      centered
      destroyOnHidden
      mask={{ closable: !busy }}
      open={open}
      title={t("add.title")}
      width={560}
      footer={
        <Space>
          <Button disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!selectedRepositoryId || !branch.trim() || busy}
            form="add-repository-form"
            htmlType="submit"
            loading={submitting}
            type="primary"
          >
            {t("common.add")}
          </Button>
        </Space>
      }
      onCancel={() => !busy && onClose()}
    >
      <Paragraph type="secondary">{t("add.description")}</Paragraph>
      <Form id="add-repository-form" layout="vertical" onFinish={onSubmit}>
        <Form.Item label={t("add.repository")} required>
          <Select<string>
            showSearch={{ optionFilterProp: "label" }}
            disabled={!repositories.length}
            id="repository-select"
            options={repositories.map((repository) => ({
              value: repository.id,
              label: repository.classificationPath,
            }))}
            placeholder={t("add.searchRepository")}
            {...(selectedRepositoryId ? { value: selectedRepositoryId } : {})}
            onChange={onRepositoryChange}
          />
        </Form.Item>
        <Form.Item label={t("add.alias")}>
          <Input
            id="repository-alias"
            name="repositoryAlias"
            placeholder={t("add.aliasPlaceholder")}
            value={alias}
            onChange={(event) => onAliasChange(event.target.value)}
          />
        </Form.Item>
        <Form.Item extra={t("add.branchExtra")} label={t("add.branch")} required>
          <BranchSelect
            branches={branches}
            id="repository-branch"
            loading={branchLoading}
            name="repositoryBranch"
            value={branch}
            onChange={onBranchChange}
            onFocus={onLoadBranches}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
