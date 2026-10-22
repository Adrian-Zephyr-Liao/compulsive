import {
  BookOutlined,
  BranchesOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  DownOutlined,
  FolderOutlined,
  MergeOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { Button, Dropdown, Space, Tag, Tooltip, Typography } from "antd";
import type { MenuProps, TableProps } from "antd";

import type {
  RepositoryRecord,
  WorkspaceMember,
  WorkspaceStatusResult,
} from "../../../../types.js";
import type { Translate } from "../../../app/i18n.js";
import {
  canPush,
  canRebase,
  isNonDefaultBranch,
  isTaskComplete,
  repositoryFor,
  statusFor,
} from "../utils/workspaceSelectors.js";

const { Text } = Typography;

export type RepositoryAction =
  | "preview"
  | "detail"
  | "open"
  | "push"
  | "rebase"
  | "reference"
  | "remove"
  | "switch";

export interface RepositoryTableColumnsOptions {
  busy: boolean;
  repositories: RepositoryRecord[];
  status: WorkspaceStatusResult | undefined;
  statusFresh: boolean;
  t: Translate;
  onAction: (action: RepositoryAction, member: WorkspaceMember) => void;
}

export function createRepositoryTableColumns({
  busy,
  repositories,
  status,
  statusFresh,
  t,
  onAction,
}: RepositoryTableColumnsOptions): NonNullable<TableProps<WorkspaceMember>["columns"]> {
  function renderHealth(member: WorkspaceMember) {
    const memberStatus = statusFor(status, member);
    if (!memberStatus) return <Tag>{t("status.clickToCheck")}</Tag>;
    if (memberStatus.conflicts.length) {
      return (
        <Button
          className="!h-6 !rounded-md !px-2 !text-xs"
          color="danger"
          variant="filled"
          onClick={() => onAction("detail", member)}
        >
          {t("status.conflicts", { count: memberStatus.conflicts.length })}
        </Button>
      );
    }
    if (memberStatus.comparisonError) {
      return (
        <Tooltip title={memberStatus.comparisonError}>
          <Tag color="warning" icon={<WarningOutlined />}>
            {t("status.cannotCompare")}
          </Tag>
        </Tooltip>
      );
    }
    return (
      <Space className="max-w-full [&_.ant-tag]:mr-0 [&_.ant-tag]:w-fit" size={[4, 4]} wrap>
        {memberStatus.mergedIntoDefault && (
          <Tooltip title={t("status.mergedTip")}>
            <Tag color="success" icon={<CheckCircleFilled />}>
              {isTaskComplete(memberStatus) ? t("status.taskComplete") : t("status.remoteMerged")}
            </Tag>
          </Tooltip>
        )}
        {Boolean(memberStatus.behind) && (
          <Tag color="gold">
            {t("status.behind", {
              count: memberStatus.behind ?? 0,
              branch: memberStatus.defaultBranch ?? "",
            })}
          </Tag>
        )}
        {Boolean(memberStatus.ahead) && (
          <Tag color="green">
            {t("status.ahead", {
              count: memberStatus.ahead ?? 0,
              branch: memberStatus.defaultBranch ?? "",
            })}
          </Tag>
        )}
        {Boolean(memberStatus.unpushed) && (
          <Tag color="blue" icon={<CloudUploadOutlined />}>
            {t("status.unpushed", { count: memberStatus.unpushed ?? 0 })}
          </Tag>
        )}
        {memberStatus.forcePushRequired && (
          <Tooltip title={t("status.forcePushTip")}>
            <Tag color="error" icon={<WarningOutlined />}>
              {t("status.forcePushRequired")}
            </Tag>
          </Tooltip>
        )}
        {!memberStatus.ahead && !memberStatus.behind && (
          <Tag color="success" icon={<CheckOutlined />}>
            {t("status.synced", { branch: memberStatus.defaultBranch ?? "" })}
          </Tag>
        )}
        {memberStatus.changes.length ? (
          <Button
            className="!h-6 !rounded-md !px-2 !text-xs"
            color="orange"
            variant="filled"
            onClick={() => onAction("detail", member)}
          >
            {t("status.changes", { count: memberStatus.changes.length })}
          </Button>
        ) : (
          <Tag>{t("status.clean")}</Tag>
        )}
      </Space>
    );
  }

  return [
    {
      title: t("table.repository"),
      key: "repository",
      width: 230,
      render: (_, member) => {
        const repositoryPath =
          repositoryFor(repositories, member)?.classificationPath ?? member.repositoryId;
        const nonDefault = isNonDefaultBranch(member, statusFor(status, member));
        return (
          <div
            className={`relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 ${
              nonDefault
                ? "before:absolute before:-top-2 before:-bottom-2 before:-left-3 before:w-[3px] before:rounded-sm before:bg-[var(--ant-color-primary)] before:content-['']"
                : ""
            }`}
          >
            <FolderOutlined className="mt-1 !text-base !text-[var(--ant-color-primary-text)]" />
            <div className="grid min-w-0 gap-0.5">
              <Text className="block min-w-0 max-w-full" ellipsis strong>
                {member.alias}
              </Text>
              <Tooltip title={repositoryPath}>
                <Text className="block min-w-0 max-w-full !leading-5" ellipsis type="secondary">
                  {repositoryPath}
                </Text>
              </Tooltip>
            </div>
          </div>
        );
      },
    },
    {
      title: t("table.branch"),
      key: "branch",
      width: 180,
      render: (_, member) => {
        const memberStatus = statusFor(status, member);
        const nonDefault = isNonDefaultBranch(member, memberStatus);
        const activeBranch =
          memberStatus?.branch ??
          (member.mode === "worktree"
            ? member.detached
              ? t("status.referenceBranch", { branch: member.branch })
              : member.branch
            : "—");
        return (
          <div className="grid w-full min-w-0 gap-0.5 [&_.ant-tag]:mr-0 [&_.ant-tag]:w-fit">
            <Tooltip title={activeBranch}>
              <Text className="block min-w-0 max-w-full" code ellipsis strong={nonDefault}>
                {activeBranch}
              </Text>
            </Tooltip>
            {nonDefault && <Tag color="purple">{t("status.developmentBranch")}</Tag>}
          </div>
        );
      },
    },
    {
      title: t("table.localStatus"),
      key: "status",
      width: 250,
      render: (_, member) => renderHealth(member),
    },
    {
      title: t("table.type"),
      key: "mode",
      width: 90,
      render: (_, member) => (
        <Tag className="!mr-0 w-fit">
          {member.mode === "worktree" && !member.detached
            ? t("common.development")
            : t("common.reference")}
        </Tag>
      ),
    },
    {
      title: t("table.actions"),
      key: "actions",
      fixed: "right",
      width: 205,
      render: (_, member) => {
        const memberStatus = statusFor(status, member);
        const worktree = member.mode === "worktree" ? member : undefined;
        const menuItems: MenuProps["items"] = [];
        if (canRebase(member, memberStatus, statusFresh)) {
          menuItems.push({
            key: "rebase",
            icon: worktree?.detached ? <CloudDownloadOutlined /> : <MergeOutlined />,
            label: worktree?.detached ? t("action.pullDefault") : t("action.rebaseDefault"),
          });
        }
        if (canPush(member, memberStatus, statusFresh)) {
          menuItems.push({
            key: "push",
            icon: <CloudUploadOutlined />,
            label: memberStatus?.forcePushRequired
              ? t("action.safeForcePush")
              : t("action.syncAndPush"),
            danger: Boolean(memberStatus?.forcePushRequired),
          });
        }
        if (worktree) {
          menuItems.push({
            key: "switch",
            icon: <BranchesOutlined />,
            label: worktree.detached ? t("action.promote") : t("action.switchBranch"),
          });
        }
        if (worktree && !worktree.detached) {
          menuItems.push({
            key: "reference",
            icon: <BookOutlined />,
            label: t("action.toReference"),
          });
        }
        menuItems.push({
          key: "remove",
          danger: true,
          icon: <CloseOutlined />,
          label: t("action.removeRequirement"),
        });

        return (
          <Space size={0}>
            <Button disabled={busy} type="link" onClick={() => onAction("preview", member)}>
              {t("editor.openEditor")}
            </Button>
            <Button
              danger={Boolean(memberStatus?.conflicts.length)}
              disabled={busy}
              type="link"
              onClick={() => onAction(memberStatus?.conflicts.length ? "detail" : "open", member)}
            >
              {memberStatus?.conflicts.length ? t("action.resolveConflicts") : t("common.open")}
            </Button>
            <Dropdown
              disabled={busy}
              menu={{
                items: menuItems,
                onClick: ({ key }) => onAction(key as RepositoryAction, member),
              }}
              placement="bottomRight"
              trigger={["click"]}
            >
              <Button type="link">
                {t("common.more")} <DownOutlined />
              </Button>
            </Dropdown>
          </Space>
        );
      },
    },
  ];
}
