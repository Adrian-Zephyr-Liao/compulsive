import { WarningOutlined } from "@ant-design/icons";
import { App as AntApp, Typography } from "antd";
import type { RefObject } from "react";
import { useState } from "react";

import { useI18n } from "../../../app/i18n.js";
import type { DevtoolWorkspace } from "../../../../devtool.js";
import type {
  RepositoryRecord,
  WorkspaceMember,
  WorkspaceStatusResult,
} from "../../../../types.js";
import type { WorkspaceRpc, RunWorkspaceAction } from "../types.js";
import { describeError } from "../utils/errors.js";
import { repositoryFor, statusFor } from "../utils/workspaceSelectors.js";

const { Text } = Typography;

interface RepositoryOperationsOptions {
  getRpc: () => Promise<WorkspaceRpc>;
  repositories: RepositoryRecord[];
  runAction: RunWorkspaceAction;
  selectedWorkspaceIdRef: RefObject<string | undefined>;
  status: WorkspaceStatusResult | undefined;
  refreshStatus: (fetchRemote?: boolean) => Promise<void>;
}

export function useRepositoryOperations({
  getRpc,
  repositories,
  runAction,
  selectedWorkspaceIdRef,
  status,
  refreshStatus,
}: RepositoryOperationsOptions) {
  const { message, modal, notification } = AntApp.useApp();
  const { t } = useI18n();
  const [codexTasks, setCodexTasks] = useState<Record<string, "starting" | "running">>({});

  async function openInVscode(workspace: DevtoolWorkspace, member: WorkspaceMember): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      t("operation.openVscode"),
      () =>
        rpc.call("open-workspace-member-in-vscode", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
        }),
      t("operation.openedVscode", { name: member.alias }),
      workspace.id,
      false,
    );
  }

  async function openInCodex(workspace: DevtoolWorkspace, member: WorkspaceMember): Promise<void> {
    const memberStatus = statusFor(status, member);
    if (!memberStatus?.conflicts.length || codexTasks[member.repositoryId]) return;
    const repositoryPath =
      member.mode === "worktree"
        ? member.worktreePath
        : (repositoryFor(repositories, member)?.absolutePath ?? workspace.absolutePath);
    const prompt = t("codex.prompt", {
      name: member.alias,
      path: repositoryPath,
      branch: memberStatus.branch,
      conflicts: memberStatus.conflicts.map((file) => `- ${file}`).join("\n"),
    });
    const rpc = await getRpc();
    const messageKey = `codex-${member.repositoryId}`;
    setCodexTasks((current) => ({ ...current, [member.repositoryId]: "starting" }));
    void message.loading({ content: t("operation.codexStarting"), key: messageKey, duration: 0 });
    try {
      const turn = await rpc.call("open-workspace-member-in-codex", {
        workspaceId: workspace.id,
        repositoryId: member.repositoryId,
        prompt,
      });
      setCodexTasks((current) => ({ ...current, [member.repositoryId]: "running" }));
      void message.loading({
        content: t("operation.codexRunning"),
        key: messageKey,
        duration: 0,
      });
      const result = await rpc.call("wait-for-codex-turn", { turnId: turn.turnId });
      if (result.status === "failed")
        throw new Error(result.message ?? t("operation.codexTurnFailed"));
      void message.success({ content: t("operation.codexComplete"), key: messageKey });
      if (selectedWorkspaceIdRef.current === workspace.id) await refreshStatus(false);
    } catch (error) {
      message.destroy(messageKey);
      notification.error({
        title: t("operation.codexFailed"),
        description: describeError(error),
        duration: 8,
        placement: "topRight",
      });
    } finally {
      setCodexTasks((current) => {
        const next = { ...current };
        delete next[member.repositoryId];
        return next;
      });
    }
  }

  async function rebase(workspace: DevtoolWorkspace, member: WorkspaceMember): Promise<void> {
    const rpc = await getRpc();
    const reference = member.mode === "worktree" && member.detached;
    await runAction(
      reference ? t("operation.updateReference") : t("operation.rebase"),
      () =>
        rpc.call("rebase-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
        }),
      reference
        ? t("operation.referenceUpdated", { name: member.alias })
        : t("operation.repositoryUpdated", { name: member.alias }),
      workspace.id,
    );
  }

  async function executePush(
    workspace: DevtoolWorkspace,
    member: WorkspaceMember,
    force = false,
  ): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      force ? t("operation.forcePush") : t("operation.push"),
      () =>
        rpc.call("push-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
          force,
        }),
      force
        ? t("operation.forcePushed", { name: member.alias })
        : t("operation.pushed", { name: member.alias }),
      workspace.id,
    );
  }

  function push(workspace: DevtoolWorkspace, member: WorkspaceMember): void {
    if (!statusFor(status, member)?.forcePushRequired) {
      void executePush(workspace, member);
      return;
    }
    modal.confirm({
      centered: true,
      title: t("operation.forcePushTitle"),
      icon: <WarningOutlined />,
      content: (
        <div className="grid gap-2">
          <Text>{t("operation.forcePushMessage", { name: member.alias })}</Text>
          <Text type="secondary">{t("operation.forcePushDetail")}</Text>
        </div>
      ),
      okText: t("action.safeForcePush"),
      okType: "danger",
      cancelText: t("common.cancel"),
      onOk: () => executePush(workspace, member, true),
    });
  }

  async function openWorkspaceInChatgpt(workspace: DevtoolWorkspace): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      t("operation.openChatgpt"),
      () => rpc.call("open-workspace-in-chatgpt", { workspaceId: workspace.id }),
      t("operation.openedChatgpt"),
      workspace.id,
      false,
    );
  }

  return { codexTasks, openInCodex, openInVscode, openWorkspaceInChatgpt, push, rebase };
}
