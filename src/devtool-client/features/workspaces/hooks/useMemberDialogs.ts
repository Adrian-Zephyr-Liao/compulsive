import { useState } from "react";
import type { DevtoolWorkspace } from "../../../../devtool.js";
import type { RepositoryRecord, WorkspaceMember } from "../../../../types.js";
import { useI18n } from "../../../app/i18n.js";
import type {
  ConfirmState,
  WorktreeMember,
  WorkspaceFeedbackState,
  WorkspaceRpc,
  RunWorkspaceAction,
} from "../types.js";
interface MemberDialogsOptions {
  busy: boolean;
  currentWorkspace: DevtoolWorkspace | undefined;
  availableRepositories: RepositoryRecord[];
  getRpc: () => Promise<WorkspaceRpc>;
  runAction: RunWorkspaceAction;
  loadRepositoryBranchOptions: (repositoryId: string, force?: boolean) => Promise<void>;
  feedback: WorkspaceFeedbackState | undefined;
}
export function useMemberDialogs({
  busy,
  currentWorkspace,
  availableRepositories,
  getRpc,
  runAction,
  loadRepositoryBranchOptions,
  feedback,
}: MemberDialogsOptions) {
  const { t } = useI18n();
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [alias, setAlias] = useState("");
  const [branch, setBranch] = useState("");
  const [useDefaultBranch, setUseDefaultBranch] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteMember, setPromoteMember] = useState<WorktreeMember>();
  const [promoteBranch, setPromoteBranch] = useState("");
  const [promoteError, setPromoteError] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState>();
  const [confirmAcknowledged, setConfirmAcknowledged] = useState(false);
  function openPromoteReference(workspace: DevtoolWorkspace, member: WorktreeMember): void {
    setPromoteMember(member);
    setPromoteBranch(
      member.detached ? `workspace/${workspace.name}/${member.alias}` : member.branch,
    );
    setPromoteError("");
    setPromoteOpen(true);
    void loadRepositoryBranchOptions(member.repositoryId, true);
  }

  async function submitPromoteReference(): Promise<void> {
    const workspace = currentWorkspace;
    const member = promoteMember;
    const nextBranch = promoteBranch.trim();
    if (!workspace || !member || !nextBranch || busy) return;
    const rpc = await getRpc();
    setPromoteError("");
    const succeeded = await runAction(
      member.detached ? t("action.promote") : t("action.switchBranch"),
      () =>
        rpc.call("switch-workspace-member-branch", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
          branch: nextBranch,
        }),
      member.detached
        ? `${t("action.promote")}: ${member.alias}`
        : `${t("action.switchBranch")}: ${member.alias}`,
      workspace.id,
    );
    if (succeeded) setPromoteOpen(false);
    else setPromoteError(feedback?.message ?? t("feedback.promoteFailed"));
  }

  async function addMember(workspace: DevtoolWorkspace): Promise<void> {
    const repository = availableRepositories.find((item) => item.id === selectedRepositoryId);
    if (!repository || busy || (!useDefaultBranch && !branch.trim())) return;
    const rpc = await getRpc();
    const succeeded = await runAction(
      t("feedback.addRepository"),
      () =>
        rpc.call("add-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: repository.id,
          ...(alias.trim() ? { alias: alias.trim() } : {}),
          ...(useDefaultBranch ? { useDefaultBranch: true } : { branch: branch.trim() }),
          createBranch: true,
        }),
      `${t("common.add")}: ${repository.name}`,
      workspace.id,
    );
    if (succeeded) setShowAdd(false);
  }

  function openDeleteWorkspace(workspace: DevtoolWorkspace): void {
    setConfirmAcknowledged(false);
    setConfirmState({
      title: t("confirm.deleteTitle", { name: workspace.name }),
      message: t("confirm.deleteMessage"),
      warning: t("confirm.deleteWarning"),
      confirmLabel: t("confirm.permanentDelete"),
      action: "delete-workspace",
      workspace,
    });
    setConfirmOpen(true);
  }

  function openRemoveMember(workspace: DevtoolWorkspace, member: WorkspaceMember): void {
    setConfirmAcknowledged(true);
    setConfirmState({
      title: t("confirm.removeTitle", { name: member.alias }),
      message: t("confirm.removeMessage", { workspace: workspace.name }),
      action: "remove-member",
      workspace,
      member,
    });
    setConfirmOpen(true);
  }

  function openConvertToReference(workspace: DevtoolWorkspace, member: WorktreeMember): void {
    setConfirmAcknowledged(true);
    setConfirmState({
      title: t("confirm.referenceTitle", { name: member.alias }),
      message: t("confirm.referenceMessage", { branch: member.branch }),
      warning: t("confirm.referenceWarning"),
      confirmLabel: t("action.toReference"),
      action: "convert-to-reference",
      workspace,
      member,
    });
    setConfirmOpen(true);
  }

  async function confirmAction(): Promise<void> {
    const pending = confirmState;
    if (!pending || busy) return;
    setConfirmOpen(false);
    const rpc = await getRpc();
    if (pending.action === "delete-workspace") {
      await runAction(
        t("feedback.deleteRequirement"),
        () => rpc.call("delete-workspace", { workspaceId: pending.workspace.id }),
        `${t("feedback.deleteRequirement")}: ${pending.workspace.name}`,
      );
      return;
    }
    if (pending.action === "convert-to-reference") {
      await runAction(
        t("feedback.toReference"),
        () =>
          rpc.call("convert-workspace-to-reference", {
            workspaceId: pending.workspace.id,
            repositoryId: pending.member!.repositoryId,
          }),
        `${t("feedback.toReference")}: ${pending.member!.alias}`,
        pending.workspace.id,
      );
      return;
    }
    await runAction(
      t("feedback.removeRepository"),
      () =>
        rpc.call("remove-workspace-member", {
          workspaceId: pending.workspace.id,
          repositoryId: pending.member!.repositoryId,
        }),
      `${t("feedback.removeRepository")}: ${pending.member!.alias}`,
      pending.workspace.id,
    );
  }

  return {
    showAdd,
    setShowAdd,
    selectedRepositoryId,
    setSelectedRepositoryId,
    alias,
    setAlias,
    branch,
    setBranch,
    useDefaultBranch,
    setUseDefaultBranch,
    confirmOpen,
    setConfirmOpen,
    promoteOpen,
    setPromoteOpen,
    promoteMember,
    promoteBranch,
    setPromoteBranch,
    promoteError,
    confirmState,
    confirmAcknowledged,
    setConfirmAcknowledged,
    openPromoteReference,
    submitPromoteReference,
    addMember,
    openDeleteWorkspace,
    openRemoveMember,
    openConvertToReference,
    confirmAction,
  };
}
