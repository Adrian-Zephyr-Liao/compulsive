import { App as AntApp, Typography } from "antd";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DevtoolWorkspace } from "../../../../devtool.js";
import type { DoctorCheck, ManagerConfig, WorkspaceStatusResult } from "../../../../types.js";
import { useI18n } from "../../../app/i18n.js";
import type { WorkspaceFeedbackState, WorkspaceRpc } from "../types.js";
import { describeError } from "../utils/errors.js";
import type { useRequirementDraft } from "./useRequirementDraft.js";

const { Text } = Typography;
interface WorkspaceActionsOptions {
  busy: boolean;
  getRpc: () => Promise<WorkspaceRpc>;
  refresh: (preferredWorkspaceId?: string) => Promise<void>;
  refreshWorkspaceStatus: (fetchRemote?: boolean) => Promise<void>;
  workspaceStatus: WorkspaceStatusResult | undefined;
  selectedWorkspaceIdRef: RefObject<string | undefined>;
  setBusyAction: Dispatch<SetStateAction<string>>;
  setFeedback: Dispatch<SetStateAction<WorkspaceFeedbackState | undefined>>;
  setRepositoryState: (state: string) => void;
}
export function useWorkspaceActions({
  busy,
  getRpc,
  refresh,
  refreshWorkspaceStatus,
  workspaceStatus,
  selectedWorkspaceIdRef,
  setBusyAction,
  setFeedback,
  setRepositoryState,
}: WorkspaceActionsOptions) {
  const { message, modal, notification } = AntApp.useApp();
  const { t } = useI18n();
  async function saveConfig(
    config: Pick<ManagerConfig, "rootDir" | "workspaceRoot" | "scanRoots">,
  ) {
    setBusyAction(t("settings.saving"));
    try {
      const rpc = await getRpc();
      await rpc.call("update-config", config);
      await refresh();
      void message.success(t("settings.saved"));
    } catch (error) {
      notification.error({
        title: t("settings.saveFailed"),
        description: describeError(error),
      });
      throw error;
    } finally {
      setBusyAction("");
    }
  }

  async function runDoctor(): Promise<DoctorCheck[]> {
    try {
      const rpc = await getRpc();
      return (await rpc.call("run-doctor")).checks;
    } catch (error) {
      notification.error({
        title: t("doctor.runFailed"),
        description: describeError(error),
      });
      throw error;
    }
  }

  async function runAction(
    name: string,
    task: () => Promise<unknown>,
    success: string,
    preferredWorkspaceId?: string,
    refreshStatus = true,
  ): Promise<boolean> {
    if (busy) return false;
    const checkedWorkspaceId = workspaceStatus?.workspaceId;
    setBusyAction(name);
    try {
      await task();
      await refresh(preferredWorkspaceId);
      if (refreshStatus && checkedWorkspaceId === selectedWorkspaceIdRef.current) {
        await refreshWorkspaceStatus(false);
      }
      setFeedback(undefined);
      void message.success(success);
      return true;
    } catch (error) {
      if (refreshStatus && checkedWorkspaceId === selectedWorkspaceIdRef.current) {
        await refreshWorkspaceStatus(false);
      }
      setFeedback(undefined);
      notification.error({
        title: t("feedback.actionFailed", { action: name }),
        description: describeError(error),
        duration: 8,
        placement: "topRight",
      });
      return false;
    } finally {
      setBusyAction("");
    }
  }

  async function copyCommand(workspace: DevtoolWorkspace): Promise<void> {
    try {
      await navigator.clipboard.writeText(workspace.cdCommand);
      setFeedback(undefined);
      void message.success(t("feedback.commandCopied"));
    } catch (error) {
      setFeedback({ title: t("feedback.copyFailed"), message: describeError(error), error: true });
    }
  }

  async function syncWorkspace(workspace: DevtoolWorkspace): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      t("feedback.syncRequirement"),
      () => rpc.call("sync-workspace", { workspaceId: workspace.id }),
      t("feedback.requirementSynced"),
      workspace.id,
    );
  }

  async function syncWorkspaceBranches(workspace: DevtoolWorkspace): Promise<void> {
    if (busy) return;
    const rpc = await getRpc();
    setBusyAction(t("feedback.batchSync"));
    try {
      const result = await rpc.call("sync-workspace-branches", { workspaceId: workspace.id });
      await refreshWorkspaceStatus(true);
      const count = (outcome: (typeof result.items)[number]["outcome"]) =>
        result.items.filter((item) => item.outcome === outcome).length;
      const synced = count("synced");
      const skipped = count("skipped");
      const conflicts = count("conflict");
      const failed = count("failed");
      const issues = result.items.filter(
        (item) => item.outcome === "failed" || item.outcome === "conflict",
      );
      if (conflicts) setRepositoryState("conflicts");
      setFeedback(undefined);
      const options = {
        title: failed
          ? t("feedback.repositoriesFailed", { count: failed })
          : conflicts
            ? t("feedback.repositoriesConflicted", { count: conflicts })
            : t("feedback.batchComplete"),
        description: (
          <div className="grid gap-2">
            <Text type="secondary">
              {t("feedback.batchSummary", { synced, skipped, conflicts, failed })}
            </Text>
            {issues.length > 0 && (
              <ul className="m-0 grid max-h-52 gap-1 overflow-auto pl-5">
                {issues.map((item) => (
                  <li key={item.repositoryId}>
                    <Text strong>{item.alias}</Text>
                    <Text type="secondary">: {item.message}</Text>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ),
        duration: issues.length ? 0 : 8,
        placement: "topRight" as const,
      };
      if (failed) notification.error(options);
      else if (conflicts) notification.warning(options);
      else notification.success(options);
    } catch (error) {
      notification.error({
        title: t("feedback.batchFailed"),
        description: describeError(error),
        duration: 8,
        placement: "topRight",
      });
    } finally {
      setBusyAction("");
    }
  }

  function confirmWorkspaceBranchSync(workspace: DevtoolWorkspace): void {
    modal.confirm({
      centered: true,
      title: t("feedback.batchTitle"),
      content: (
        <div className="grid gap-2 text-sm">
          <Text>{t("feedback.batchIntro")}</Text>
          <ul className="m-0 grid gap-1 pl-5 text-[var(--ant-color-text-secondary)]">
            <li>{t("feedback.batchRuleDevelopment")}</li>
            <li>{t("feedback.batchRuleReference")}</li>
            <li>{t("feedback.batchRuleSkip")}</li>
          </ul>
        </div>
      ),
      okText: t("feedback.startSync"),
      cancelText: t("common.cancel"),
      onOk: () => syncWorkspaceBranches(workspace),
    });
  }

  async function submitRequirement(
    requirement: ReturnType<typeof useRequirementDraft>,
  ): Promise<void> {
    if (!requirement.canSubmit) return;
    const rpc = await getRpc();
    requirement.setError("");
    const action = requirement.mode === "clone" ? t("requirement.clone") : t("requirement.create");
    setBusyAction(action);
    try {
      const name = requirement.targetName.trim();
      const workspace = requirement.selectedIds.length
        ? await rpc.call("clone-workspace", {
            ...(requirement.mode === "clone" ? { sourceWorkspaceId: requirement.sourceId } : {}),
            name,
            repositoryIds: requirement.selectedIds,
            repositoryBranches: requirement.developmentIds.map((repositoryId) => ({
              repositoryId,
              branch: requirement.repositoryBranches[repositoryId]!.trim(),
            })),
            referenceRepositoryIds: requirement.referenceIds,
          })
        : await rpc.call("create-workspace", { name });
      await refresh(workspace.id);
      setFeedback(undefined);
      void message.success(
        t(
          requirement.mode === "clone"
            ? "feedback.requirementCloned"
            : "feedback.requirementCreated",
          {
            development: requirement.developmentCount,
            reference: requirement.referenceIds.length,
          },
        ),
      );
      requirement.close();
    } catch (error) {
      const errorMessage = describeError(error);
      requirement.setError(errorMessage);
      setFeedback({
        title:
          requirement.mode === "clone"
            ? t("requirement.cloneFailed")
            : t("requirement.createFailed"),
        message: errorMessage,
        error: true,
      });
    } finally {
      setBusyAction("");
    }
  }

  return {
    saveConfig,
    runDoctor,
    runAction,
    copyCommand,
    syncWorkspace,
    confirmWorkspaceBranchSync,
    submitRequirement,
  };
}
