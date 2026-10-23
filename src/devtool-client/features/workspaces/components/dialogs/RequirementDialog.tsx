import { FolderOutlined, LoadingOutlined, SearchOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Checkbox,
  Empty,
  Flex,
  Form,
  Input,
  Listy,
  Modal,
  Segmented,
  Select,
  Space,
  Typography,
} from "antd";

import type { DevtoolWorkspace } from "../../../../../devtool.js";
import type { RepositoryBranch } from "../../../../../types.js";
import { useI18n } from "../../../../app/i18n.js";
import type { RequirementRepository } from "../../types.js";
import { DevelopmentBranchSelect } from "../DevelopmentBranchSelect.js";

const { Paragraph, Text } = Typography;

export interface RequirementDialogProps {
  branchLoadingIds: string[];
  branchOptions: Record<string, RepositoryBranch[]>;
  busy: boolean;
  canSubmit: boolean;
  developmentCount: number;
  defaultBranchIds: string[];
  error: string;
  mode: "create" | "clone";
  open: boolean;
  referenceIds: string[];
  repositories: RequirementRepository[];
  repositoryBranches: Record<string, string>;
  repositoryQuery: string;
  selectedIds: string[];
  sourceId: string;
  submitting: boolean;
  targetName: string;
  targetPath: string;
  workspaces: DevtoolWorkspace[];
  onBranchChange: (repositoryId: string, branch: string) => void;
  onDefaultBranchChange: (repositoryId: string, value: boolean) => void;
  onClose: () => void;
  onLoadBranches: (repositoryId: string) => void;
  onRepositoryQueryChange: (value: string) => void;
  onSourceChange: (workspaceId: string) => void;
  onSubmit: () => void;
  onTargetNameChange: (value: string) => void;
  onToggleReference: (repositoryId: string) => void;
  onToggleRepository: (repositoryId: string) => void;
}

