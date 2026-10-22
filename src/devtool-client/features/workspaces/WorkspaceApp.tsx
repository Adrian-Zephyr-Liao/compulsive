import { DatabaseOutlined, FolderOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, App as AntApp, Empty, Flex, Layout, Spin, Typography } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useMatch, useNavigate } from "react-router";

import { useI18n } from "../../app/i18n.js";
import { DevtoolRoutes, routePaths } from "../../app/routes.js";
import type { DevtoolState } from "../../../devtool.js";
import type { WorkspaceMember } from "../../../types.js";
import { SystemSettingsPage } from "../settings/SystemSettingsPage.js";
import { RequirementPage } from "./RequirementPage.js";
import { RepositoryDetailDrawer } from "./components/RepositoryDetailDrawer.js";
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
import type { WorkspaceFeedbackState } from "./types.js";
import { useWorkspaceActions } from "./hooks/useWorkspaceActions.js";
import { useMemberDialogs } from "./hooks/useMemberDialogs.js";
import {
  isNonDefaultBranch as selectIsNonDefaultBranch,
  filterWorkspaceMembers,
  countWorkspaceStatuses,
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
  const { message } = AntApp.useApp();
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
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<WorkspaceFeedbackState>();

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
  const availableRepositories = useMemo(() => {
    const memberIds = new Set(currentWorkspace?.members.map((member) => member.repositoryId));
    return state.repositories.filter((repository) => !memberIds.has(repository.id));
  }, [currentWorkspace, state.repositories]);
  const {
    saveConfig,
    runDoctor,
    runAction,
    copyCommand,
    syncWorkspace,
    confirmWorkspaceBranchSync,
    submitRequirement,
  } = useWorkspaceActions({
    busy,
    getRpc,
    refresh,
    refreshWorkspaceStatus,
    workspaceStatus,
    selectedWorkspaceIdRef,
    setBusyAction,
    setFeedback,
    setRepositoryState,
  });
  const memberDialogs = useMemberDialogs({
    busy,
    currentWorkspace,
    availableRepositories,
    getRpc,
    runAction,
    loadRepositoryBranchOptions,
    feedback,
  });
  const filteredWorkspaces = useMemo(() => {
    const query = workspaceQuery.trim().toLowerCase();
    return state.workspaces.filter((workspace) =>
      [workspace.name, workspace.absolutePath].some((value) => value.toLowerCase().includes(query)),
    );
  }, [state.workspaces, workspaceQuery]);
  const filteredMembers = useMemo(
    () =>
      filterWorkspaceMembers(currentWorkspace?.members ?? [], state.repositories, workspaceStatus, {
        query: repositoryQuery,
        mode: repositoryMode,
        state: repositoryState,
      }),
    [
      currentWorkspace,
      repositoryMode,
      repositoryQuery,
      repositoryState,
      state.repositories,
      workspaceStatus,
    ],
  );
  const repositoryStatusCounts = useMemo(
    () => countWorkspaceStatuses(currentWorkspace?.members ?? [], workspaceStatus),
    [currentWorkspace, workspaceStatus],
  );

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    memberDialogs.setShowAdd(false);
    memberDialogs.setAlias("");
    memberDialogs.setBranch("");
    setDetailMember(undefined);
    memberDialogs.setPromoteOpen(false);
    memberDialogs.setConfirmOpen(false);
  }, [selectedWorkspaceId, settingsSelected]);

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    if (
      !availableRepositories.some(
        (repository) => repository.id === memberDialogs.selectedRepositoryId,
      )
    ) {
      memberDialogs.setSelectedRepositoryId(availableRepositories[0]?.id ?? "");
    }
  }, [availableRepositories, memberDialogs.selectedRepositoryId]);

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

  const repositoryOperations = useRepositoryOperations({
    getRpc,
    repositories: state.repositories,
    runAction,
    selectedWorkspaceIdRef,
    status: workspaceStatus,
    refreshStatus: refreshWorkspaceStatus,
  });

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
      if (action === "switch" && worktree)
        memberDialogs.openPromoteReference(currentWorkspace, worktree);
      if (action === "reference" && worktree)
        memberDialogs.openConvertToReference(currentWorkspace, worktree);
      if (action === "remove") memberDialogs.openRemoveMember(currentWorkspace, member);
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
                    getRpc={getRpc}
                    config={state.config}
                    disabled={busy}
                    saving={busyAction === t("settings.saving")}
                    onRunDoctor={runDoctor}
                    onWorktreeRemoved={refresh}
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
                        onDelete: () => memberDialogs.openDeleteWorkspace(currentWorkspace),
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
                          memberDialogs.setAlias("");
                          memberDialogs.setBranch("");
                          memberDialogs.setShowAdd(true);
                          if (memberDialogs.selectedRepositoryId)
                            void loadRepositoryBranchOptions(
                              memberDialogs.selectedRepositoryId,
                              true,
                            );
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
        alias={memberDialogs.alias}
        branch={memberDialogs.branch}
        branches={repositoryBranchOptions[memberDialogs.selectedRepositoryId] ?? []}
        branchLoading={branchLoadingIds.includes(memberDialogs.selectedRepositoryId)}
        busy={busy}
        open={memberDialogs.showAdd}
        repositories={availableRepositories}
        selectedRepositoryId={memberDialogs.selectedRepositoryId}
        submitting={busyAction === t("feedback.addRepository")}
        onAliasChange={memberDialogs.setAlias}
        onBranchChange={memberDialogs.setBranch}
        onClose={() => memberDialogs.setShowAdd(false)}
        onLoadBranches={() => {
          if (memberDialogs.selectedRepositoryId)
            void loadRepositoryBranchOptions(memberDialogs.selectedRepositoryId);
        }}
        onRepositoryChange={(repositoryId) => {
          memberDialogs.setSelectedRepositoryId(repositoryId);
          memberDialogs.setBranch("");
          void loadRepositoryBranchOptions(repositoryId, true);
        }}
        onSubmit={() => currentWorkspace && void memberDialogs.addMember(currentWorkspace)}
      />

      <SwitchBranchDialog
        branch={memberDialogs.promoteBranch}
        branches={
          memberDialogs.promoteMember
            ? (repositoryBranchOptions[memberDialogs.promoteMember.repositoryId] ?? [])
            : []
        }
        branchLoading={Boolean(
          memberDialogs.promoteMember &&
          branchLoadingIds.includes(memberDialogs.promoteMember.repositoryId),
        )}
        busy={busy}
        error={memberDialogs.promoteError}
        member={memberDialogs.promoteMember}
        open={memberDialogs.promoteOpen}
        submitting={busyAction === t("action.switchBranch") || busyAction === t("action.promote")}
        onBranchChange={memberDialogs.setPromoteBranch}
        onClose={() => memberDialogs.setPromoteOpen(false)}
        onLoadBranches={() => {
          if (memberDialogs.promoteMember)
            void loadRepositoryBranchOptions(memberDialogs.promoteMember.repositoryId);
        }}
        onSubmit={() => void memberDialogs.submitPromoteReference()}
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
        onSubmit={() => void submitRequirement(requirement)}
        onTargetNameChange={requirement.setTargetName}
        onToggleReference={requirement.toggleReference}
        onToggleRepository={requirement.toggleRepository}
      />

      <ConfirmActionDialog
        acknowledged={memberDialogs.confirmAcknowledged}
        busy={Boolean(busyAction)}
        open={memberDialogs.confirmOpen}
        state={memberDialogs.confirmState}
        onAcknowledgedChange={memberDialogs.setConfirmAcknowledged}
        onClose={() => memberDialogs.setConfirmOpen(false)}
        onConfirm={() => void memberDialogs.confirmAction()}
      />
    </>
  );
}
