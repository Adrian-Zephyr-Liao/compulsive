import { App as AntApp, Typography } from "antd";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { DevtoolWorkspace } from "../../../../devtool.js";
import type {
  DoctorCheck,
  ManagerConfig,
  WorkspaceMember,
  WorkspaceStatusResult,
} from "../../../../types.js";
import { useI18n } from "../../../app/i18n.js";
import { BatchSyncFeedback } from "../components/BatchSyncFeedback.js";
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
  onInspectSyncConflict: (member: WorkspaceMember) => void;
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
  onInspectSyncConflict,
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
    setBusyAction(t("feedback.batchSync"));
    try {
      const rpc = await getRpc();
      const result = await rpc.call("sync-workspace-branches", { workspaceId: workspace.id });
      let refreshError: string | undefined;
      try {
        await refresh(selectedWorkspaceIdRef.current === workspace.id ? workspace.id : undefined);
        if (selectedWorkspaceIdRef.current === workspace.id) await refreshWorkspaceStatus(true);
      } catch (error) {
        refreshError = describeError(error);
      }
      const count = (outcome: (typeof result.items)[number]["outcome"]) =>
        result.items.filter((item) => item.outcome === outcome).length;
      const skipped = count("skipped");
      const conflicts = count("conflict");
      const failed = count("failed");
      const pushRequired = count("push-required");
      const incomplete = skipped || conflicts || failed || pushRequired || Boolean(refreshError);
      if (conflicts && selectedWorkspaceIdRef.current === workspace.id)
        setRepositoryState("conflicts");
      setFeedback(undefined);
      const options = {
        title: failed
          ? t("feedback.repositoriesFailed", { count: failed })
          : conflicts
            ? t("feedback.repositoriesConflicted", { count: conflicts })
            : incomplete
              ? t("feedback.batchIncomplete")
              : t("feedback.batchComplete"),
        description: (
          <BatchSyncFeedback
            items={result.items}
            refreshError={refreshError}
            onInspectConflict={(repositoryId) => {
              if (selectedWorkspaceIdRef.current !== workspace.id) {
                void message.warning(t("feedback.batchSelectionChanged", { name: workspace.name }));
                return;
              }
              const member = workspace.members.find((item) => item.repositoryId === repositoryId);
              if (member) onInspectSyncConflict(member);
            }}
          />
        ),
        duration: incomplete ? 0 : 8,
        placement: "topRight" as const,
      };
      if (failed) notification.error(options);
      else if (incomplete) notification.warning(options);
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
            <li>{t("feedback.batchRuleStash")}</li>
            <li>{t("feedback.batchRuleDevelopment")}</li>
            <li>{t("feedback.batchRuleReference")}</li>
            <li>{t("feedback.batchRuleRestore")}</li>
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
            repositoryBranches: requirement.developmentIds
              .filter((id) => !requirement.defaultBranchIds.includes(id))
              .map((repositoryId) => ({
                repositoryId,
                branch: requirement.repositoryBranches[repositoryId]!.trim(),
              })),
            referenceRepositoryIds: requirement.referenceIds,
            defaultBranchRepositoryIds: requirement.defaultBranchIds,
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