export function RequirementDialog({
  branchLoadingIds,
  branchOptions,
  busy,
  canSubmit,
  developmentCount,
  defaultBranchIds,
  error,
  mode,
  open,
  referenceIds,
  repositories,
  repositoryBranches,
  repositoryQuery,
  selectedIds,
  sourceId,
  submitting,
  targetName,
  targetPath,
  workspaces,
  onBranchChange,
  onDefaultBranchChange,
  onClose,
  onLoadBranches,
  onRepositoryQueryChange,
  onSourceChange,
  onSubmit,
  onTargetNameChange,
  onToggleReference,
  onToggleRepository,
}: RequirementDialogProps) {
  const { t } = useI18n();
  const cloning = mode === "clone";

  return (
    <Modal
      centered
      classNames={{ body: "max-h-[calc(100dvh-220px)] overflow-y-auto" }}
      destroyOnHidden
      mask={{ closable: !busy }}
      open={open}
      title={cloning ? t("requirement.clone") : t("requirement.new")}
      width={840}
      footer={
        <Flex align="center" justify="space-between">
          <Text type="secondary">
            {t("requirement.counts", {
              development: developmentCount,
              reference: referenceIds.length,
            })}
          </Text>
          <Space>
            <Button disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!canSubmit}
              form="clone-form"
              htmlType="submit"
              loading={submitting}
              type="primary"
            >
              {cloning ? t("requirement.clone") : t("requirement.create")}
            </Button>
          </Space>
        </Flex>
      }
      onCancel={() => !busy && onClose()}
    >
      <Paragraph type="secondary">
        {cloning ? t("requirement.cloneDescription") : t("requirement.createDescription")}
      </Paragraph>
      <Form id="clone-form" layout="vertical" onFinish={onSubmit}>
        <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-6 max-[761px]:grid-cols-1">
          <div className="min-w-0">
            {cloning && (
              <Form.Item label={t("requirement.source")} required>
                <Select<string>
                  showSearch={{ optionFilterProp: "label" }}
                  id="clone-source"
                  options={workspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  }))}
                  placeholder={t("requirement.search")}
                  {...(sourceId ? { value: sourceId } : {})}
                  onChange={onSourceChange}
                />
              </Form.Item>
            )}
            <Form.Item
              extra={
                targetName.trim() ? t("requirement.location", { path: targetPath }) : undefined
              }
              label={t("requirement.name")}
              required
            >
              <Input
                autoFocus={!cloning}
                id="clone-target"
                name="cloneTarget"
                placeholder={t("requirement.namePlaceholder")}
                prefix={<FolderOutlined />}
                value={targetName}
                onChange={(event) => onTargetNameChange(event.target.value)}
              />
            </Form.Item>
            <Text type="secondary">{t("requirement.branchHint")}</Text>
          </div>
          <div className="min-w-0">
            <Flex align="center" className="mb-2 min-h-8" justify="space-between">
              <Text strong>{t("requirement.selectRepositories")}</Text>
              <Text type="secondary">
                {t("requirement.selected", { count: selectedIds.length })}
              </Text>
            </Flex>
            <Input
              allowClear
              className="mb-3"
              id="clone-repository-search"
              name="cloneRepositorySearch"
              placeholder={t("requirement.searchRepositories")}
              prefix={<SearchOutlined />}
              value={repositoryQuery}
              onChange={(event) => onRepositoryQueryChange(event.target.value)}
            />
            {repositories.length ? (
              <Listy
                className="max-h-[360px] overflow-auto rounded-md border border-[var(--ant-color-border-secondary)] [&_.ant-checkbox-wrapper]:min-w-0 [&_.ant-space]:min-w-0"
                classNames={{ item: "!px-3 !py-2 [&>.ant-flex]:min-w-0" }}
                items={repositories}
                rowKey={({ repository }) => repository.id}
                itemRender={({ member, repository }) => {
                  const selected = selectedIds.includes(repository.id);
                  const reference = referenceIds.includes(repository.id);
                  const alias = member?.alias ?? repository.name;
                  return (
                    <Flex className="min-w-0" gap={8} vertical>
                      <Flex align="center" className="min-w-0" gap={16} justify="space-between">
                        <Checkbox
                          checked={selected}
                          className="min-w-0 flex-1 overflow-hidden"
                          name={`cloneRepository-${repository.id}`}
                          onChange={() => onToggleRepository(repository.id)}
                        >
                          <Space orientation="vertical" size={0}>
                            <Text strong>{alias}</Text>
                            <Text className="block !max-w-[190px]" code ellipsis type="secondary">
                              {repository.classificationPath}
                            </Text>
                          </Space>
                        </Checkbox>
                        <Segmented
                          aria-label={t("requirement.linkMode", { alias })}
                          disabled={!selected}
                          options={[
                            { label: t("common.development"), value: "worktree" },
                            { label: t("common.reference"), value: "reference" },
                          ]}
                          size="small"
                          value={reference ? "reference" : "worktree"}
                          onChange={(value) => {
                            if ((value === "reference") !== reference)
                              onToggleReference(repository.id);
                          }}
                        />
                      </Flex>
                      {selected && !reference && (
                        <DevelopmentBranchSelect
                          useDefaultBranch={defaultBranchIds.includes(repository.id)}
                          onDefaultBranchChange={(value) =>
                            onDefaultBranchChange(repository.id, value)
                          }
                          ariaLabel={t("requirement.branchLabel", { alias })}
                          branches={branchOptions[repository.id] ?? []}
                          loading={branchLoadingIds.includes(repository.id)}
                          size="small"
                          value={repositoryBranches[repository.id] ?? ""}
                          {...(repositoryBranches[repository.id]?.trim()
                            ? {}
                            : { status: "error" as const })}
                          onChange={(branch) => onBranchChange(repository.id, branch)}
                          onFocus={() => onLoadBranches(repository.id)}
                        />
                      )}
                    </Flex>
                  );
                }}
              />
            ) : (
              <Flex
                align="center"
                className="min-h-[180px] rounded-md border border-[var(--ant-color-border-secondary)]"
                justify="center"
              >
                <Empty
                  description={
                    repositoryQuery.trim()
                      ? t("requirement.noRepositoryMatches")
                      : t("requirement.searchRepositories")
                  }
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              </Flex>
            )}
          </div>
        </div>
        {submitting && (
          <Alert
            description={t("requirement.creatingDescription")}
            icon={<LoadingOutlined spin />}
            title={t("requirement.fetchingDefault")}
            showIcon
            type="info"
          />
        )}
        {error && (
          <Alert
            description={error}
            title={cloning ? t("requirement.cloneFailed") : t("requirement.createFailed")}
            showIcon
            type="error"
          />
        )}
      </Form>
    </Modal>
  );
}
