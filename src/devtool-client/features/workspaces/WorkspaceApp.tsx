import { DatabaseOutlined, FolderOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, App as AntApp, Empty, Flex, Layout, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router";

import { useI18n } from "../../app/i18n.js";
import { DevtoolRoutes, routePaths } from "../../app/routes.js";
import type { DevtoolState, DevtoolWorkspace } from "../../../devtool.js";
import type { DoctorCheck, ManagerConfig, WorkspaceMember } from "../../../types.js";
import { SystemSettingsPage } from "../settings/SystemSettingsPage.js";
import { RequirementPage } from "./RequirementPage.js";
import { RepositoryDetailDrawer } from "./components/RepositoryDetailDrawer.js";
import type { RepositoryStatusCounts } from "./components/RepositoryPanel.js";
import {
  createRepositoryTableColumns,
  type RepositoryAction,
} from "./components/RepositoryTableColumns.js";
import { WorkspaceHeader } from "./components/WorkspaceHeader.js";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar.js";
import { AddRepositoryDialog } from "./components/dialogs/AddRepositoryDialog.js";
import { ConfirmActionDialog } from "./components/dialogs/ConfirmActionDialog.js";
import { RequirementDialog } from "./components/dialogs/RequirementDialog.js";
import { SwitchBranchDialog } from "./components/dialogs/SwitchBranchDialog.js";
import { useRepositoryBranches } from "./hooks/useRepositoryBranches.js";
import { useRepositoryOperations } from "./hooks/useRepositoryOperations.js";
import { useRequirementDraft } from "./hooks/useRequirementDraft.js";
import { useWorkspaceConnection } from "./hooks/useWorkspaceConnection.js";
import { useWorkspaceStatus } from "./hooks/useWorkspaceStatus.js";
import type { ConfirmState, WorktreeMember } from "./types.js";
import { describeError } from "./utils/errors.js";
import {
  isNonDefaultBranch as selectIsNonDefaultBranch,
  repositoryFor as selectRepositoryFor,
  statusFor as selectStatusFor,
} from "./utils/workspaceSelectors.js";

const initialState: DevtoolState = {
  config: { schemaVersion: 1, rootDir: "", workspaceRoot: "", scanRoots: [] },
  repositories: [],
  workspaces: [],
  workspaceStatuses: [],
};

const { Content, Footer } = Layout;
const { Text } = Typography;

export default function WorkspaceApp() {
  const { message, modal, notification } = AntApp.useApp();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const workspaceRoute = useMatch(routePaths.requirementPattern);
  const settingsSelected = Boolean(useMatch(routePaths.settingsPattern));
  const [state, setState] = useState(initialState);
  const selectedWorkspaceIdRef = useRef(workspaceRoute?.params.workspaceId);
  const selectedWorkspaceId =
    workspaceRoute?.params.workspaceId ?? selectedWorkspaceIdRef.current ?? state.workspaces[0]?.id;
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [repositoryMode, setRepositoryMode] = useState("all");
  const [repositoryState, setRepositoryState] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [alias, setAlias] = useState("");
  const [branch, setBranch] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    error: boolean;
  }>();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [promoteMember, setPromoteMember] = useState<WorktreeMember>();
  const [promoteBranch, setPromoteBranch] = useState("");
  const [promoteError, setPromoteError] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState>();
  const [confirmAcknowledged, setConfirmAcknowledged] = useState(false);
  const [detailMember, setDetailMember] = useState<WorkspaceMember>();
  const contentRef = useRef<HTMLDivElement>(null);

  const applyState = useCallback((nextState: DevtoolState, preferredWorkspaceId?: string) => {
    const preferred = preferredWorkspaceId ?? selectedWorkspaceIdRef.current;
    const nextSelectedId = nextState.workspaces.some((workspace) => workspace.id === preferred)
      ? preferred
      : nextState.workspaces[0]?.id;
    setState(nextState);
    selectedWorkspaceIdRef.current = nextSelectedId;
  }, []);
  const { connectionState, fatalError, getRpc } = useWorkspaceConnection(applyState);
  const reportBranchError = useCallback(
    (error: string) => {
      void message.warning(error);
    },
    [message],
  );
  const {
    branchOptions: repositoryBranchOptions,
    loadingIds: branchLoadingIds,
    load: loadRepositoryBranchOptions,
    reset: resetRepositoryBranches,
  } = useRepositoryBranches({ getRpc, onError: reportBranchError });
  const reportStatusError = useCallback(
    (error: string) => {
      setFeedback({ title: t("feedback.statusFailed"), message: error, error: true });
    },
    [t],
  );
  const {
    fresh: workspaceStatusFresh,
    loading: statusLoading,
    refresh: refreshWorkspaceStatus,
    status: workspaceStatus,
  } = useWorkspaceStatus({
    cachedStatuses: state.workspaceStatuses,
    getRpc,
    selectedWorkspaceId,
    onError: reportStatusError,
  });

  const busy = Boolean(busyAction) || connectionState !== "connected";
  const currentWorkspace = useMemo(
    () => state.workspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, state.workspaces],
  );
  const requirement = useRequirementDraft({
    busy,
    currentWorkspace,
    repositories: state.repositories,
    workspaceRoot: state.config?.workspaceRoot ?? "",
    workspaces: state.workspaces,
    onResetBranches: resetRepositoryBranches,
  });
  const filteredWorkspaces = useMemo(() => {
    const query = workspaceQuery.trim().toLowerCase();
    return state.workspaces.filter((workspace) =>
      [workspace.name, workspace.absolutePath].some((value) => value.toLowerCase().includes(query)),
    );
  }, [state.workspaces, workspaceQuery]);
  const availableRepositories = useMemo(() => {
    const memberIds = new Set(currentWorkspace?.members.map((member) => member.repositoryId));
    return state.repositories.filter((repository) => !memberIds.has(repository.id));
  }, [currentWorkspace, state.repositories]);
  const filteredMembers = useMemo(() => {
    const query = repositoryQuery.trim().toLowerCase();
    return (currentWorkspace?.members ?? []).filter((member) => {
      const status = statusFor(member);
      const mode = member.mode === "worktree" && member.detached ? "reference" : member.mode;
      const stateMatches =
        repositoryState === "all" ||
        (repositoryState === "attention" &&
          Boolean(
            status?.changes.length ||
            status?.conflicts.length ||
            status?.behind ||
            status?.unpushed ||
            status?.comparisonError,
          )) ||
        (repositoryState === "unpushed" && Boolean(status?.unpushed)) ||
        (repositoryState === "conflicts" && Boolean(status?.conflicts.length));
      return (
        (repositoryMode === "all" || mode === repositoryMode) &&
        stateMatches &&
        [member.alias, repositoryFor(member)?.classificationPath ?? "", status?.branch ?? ""].some(
          (value) => value.toLowerCase().includes(query),
        )
      );
    });
  }, [
    currentWorkspace,
    repositoryMode,
    repositoryQuery,
    repositoryState,
    state.repositories,
    workspaceStatus,
  ]);
  const repositoryStatusCounts = useMemo<RepositoryStatusCounts>(() => {
    const memberIds = new Set(currentWorkspace?.members.map((member) => member.repositoryId));
    const statuses = (workspaceStatus?.members ?? []).filter((status) =>
      memberIds.has(status.repositoryId),
    );
    return {
      all: currentWorkspace?.members.length ?? 0,
      attention: statuses.filter((status) =>
        Boolean(
          status.changes.length ||
          status.conflicts.length ||
          status.behind ||
          status.unpushed ||
          status.comparisonError,
        ),
      ).length,
      unpushed: statuses.filter((status) => status.unpushed).length,
      conflicts: statuses.filter((status) => status.conflicts.length).length,
    };
  }, [currentWorkspace, workspaceStatus]);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    setShowAdd(false);
    setAlias("");
    setBranch("");
    setDetailMember(undefined);
    setPromoteOpen(false);
    setConfirmOpen(false);
  }, [selectedWorkspaceId, settingsSelected]);

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (!availableRepositories.some((repository) => repository.id === selectedRepositoryId)) {
      setSelectedRepositoryId(availableRepositories[0]?.id ?? "");
    }
  }, [availableRepositories, selectedRepositoryId]);

  function repositoryFor(member: WorkspaceMember) {
    return selectRepositoryFor(state.repositories, member);
  }

  function statusFor(member: WorkspaceMember) {
    return selectStatusFor(workspaceStatus, member);
  }

  function isNonDefaultBranch(member: WorkspaceMember): boolean {
    return selectIsNonDefaultBranch(member, statusFor(member));
  }

  async function refresh(preferredWorkspaceId?: string): Promise<void> {
    const rpc = await getRpc();
    const nextState = await rpc.call("get-state");
    applyState(nextState, preferredWorkspaceId);
    if (
      preferredWorkspaceId &&
      workspaceRoute?.params.workspaceId !== preferredWorkspaceId &&
      nextState.workspaces.some((workspace) => workspace.id === preferredWorkspaceId)
    ) {
      void navigate(routePaths.requirement(preferredWorkspaceId));
    }
  }

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

  const repositoryOperations = useRepositoryOperations({
    getRpc,
    repositories: state.repositories,
    runAction,
    selectedWorkspaceIdRef,
    status: workspaceStatus,
    refreshStatus: refreshWorkspaceStatus,
  });

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
    if (!repository) return;
    const rpc = await getRpc();
    const succeeded = await runAction(
      t("feedback.addRepository"),
      () =>
        rpc.call("add-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: repository.id,
          ...(alias.trim() ? { alias: alias.trim() } : {}),
          ...(branch.trim() ? { branch: branch.trim() } : {}),
          createBranch: true,
        }),
      `${t("common.add")}: ${repository.name}`,
      workspace.id,
    );
    if (succeeded) setShowAdd(false);
  }

  async function submitClone(): Promise<void> {
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

  const columns = createRepositoryTableColumns({
    busy,
    repositories: state.repositories,
    status: workspaceStatus,
    statusFresh: workspaceStatusFresh,
    t,
    onAction: (action: RepositoryAction, member) => {
      if (!currentWorkspace) return;
      const worktree = member.mode === "worktree" ? member : undefined;
      if (action === "detail") setDetailMember(member);
      if (action === "open") void repositoryOperations.openInVscode(currentWorkspace, member);
      if (action === "rebase") void repositoryOperations.rebase(currentWorkspace, member);
      if (action === "push") repositoryOperations.push(currentWorkspace, member);
      if (action === "switch" && worktree) openPromoteReference(currentWorkspace, worktree);
      if (action === "reference" && worktree) openConvertToReference(currentWorkspace, worktree);
      if (action === "remove") openRemoveMember(currentWorkspace, member);
    },
  });

  const connectionLabel =
    connectionState === "failed"
      ? t("connection.failed")
      : connectionState === "reconnecting"
        ? t("connection.reconnecting")
        : connectionState === "connecting"
          ? t("connection.connecting")
          : busyAction || t("connection.connected");

  return (
    <>
      <Layout className="h-full min-w-[980px] bg-[var(--ant-color-bg-layout)]">
        <WorkspaceSidebar
          filteredWorkspaces={filteredWorkspaces}
          selectedWorkspaceId={settingsSelected ? undefined : selectedWorkspaceId}
          settingsSelected={settingsSelected}
          workspaceQuery={workspaceQuery}
          workspaceRoot={state.config?.workspaceRoot ?? ""}
          onOpenCreate={() => {
            void navigate(
              selectedWorkspaceId
                ? routePaths.requirement(selectedWorkspaceId)
                : routePaths.requirements,
            );
            requirement.openCreate();
          }}
          onOpenSettings={() => void navigate(routePaths.settings)}
          onSelectWorkspace={(id) => {
            void navigate(routePaths.requirement(id));
          }}
          onWorkspaceQueryChange={setWorkspaceQuery}
        />

        <Layout className="min-h-0 min-w-0 bg-[var(--ant-color-bg-layout)]">
          <WorkspaceHeader
            connectionLabel={connectionLabel}
            connectionStatus={
              connectionState === "failed"
                ? "error"
                : connectionState === "connected" && !busyAction
                  ? "success"
                  : "processing"
            }
            contextLabel={settingsSelected ? t("settings.title") : currentWorkspace?.name}
            sectionLabel={settingsSelected ? t("header.system") : t("header.requirement")}
          />

          <Content
            aria-busy={busy}
            ref={contentRef}
            className="min-w-0 overflow-auto bg-[radial-gradient(circle_at_92%_0%,rgba(91,85,231,0.05),transparent_36%),linear-gradient(135deg,#f8faff_0%,var(--ant-color-bg-layout)_58%,#faf9ff_100%)]"
          >
            {connectionState === "failed" ? (
              <Alert
                description={fatalError}
                title={t("connection.unavailable")}
                showIcon
                type="error"
              />
            ) : connectionState !== "connected" && !currentWorkspace ? (
              <Flex align="center" className="min-h-[360px]" gap={16} justify="center" vertical>
                <Spin size="large" />
                <Text strong>
                  {connectionState === "reconnecting"
                    ? t("connection.reconnectMessage")
                    : t("connection.loadingRequirements")}
                </Text>
                {fatalError && <Text type="secondary">{fatalError}</Text>}
              </Flex>
            ) : (
              <DevtoolRoutes
                defaultWorkspaceId={state.workspaces[0]?.id}
                requirementExists={Boolean(currentWorkspace)}
                settings={
                  <SystemSettingsPage
                    config={state.config}
                    disabled={busy}
                    saving={busyAction === t("settings.saving")}
                    onRunDoctor={runDoctor}
                    onSave={saveConfig}
                  />
                }
                requirements={
                  !currentWorkspace ? (
                    <Flex align="center" className="min-h-[360px]" justify="center">
                      <Empty description={t("connection.emptyRequirements")} />
                    </Flex>
                  ) : (
                    <RequirementPage
                      summary={{
                        absolutePath: currentWorkspace.absolutePath,
                        busy,
                        developmentCount:
                          currentWorkspace.members.filter(isNonDefaultBranch).length,
                        memberCount: currentWorkspace.members.length,
                        name: currentWorkspace.name,
                        statusLabel: workspaceStatus
                          ? workspaceStatusFresh
                            ? t("workspace.checkedNow")
                            : t("workspace.cachedStatus")
                          : t("repository.notChecked"),
                        onClone: requirement.openClone,
                        onDelete: () => openDeleteWorkspace(currentWorkspace),
                      }}
                      repositories={{
                        busy,
                        branchSyncing: busyAction === t("feedback.batchSync"),
                        columns,
                        feedback,
                        filteredMembers,
                        members: currentWorkspace.members,
                        mode: repositoryMode,
                        query: repositoryQuery,
                        state: repositoryState,
                        status: workspaceStatus,
                        statusCounts: repositoryStatusCounts,
                        statusLoading,
                        onAddRepository: () => {
                          setAlias("");
                          setBranch("");
                          setShowAdd(true);
                          if (selectedRepositoryId)
                            void loadRepositoryBranchOptions(selectedRepositoryId, true);
                        },
                        onBatchSync: () => confirmWorkspaceBranchSync(currentWorkspace),
                        onCheckStatus: () => void refreshWorkspaceStatus(),
                        onCloseFeedback: () => setFeedback(undefined),
                        onCopyCommand: () => void copyCommand(currentWorkspace),
                        onModeChange: setRepositoryMode,
                        onOpenChatgpt: () =>
                          void repositoryOperations.openWorkspaceInChatgpt(currentWorkspace),
                        onQueryChange: setRepositoryQuery,
                        onStateChange: setRepositoryState,
                        onSyncWorkspace: () => void syncWorkspace(currentWorkspace),
                      }}
                    />
                  )
                }
              />
            )}
          </Content>
          <Footer className="grid min-h-10 grid-cols-[minmax(240px,1fr)_minmax(280px,1.3fr)] items-center gap-6 border-t border-[var(--ant-color-split)] !bg-white/90 !px-5 !py-2 backdrop-blur-sm">
            <Text ellipsis type="secondary">
              <DatabaseOutlined />{" "}
              {t("footer.persisted", {
                path: state.config?.workspaceRoot || t("common.notAvailable"),
              })}
            </Text>
            <Text ellipsis type="secondary">
              {settingsSelected ? (
                <>
                  <SettingOutlined /> {t("settings.title")}
                </>
              ) : (
                <>
                  <FolderOutlined />{" "}
                  {t("footer.currentRequirement", {
                    path: currentWorkspace?.absolutePath ?? t("common.notAvailable"),
                  })}
                </>
              )}
            </Text>
          </Footer>
        </Layout>
      </Layout>

      <RepositoryDetailDrawer
        busy={busy}
        codexTask={
          detailMember ? repositoryOperations.codexTasks[detailMember.repositoryId] : undefined
        }
        member={detailMember}
        status={detailMember ? statusFor(detailMember) : undefined}
        workspace={currentWorkspace}
        onClose={() => setDetailMember(undefined)}
        onOpenCodex={(workspace, member) =>
          void repositoryOperations.openInCodex(workspace, member)
        }
        onOpenVscode={(workspace, member) =>
          void repositoryOperations.openInVscode(workspace, member)
        }
      />

      <AddRepositoryDialog
        alias={alias}
        branch={branch}
        branches={repositoryBranchOptions[selectedRepositoryId] ?? []}
        branchLoading={branchLoadingIds.includes(selectedRepositoryId)}
        busy={busy}
        open={showAdd}
        repositories={availableRepositories}
        selectedRepositoryId={selectedRepositoryId}
        submitting={busyAction === t("feedback.addRepository")}
        onAliasChange={setAlias}
        onBranchChange={setBranch}
        onClose={() => setShowAdd(false)}
        onLoadBranches={() => {
          if (selectedRepositoryId) void loadRepositoryBranchOptions(selectedRepositoryId);
        }}
        onRepositoryChange={(repositoryId) => {
          setSelectedRepositoryId(repositoryId);
          setBranch("");
          void loadRepositoryBranchOptions(repositoryId, true);
        }}
        onSubmit={() => currentWorkspace && void addMember(currentWorkspace)}
      />

      <SwitchBranchDialog
        branch={promoteBranch}
        branches={promoteMember ? (repositoryBranchOptions[promoteMember.repositoryId] ?? []) : []}
        branchLoading={Boolean(
          promoteMember && branchLoadingIds.includes(promoteMember.repositoryId),
        )}
        busy={busy}
        error={promoteError}
        member={promoteMember}
        open={promoteOpen}
        submitting={busyAction === t("action.switchBranch") || busyAction === t("action.promote")}
        onBranchChange={setPromoteBranch}
        onClose={() => setPromoteOpen(false)}
        onLoadBranches={() => {
          if (promoteMember) void loadRepositoryBranchOptions(promoteMember.repositoryId);
        }}
        onSubmit={() => void submitPromoteReference()}
      />

      <RequirementDialog
        branchLoadingIds={branchLoadingIds}
        branchOptions={repositoryBranchOptions}
        busy={busy}
        canSubmit={requirement.canSubmit}
        developmentCount={requirement.developmentCount}
        error={requirement.error}
        mode={requirement.mode}
        open={requirement.open}
        referenceIds={requirement.referenceIds}
        repositories={requirement.filteredRepositories}
        repositoryBranches={requirement.repositoryBranches}
        repositoryQuery={requirement.repositoryQuery}
        selectedIds={requirement.selectedIds}
        sourceId={requirement.sourceId}
        submitting={busyAction === t("requirement.clone") || busyAction === t("requirement.create")}
        targetName={requirement.targetName}
        targetPath={requirement.targetPath}
        workspaces={state.workspaces}
        onBranchChange={requirement.setRepositoryBranch}
        onClose={requirement.close}
        onLoadBranches={(repositoryId) => void loadRepositoryBranchOptions(repositoryId)}
        onRepositoryQueryChange={requirement.setRepositoryQuery}
        onSourceChange={requirement.setSourceId}
        onSubmit={() => void submitClone()}
        onTargetNameChange={requirement.setTargetName}
        onToggleReference={requirement.toggleReference}
        onToggleRepository={requirement.toggleRepository}
      />

      <ConfirmActionDialog
        acknowledged={confirmAcknowledged}
        busy={Boolean(busyAction)}
        open={confirmOpen}
        state={confirmState}
        onAcknowledgedChange={setConfirmAcknowledged}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void confirmAction()}
      />
    </>
  );
}
