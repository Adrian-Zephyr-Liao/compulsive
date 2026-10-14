import {
  BookOutlined,
  BranchesOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  CopyOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  ExclamationCircleFilled,
  FolderAddOutlined,
  FolderOutlined,
  LoadingOutlined,
  MessageOutlined,
  MergeOutlined,
  PlusOutlined,
  SearchOutlined,
  SyncOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  ConfigProvider,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ButtonProps, TableProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  connectDevframe,
  DevframeConnectionError,
  type DevframeRpcClient,
  type DevframeScopedClientRpc,
} from "devframe/client";

import type { DevtoolState, DevtoolWorkspace } from "../devtool.js";
import type {
  RepositoryRecord,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceStatusResult,
} from "../types.js";

type ConnectionState = "connecting" | "connected" | "reconnecting" | "failed";
type WorkspaceRpc = DevframeScopedClientRpc<"compulsive">;
type WorktreeMember = Extract<WorkspaceMember, { mode: "worktree" }>;
type ConfirmState = {
  title: string;
  message: string;
  action: "delete-workspace" | "remove-member" | "convert-to-reference";
  workspace: DevtoolWorkspace;
  member?: WorkspaceMember;
  confirmLabel?: string;
  warning?: string;
};

const initialState: DevtoolState = {
  config: { schemaVersion: 1, rootDir: "", workspaceRoot: "", scanRoots: [] },
  repositories: [],
  workspaces: [],
  workspaceStatuses: [],
};

function IconButton({ label, ...props }: ButtonProps & { label: string }) {
  return (
    <Tooltip title={label} placement="top">
      <Button {...props} aria-label={label} shape="circle" type="text" />
    </Tooltip>
  );
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    return `${code}${error.message}`;
  }
  return String(error);
}

function WorkspaceApp() {
  const [state, setState] = useState(initialState);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedRepositoryId, setSelectedRepositoryId] = useState("");
  const [alias, setAlias] = useState("");
  const [branch, setBranch] = useState("");
  const [createBranch, setCreateBranch] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [fatalError, setFatalError] = useState("");
  const [feedback, setFeedback] = useState<{
    title: string;
    message: string;
    error: boolean;
  }>();

  const [cloneOpen, setCloneOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState("");
  const [cloneTargetName, setCloneTargetName] = useState("");
  const [cloneBranchName, setCloneBranchName] = useState("");
  const [cloneBranchCustomized, setCloneBranchCustomized] = useState(false);
  const [cloneRepositoryQuery, setCloneRepositoryQuery] = useState("");
  const [cloneSelectedIds, setCloneSelectedIds] = useState<string[]>([]);
  const [cloneReferenceIds, setCloneReferenceIds] = useState<string[]>([]);
  const [cloneError, setCloneError] = useState("");
  const [workspaceStatuses, setWorkspaceStatuses] = useState<Record<string, WorkspaceStatusResult>>(
    {},
  );
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusResult>();
  const [workspaceStatusFresh, setWorkspaceStatusFresh] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [promoteMember, setPromoteMember] = useState<WorktreeMember>();
  const [promoteBranch, setPromoteBranch] = useState("");
  const [promoteError, setPromoteError] = useState("");
  const [confirmState, setConfirmState] = useState<ConfirmState>();

  const selectedWorkspaceIdRef = useRef<string | undefined>(undefined);
  const rpcPromiseRef = useRef<Promise<WorkspaceRpc> | null>(null);
  const statusRequestIdRef = useRef(0);
  const statusWorkspaceIdRef = useRef<string | undefined>(undefined);

  const busy = Boolean(busyAction) || connectionState !== "connected";
  const currentWorkspace = useMemo(
    () => state.workspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, state.workspaces],
  );
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
  const cloneSource = useMemo(
    () => state.workspaces.find((workspace) => workspace.id === cloneSourceId),
    [cloneSourceId, state.workspaces],
  );
  const cloneSourceMembers = useMemo(
    () =>
      (cloneSource?.members ?? []).map((member) => ({
        member,
        repository: state.repositories.find((repository) => repository.id === member.repositoryId),
      })),
    [cloneSource, state.repositories],
  );
  const filteredCloneMembers = useMemo(() => {
    const query = cloneRepositoryQuery.trim().toLowerCase();
    return cloneSourceMembers.filter(({ member, repository }) =>
      [member.alias, repository?.classificationPath ?? ""].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }, [cloneRepositoryQuery, cloneSourceMembers]);
  const cloneTargetPath = useMemo(() => {
    const name = cloneTargetName.trim();
    const workspaceRoot = state.config?.workspaceRoot ?? "";
    return name ? `${workspaceRoot.replace(/\/$/, "")}/${name}` : workspaceRoot;
  }, [cloneTargetName, state.config?.workspaceRoot]);
  const cloneDevelopmentCount = cloneSelectedIds.filter(
    (repositoryId) => !cloneReferenceIds.includes(repositoryId),
  ).length;
  const cloneCanSubmit = Boolean(
    cloneTargetName.trim() &&
    cloneSelectedIds.length > 0 &&
    (cloneDevelopmentCount === 0 || cloneBranchName.trim()) &&
    !busy,
  );

  const applyState = useCallback((nextState: DevtoolState, preferredWorkspaceId?: string) => {
    const preferred = preferredWorkspaceId ?? selectedWorkspaceIdRef.current;
    const nextSelectedId = nextState.workspaces.some((workspace) => workspace.id === preferred)
      ? preferred
      : nextState.workspaces[0]?.id;
    setState(nextState);
    setWorkspaceStatuses(
      Object.fromEntries(nextState.workspaceStatuses.map((status) => [status.workspaceId, status])),
    );
    selectedWorkspaceIdRef.current = nextSelectedId;
    setSelectedWorkspaceId(nextSelectedId);
  }, []);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
    setShowAdd(false);
    setAlias("");
    setBranch("");
    setCreateBranch(true);
    setWorkspaceStatus(selectedWorkspaceId ? workspaceStatuses[selectedWorkspaceId] : undefined);
    setWorkspaceStatusFresh(false);
  }, [selectedWorkspaceId]);

  useEffect(() => {
    if (!availableRepositories.some((repository) => repository.id === selectedRepositoryId)) {
      setSelectedRepositoryId(availableRepositories[0]?.id ?? "");
    }
  }, [availableRepositories, selectedRepositoryId]);

  useEffect(() => {
    setCloneRepositoryQuery("");
    setCloneSelectedIds(cloneSource?.members.map((member) => member.repositoryId) ?? []);
    setCloneReferenceIds([]);
  }, [cloneSourceId]);

  useEffect(() => {
    if (!cloneBranchCustomized) {
      setCloneBranchName(cloneTargetName.trim() ? `workspace/${cloneTargetName.trim()}` : "");
    }
  }, [cloneBranchCustomized, cloneTargetName]);

  useEffect(() => {
    if (!branch.trim()) setCreateBranch(true);
  }, [branch]);

  useEffect(() => {
    let activeClient: DevframeRpcClient | undefined;
    let stopConnectionStatus: (() => void) | undefined;
    let reconnectPromise: Promise<WorkspaceRpc> | undefined;
    let reconnectTimer: number | undefined;
    let wakeReconnectDelay: (() => void) | undefined;
    let reconnectAttempt = 0;
    let disposed = false;

    async function waitForReconnectHost(): Promise<void> {
      const url =
        activeClient?.connection.metaBaseUrl ?? new URL("./__connection.json", document.baseURI);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Devframe connection check failed: ${response.status}`);
    }

    async function loadState(rpc: WorkspaceRpc, reconnecting: boolean): Promise<DevtoolState> {
      const request = rpc.call("get-state");
      if (!reconnecting) return request;
      let timer: number | undefined;
      try {
        return await Promise.race([
          request,
          new Promise<never>((_, reject) => {
            timer = window.setTimeout(
              () => reject(new Error("Devframe reconnect timed out.")),
              5_000,
            );
          }),
        ]);
      } finally {
        if (timer !== undefined) window.clearTimeout(timer);
      }
    }

    async function connectRpc(reconnecting = false): Promise<WorkspaceRpc> {
      setConnectionState(reconnecting ? "reconnecting" : "connecting");
      let client: DevframeRpcClient | undefined;
      try {
        if (reconnecting) await waitForReconnectHost();
        client = await connectDevframe();
        const connectedClient = client;
        const previousClient = activeClient;
        stopConnectionStatus?.();
        activeClient = connectedClient;
        stopConnectionStatus = connectedClient.events.on("connection:status", (status) => {
          if (connectedClient !== activeClient) return;
          if (status === "unauthorized") {
            setConnectionState("failed");
            setFatalError(
              describeError(connectedClient.connectionError ?? "Devframe authorization failed."),
            );
          } else if (status === "disconnected" || status === "error") {
            void reconnect(connectedClient.connectionError ?? "Devframe connection closed.").catch(
              () => undefined,
            );
          }
        });
        previousClient?.close?.();
        const rpc = connectedClient.scope("compulsive").rpc;
        applyState(await loadState(rpc, reconnecting));
        if (connectedClient !== activeClient) throw new Error("Devframe connection was replaced.");
        reconnectAttempt = 0;
        setFatalError("");
        setConnectionState("connected");
        return rpc;
      } catch (error) {
        if (client && client === activeClient) {
          stopConnectionStatus?.();
          stopConnectionStatus = undefined;
          activeClient = undefined;
          client.close?.();
        }
        setFatalError(describeError(error));
        if (error instanceof DevframeConnectionError && error.kind === "auth") {
          setConnectionState("failed");
        }
        throw error;
      }
    }

    function reconnect(error: unknown): Promise<WorkspaceRpc> {
      if (error instanceof DevframeConnectionError && error.kind === "auth") {
        setConnectionState("failed");
        setFatalError(describeError(error));
        return Promise.reject(error);
      }
      if (reconnectPromise) return reconnectPromise;
      setConnectionState("reconnecting");
      setFatalError(describeError(error));
      const promise = (async () => {
        while (!disposed) {
          const delay = Math.min(500 * 2 ** reconnectAttempt, 5_000);
          reconnectAttempt += 1;
          await new Promise<void>((resolve) => {
            wakeReconnectDelay = resolve;
            reconnectTimer = window.setTimeout(resolve, delay);
          });
          reconnectTimer = undefined;
          wakeReconnectDelay = undefined;
          if (disposed) break;
          try {
            return await connectRpc(true);
          } catch (connectionError) {
            if (
              connectionError instanceof DevframeConnectionError &&
              connectionError.kind === "auth"
            ) {
              throw connectionError;
            }
            setFatalError(describeError(connectionError));
          }
        }
        throw new Error("Devframe connection closed.");
      })();
      reconnectPromise = promise;
      rpcPromiseRef.current = promise;
      void promise
        .finally(() => {
          if (reconnectPromise === promise) reconnectPromise = undefined;
        })
        .catch(() => undefined);
      return promise;
    }

    const initialPromise = connectRpc().catch((error) => reconnect(error));
    rpcPromiseRef.current = initialPromise;
    void initialPromise.catch((error) => {
      if (!disposed) {
        setConnectionState("failed");
        setFatalError(describeError(error));
      }
    });

    return () => {
      disposed = true;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      wakeReconnectDelay?.();
      stopConnectionStatus?.();
      activeClient?.close?.();
    };
  }, [applyState]);

  async function getRpc(): Promise<WorkspaceRpc> {
    if (!rpcPromiseRef.current) throw new Error("Devframe connection has not started.");
    return rpcPromiseRef.current;
  }

  function repositoryFor(member: WorkspaceMember): RepositoryRecord | undefined {
    return state.repositories.find((repository) => repository.id === member.repositoryId);
  }

  function statusFor(member: WorkspaceMember): WorkspaceMemberStatus | undefined {
    return workspaceStatus?.members.find((status) => status.repositoryId === member.repositoryId);
  }

  function isTaskComplete(member: WorkspaceMember): boolean {
    const status = statusFor(member);
    return Boolean(
      status?.mergedIntoDefault &&
      !status.unpushed &&
      !status.changes.length &&
      !status.conflicts.length,
    );
  }

  function isNonDefaultBranch(member: WorkspaceMember): boolean {
    if (member.mode !== "worktree" || member.detached) return false;
    const status = statusFor(member);
    const activeBranch = status?.branch ?? member.branch;
    const defaultBranch = status?.defaultBranch?.replace(/^origin\//, "");
    return defaultBranch
      ? activeBranch !== defaultBranch
      : activeBranch !== "main" && activeBranch !== "master";
  }

  function storeWorkspaceStatus(status: WorkspaceStatusResult): void {
    setWorkspaceStatuses((current) => ({ ...current, [status.workspaceId]: status }));
    setWorkspaceStatus(status);
    setWorkspaceStatusFresh(true);
  }

  async function refresh(preferredWorkspaceId = selectedWorkspaceId): Promise<void> {
    const rpc = await getRpc();
    applyState(await rpc.call("get-state"), preferredWorkspaceId);
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
      setFeedback({ title: success, message: "操作已安全完成。", error: false });
      return true;
    } catch (error) {
      if (refreshStatus && checkedWorkspaceId === selectedWorkspaceIdRef.current) {
        await refreshWorkspaceStatus(false);
      }
      setFeedback({ title: `${name}失败`, message: describeError(error), error: true });
      return false;
    } finally {
      setBusyAction("");
    }
  }

  async function createWorkspace(event: FormEvent): Promise<void> {
    event.preventDefault();
    const name = newWorkspaceName.trim();
    if (!name) return;
    const rpc = await getRpc();
    let createdId: string | undefined;
    const succeeded = await runAction(
      "创建 Workspace",
      async () => {
        createdId = (await rpc.call("create-workspace", { name })).id;
      },
      `已创建 ${name}`,
    );
    if (succeeded) {
      await refresh(createdId);
      setNewWorkspaceName("");
      setShowCreate(false);
    }
  }

  async function copyCommand(workspace: DevtoolWorkspace): Promise<void> {
    try {
      await navigator.clipboard.writeText(workspace.cdCommand);
      setFeedback({ title: "已复制 cd 命令", message: workspace.cdCommand, error: false });
    } catch (error) {
      setFeedback({ title: "复制失败", message: describeError(error), error: true });
    }
  }

  async function syncWorkspace(workspace: DevtoolWorkspace): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      "同步 Workspace",
      () => rpc.call("sync-workspace", { workspaceId: workspace.id }),
      "Workspace 已同步",
      workspace.id,
    );
  }

  async function refreshWorkspaceStatus(fetchRemote = true): Promise<void> {
    const workspaceId = selectedWorkspaceIdRef.current;
    if (!workspaceId || (statusLoading && statusWorkspaceIdRef.current === workspaceId)) return;
    const requestId = ++statusRequestIdRef.current;
    statusWorkspaceIdRef.current = workspaceId;
    setStatusLoading(true);
    try {
      const rpc = await getRpc();
      const result = await rpc.call("get-workspace-status", { workspaceId, fetchRemote });
      if (
        requestId === statusRequestIdRef.current &&
        selectedWorkspaceIdRef.current === workspaceId
      ) {
        storeWorkspaceStatus(result);
      }
    } catch (error) {
      if (requestId === statusRequestIdRef.current) {
        setFeedback({ title: "状态刷新失败", message: describeError(error), error: true });
      }
    } finally {
      if (requestId === statusRequestIdRef.current) setStatusLoading(false);
    }
  }

  async function openMemberInVscode(
    workspace: DevtoolWorkspace,
    member: WorkspaceMember,
  ): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      "打开 VS Code",
      () =>
        rpc.call("open-workspace-member-in-vscode", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
        }),
      `已在 VS Code 中打开 ${member.alias}`,
      workspace.id,
      false,
    );
  }

  function openPromoteReference(workspace: DevtoolWorkspace, member: WorktreeMember): void {
    setPromoteMember(member);
    setPromoteBranch(
      member.detached ? `workspace/${workspace.name}/${member.alias}` : member.branch,
    );
    setPromoteError("");
    setPromoteOpen(true);
  }

  async function submitPromoteReference(event: FormEvent): Promise<void> {
    event.preventDefault();
    const workspace = currentWorkspace;
    const member = promoteMember;
    const nextBranch = promoteBranch.trim();
    if (!workspace || !member || !nextBranch || busy) return;
    const rpc = await getRpc();
    setPromoteError("");
    const succeeded = await runAction(
      member.detached ? "转为开发分支" : "切换开发分支",
      () =>
        rpc.call("switch-workspace-member-branch", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
          branch: nextBranch,
        }),
      member.detached ? `已将 ${member.alias} 转为开发分支` : `已切换 ${member.alias} 的分支`,
      workspace.id,
    );
    if (succeeded) setPromoteOpen(false);
    else setPromoteError(feedback?.message ?? "转换失败");
  }

  function canRebase(member: WorkspaceMember): boolean {
    const status = statusFor(member);
    return Boolean(
      workspaceStatusFresh &&
      member.mode === "worktree" &&
      status &&
      !status.comparisonError &&
      !isTaskComplete(member) &&
      status.behind &&
      !status.changes.length &&
      !status.conflicts.length,
    );
  }

  function canPush(member: WorkspaceMember): boolean {
    const status = statusFor(member);
    return Boolean(
      workspaceStatusFresh &&
      member.mode === "worktree" &&
      !member.detached &&
      status?.unpushed &&
      !status.changes.length &&
      !status.conflicts.length,
    );
  }

  async function rebaseMember(workspace: DevtoolWorkspace, member: WorkspaceMember): Promise<void> {
    const rpc = await getRpc();
    const reference = member.mode === "worktree" && member.detached;
    await runAction(
      reference ? "更新参考代码" : "Rebase 主分支",
      () =>
        rpc.call("rebase-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
        }),
      reference ? `已拉取 ${member.alias} 的最新主分支` : `已更新 ${member.alias}`,
      workspace.id,
    );
  }

  async function pushMember(workspace: DevtoolWorkspace, member: WorkspaceMember): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      "同步并 Push 分支",
      () =>
        rpc.call("push-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
        }),
      `已同步并推送 ${member.alias}`,
      workspace.id,
    );
  }

  async function openWorkspaceInChatgpt(workspace: DevtoolWorkspace): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      "打开 ChatGPT",
      () => rpc.call("open-workspace-in-chatgpt", { workspaceId: workspace.id }),
      "已在 ChatGPT 中打开",
      workspace.id,
      false,
    );
  }

  async function addMember(event: FormEvent, workspace: DevtoolWorkspace): Promise<void> {
    event.preventDefault();
    const repository = availableRepositories.find((item) => item.id === selectedRepositoryId);
    if (!repository) return;
    const rpc = await getRpc();
    const succeeded = await runAction(
      "添加仓库",
      () =>
        rpc.call("add-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: repository.id,
          ...(alias.trim() ? { alias: alias.trim() } : {}),
          ...(branch.trim() ? { branch: branch.trim() } : {}),
          createBranch,
        }),
      `已添加 ${repository.name}`,
      workspace.id,
    );
    if (succeeded) setShowAdd(false);
  }

  function openClone(): void {
    const source = currentWorkspace ?? state.workspaces[0];
    setCloneSourceId(source?.id ?? "");
    setCloneTargetName("");
    setCloneBranchName("");
    setCloneBranchCustomized(false);
    setCloneError("");
    setCloneRepositoryQuery("");
    setCloneSelectedIds(source?.members.map((member) => member.repositoryId) ?? []);
    setCloneReferenceIds([]);
    setCloneOpen(true);
  }

  function toggleCloneRepository(id: string): void {
    if (cloneSelectedIds.includes(id)) {
      setCloneSelectedIds((current) => current.filter((selected) => selected !== id));
      setCloneReferenceIds((current) => current.filter((reference) => reference !== id));
    } else setCloneSelectedIds((current) => [...current, id]);
  }

  function toggleAllCloneRepositories(): void {
    const allIds = cloneSourceMembers.map(({ member }) => member.repositoryId);
    if (cloneSelectedIds.length === allIds.length) {
      setCloneSelectedIds([]);
      setCloneReferenceIds([]);
    } else setCloneSelectedIds(allIds);
  }

  function toggleCloneReference(id: string): void {
    setCloneReferenceIds((current) =>
      current.includes(id) ? current.filter((reference) => reference !== id) : [...current, id],
    );
  }

  async function submitClone(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!cloneCanSubmit) return;
    const rpc = await getRpc();
    setCloneError("");
    setBusyAction("克隆 Workspace");
    try {
      const workspace = await rpc.call("clone-workspace", {
        sourceWorkspaceId: cloneSourceId,
        name: cloneTargetName.trim(),
        repositoryIds: cloneSelectedIds,
        ...(cloneDevelopmentCount > 0 ? { branchName: cloneBranchName.trim() } : {}),
        referenceRepositoryIds: cloneReferenceIds,
      });
      await refresh(workspace.id);
      setFeedback({
        title: "Workspace 克隆完成",
        message: `已创建 ${cloneDevelopmentCount} 个开发分支和 ${cloneReferenceIds.length} 个参考 worktree。`,
        error: false,
      });
      setCloneOpen(false);
    } catch (error) {
      const message = describeError(error);
      setCloneError(message);
      setFeedback({ title: "克隆失败", message, error: true });
    } finally {
      setBusyAction("");
    }
  }

  function openDeleteWorkspace(workspace: DevtoolWorkspace): void {
    setConfirmState({
      title: `删除 ${workspace.name}？`,
      message:
        "将删除 Workspace、其干净的 worktree，以及磁盘上的整个 Workspace 目录。ChatGPT 暂无项目删除接口，如已添加需在应用中手动移除。",
      warning: "目录内所有文件都会永久删除；未提交的 worktree 改动会阻止删除。",
      confirmLabel: "永久删除",
      action: "delete-workspace",
      workspace,
    });
    setConfirmOpen(true);
  }

  function openRemoveMember(workspace: DevtoolWorkspace, member: WorkspaceMember): void {
    setConfirmState({
      title: `移除 ${member.alias}？`,
      message: `将从 ${workspace.name} 移除该成员；未提交的改动会阻止操作。`,
      action: "remove-member",
      workspace,
      member,
    });
    setConfirmOpen(true);
  }

  function openConvertToReference(workspace: DevtoolWorkspace, member: WorktreeMember): void {
    setConfirmState({
      title: `将 ${member.alias} 转为参考？`,
      message: `worktree 将切换到最新远端主分支的 detached HEAD；本地分支 ${member.branch} 会保留。`,
      warning: "存在未提交改动时会阻止转换，不会强制覆盖文件。",
      confirmLabel: "转为参考",
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
        "删除 Workspace",
        () => rpc.call("delete-workspace", { workspaceId: pending.workspace.id }),
        `已删除 ${pending.workspace.name}`,
      );
      return;
    }
    if (pending.action === "convert-to-reference") {
      await runAction(
        "转为参考",
        () =>
          rpc.call("convert-workspace-to-reference", {
            workspaceId: pending.workspace.id,
            repositoryId: pending.member!.repositoryId,
          }),
        `已将 ${pending.member!.alias} 转为参考`,
        pending.workspace.id,
      );
      return;
    }
    await runAction(
      "移除仓库",
      () =>
        rpc.call("remove-workspace-member", {
          workspaceId: pending.workspace.id,
          repositoryId: pending.member!.repositoryId,
        }),
      `已移除 ${pending.member!.alias}`,
      pending.workspace.id,
    );
  }

  function renderHealth(member: WorkspaceMember) {
    const status = statusFor(member);
    if (!status) return <Tag>点击检查</Tag>;
    if (status.conflicts.length) return <Tag color="error">{status.conflicts.length} 个冲突</Tag>;
    if (status.comparisonError) {
      return (
        <Tooltip title={status.comparisonError}>
          <Tag color="warning" icon={<WarningOutlined />}>
            无法比较
          </Tag>
        </Tooltip>
      );
    }
    return (
      <Space size={[4, 6]} wrap>
        {status.mergedIntoDefault && (
          <Tooltip title="远端开发分支的最新提交已包含在主分支中">
            <Tag color="success" icon={<CheckCircleFilled />}>
              {isTaskComplete(member) ? "已合入主分支 · 可开启新 Workspace" : "远端已合入"}
            </Tag>
          </Tooltip>
        )}
        {Boolean(status.behind) && (
          <Tag color="gold">
            ↓ {status.behind} 落后 {status.defaultBranch}
          </Tag>
        )}
        {Boolean(status.ahead) && (
          <Tag color="green">
            ↑ {status.ahead} 领先 {status.defaultBranch}
          </Tag>
        )}
        {Boolean(status.unpushed) && (
          <Tag color="blue" icon={<CloudUploadOutlined />}>
            {status.unpushed} 未推送
          </Tag>
        )}
        {!status.ahead && !status.behind && (
          <Tag color="success" icon={<CheckOutlined />}>
            已同步 {status.defaultBranch}
          </Tag>
        )}
        <Tag color={status.changes.length ? "warning" : "default"}>
          {status.changes.length ? `${status.changes.length} 项未提交` : "工作区干净"}
        </Tag>
      </Space>
    );
  }

  const columns: TableProps<WorkspaceMember>["columns"] = [
    {
      title: "仓库",
      key: "repository",
      width: 270,
      render: (_, member) => (
        <div className="flex min-w-0 items-start gap-3">
          <BranchesOutlined className="mt-0.5 shrink-0 text-xl text-[#28785e]" />
          <span className="grid min-w-0 gap-1">
            <strong className="truncate text-[14px] text-[#202723]">{member.alias}</strong>
            <span className="truncate text-xs text-[#7a847e]">
              {repositoryFor(member)?.classificationPath ?? member.repositoryId}
            </span>
          </span>
        </div>
      ),
    },
    {
      title: "分支",
      key: "branch",
      width: 230,
      render: (_, member) => {
        const nonDefault = isNonDefaultBranch(member);
        const activeBranch =
          statusFor(member)?.branch ??
          (member.mode === "worktree"
            ? member.detached
              ? `参考 · ${member.branch}`
              : member.branch
            : "—");
        return (
          <div className="flex flex-wrap items-center gap-2">
            <code className={nonDefault ? "font-semibold text-[#28785e]" : "text-[#36413b]"}>
              {activeBranch}
            </code>
            {nonDefault && <Tag color="green">非主分支</Tag>}
          </div>
        );
      },
    },
    {
      title: "本地状态",
      key: "status",
      width: 360,
      render: (_, member) => renderHealth(member),
    },
    {
      title: "类型",
      key: "mode",
      width: 108,
      render: (_, member) => (
        <Tag bordered={false} className="font-mono">
          {member.mode === "worktree" && member.detached ? "reference" : member.mode}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 210,
      render: (_, member) => {
        if (!currentWorkspace) return null;
        const status = statusFor(member);
        const worktree = member.mode === "worktree" ? member : undefined;
        return (
          <Space className="repository-actions" size={2}>
            <IconButton
              danger={Boolean(status?.conflicts.length)}
              icon={status?.conflicts.length ? <ExclamationCircleFilled /> : <CodeOutlined />}
              label={status?.conflicts.length ? "在 VS Code 中解决冲突" : "在 VS Code 中打开"}
              onClick={() => void openMemberInVscode(currentWorkspace, member)}
            />
            {canRebase(member) && (
              <IconButton
                disabled={busy}
                icon={
                  member.mode === "worktree" && member.detached ? (
                    <CloudDownloadOutlined />
                  ) : (
                    <MergeOutlined />
                  )
                }
                label={
                  member.mode === "worktree" && member.detached
                    ? "拉取最新主分支"
                    : "Rebase 远端主分支"
                }
                onClick={() => void rebaseMember(currentWorkspace, member)}
              />
            )}
            {canPush(member) && (
              <IconButton
                disabled={busy}
                icon={<CloudUploadOutlined />}
                label="Rebase 同名远端分支并 Push"
                onClick={() => void pushMember(currentWorkspace, member)}
              />
            )}
            {worktree && (
              <IconButton
                icon={<BranchesOutlined />}
                label={worktree.detached ? "转为开发分支" : "切换开发分支"}
                onClick={() => openPromoteReference(currentWorkspace, worktree)}
              />
            )}
            {worktree && !worktree.detached && (
              <IconButton
                icon={<BookOutlined />}
                label="转为参考"
                onClick={() => openConvertToReference(currentWorkspace, worktree)}
              />
            )}
            <IconButton
              icon={<CloseOutlined />}
              label="移出 Workspace"
              onClick={() => openRemoveMember(currentWorkspace, member)}
            />
          </Space>
        );
      },
    },
  ];

  const connectionLabel =
    connectionState === "failed"
      ? "连接失败"
      : connectionState === "reconnecting"
        ? "正在重连"
        : connectionState === "connecting"
          ? "正在连接"
          : busyAction || "已连接";

  return (
    <div className="grid h-full min-w-[320px] grid-rows-[64px_minmax(0,1fr)_34px] bg-[#f7f8f7] text-[#202723]">
      <header className="flex items-center justify-between border-b border-[#dce2de] bg-white/85 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-3 text-sm text-[#7f8883]">
          <BranchesOutlined className="text-[26px] text-[#28785e]" />
          <strong className="text-xl tracking-[-0.03em] text-[#19201c]">Compulsive</strong>
          <span className="h-6 w-px bg-[#ccd3cf]" />
          <span>Workspace DevTool</span>
        </div>
        <div
          aria-live="polite"
          className={`flex min-h-9 items-center gap-2 text-[13px] ${
            connectionState === "failed" ? "text-red-600" : "text-[#59635d]"
          }`}
          role="status"
        >
          {connectionState !== "connected" || busyAction ? (
            <Spin indicator={<LoadingOutlined spin />} size="small" />
          ) : (
            <span className="h-2.5 w-2.5 rounded-full bg-[#28785e]" />
          )}
          {connectionLabel}
        </div>
      </header>

      <main
        aria-busy={busy}
        className="grid min-h-0 grid-cols-[290px_minmax(0,1fr)] max-[900px]:grid-cols-[240px_minmax(0,1fr)]"
      >
        <aside
          aria-label="Workspace 索引"
          className="flex min-h-0 flex-col overflow-auto border-r border-[#dce2de] bg-[#f2f5f3] p-[22px_16px_16px]"
        >
          <div className="flex items-center justify-between px-1 pb-3">
            <h1 className="text-lg font-semibold tracking-[-0.02em]">Workspace</h1>
            <IconButton
              icon={<PlusOutlined />}
              label="新建 Workspace"
              onClick={() => setShowCreate((value) => !value)}
            />
          </div>
          {showCreate && (
            <form
              className="mb-2 grid grid-cols-[minmax(0,1fr)_auto] gap-2"
              onSubmit={createWorkspace}
            >
              <Input
                aria-label="Workspace 名称"
                id="new-workspace-name"
                name="workspaceName"
                placeholder="Workspace 名称"
                prefix={<FolderAddOutlined />}
                value={newWorkspaceName}
                onChange={(event) => setNewWorkspaceName(event.target.value)}
              />
              <Button disabled={busy} htmlType="submit" type="primary">
                创建
              </Button>
            </form>
          )}
          <Input
            allowClear
            aria-label="搜索 Workspace"
            id="workspace-search"
            name="workspaceSearch"
            placeholder="搜索 Workspace"
            prefix={<SearchOutlined />}
            value={workspaceQuery}
            onChange={(event) => setWorkspaceQuery(event.target.value)}
          />
          <nav aria-label="Workspace" className="mt-3 grid gap-1">
            {filteredWorkspaces.map((workspace) => {
              const selected = workspace.id === selectedWorkspaceId;
              return (
                <button
                  aria-current={selected ? "page" : undefined}
                  className={`group relative flex min-h-[68px] w-full items-center gap-3 rounded-lg border-0 px-3 text-left transition-colors ${
                    selected ? "bg-[#e2ebe6]" : "bg-transparent hover:bg-[#e9eeeb]"
                  }`}
                  key={workspace.id}
                  type="button"
                  onClick={() => {
                    selectedWorkspaceIdRef.current = workspace.id;
                    setSelectedWorkspaceId(workspace.id);
                  }}
                >
                  <span
                    className={`absolute inset-y-2 left-0 w-[3px] rounded-r ${selected ? "bg-[#28785e]" : "bg-transparent"}`}
                  />
                  <FolderOutlined
                    className={`text-xl ${selected ? "text-[#28785e]" : "text-[#465149]"}`}
                  />
                  <span className="grid min-w-0 gap-1">
                    <strong className="truncate text-sm">{workspace.name}</strong>
                    <span className="text-xs text-[#737d77]">
                      {workspace.members.length} 名成员
                    </span>
                  </span>
                </button>
              );
            })}
            {!filteredWorkspaces.length && (
              <Empty
                className="my-8"
                description="没有匹配项"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </nav>
          <div className="mt-auto flex gap-3 border-t border-[#dce2de] px-1 pt-4 text-[#535e57]">
            <DatabaseOutlined className="mt-0.5 text-lg" />
            <span className="grid min-w-0 gap-1">
              <small className="text-[#737d77]">本地根目录</small>
              <code className="truncate text-[10px]">{state.config?.workspaceRoot || "—"}</code>
            </span>
          </div>
        </aside>

        <section className="min-w-0 overflow-auto p-7 pb-12 max-[900px]:p-5">
          {connectionState === "failed" ? (
            <Alert description={fatalError} message="无法连接 Devframe" showIcon type="error" />
          ) : connectionState !== "connected" && !currentWorkspace ? (
            <div className="grid min-h-[360px] place-content-center justify-items-center gap-4 text-[#737d77]">
              <Spin size="large" />
              <strong>
                {connectionState === "reconnecting"
                  ? "正在重新连接 Devframe"
                  : "正在读取 Workspace"}
              </strong>
              {fatalError && <p className="max-w-lg text-center text-xs">{fatalError}</p>}
            </div>
          ) : !currentWorkspace ? (
            <div className="grid min-h-[360px] place-content-center">
              <Empty description="还没有 Workspace，使用左侧加号创建第一个 Workspace。" />
            </div>
          ) : (
            <>
              <div className="mb-6 flex flex-wrap items-start justify-between gap-5 px-0.5">
                <div className="min-w-0">
                  <p className="mb-3 text-[13px] text-[#737d77]">
                    工作空间 <span className="px-2">/</span> {currentWorkspace.name}
                  </p>
                  <h2 className="mb-2 text-[28px] font-semibold tracking-[-0.035em]">
                    {currentWorkspace.name}
                  </h2>
                  <code className="block truncate text-xs text-[#737d77]">
                    {currentWorkspace.absolutePath}
                  </code>
                </div>
                <Space size={8} wrap>
                  <Button
                    icon={<CopyOutlined />}
                    onClick={() => void copyCommand(currentWorkspace)}
                  >
                    复制路径
                  </Button>
                  <Button
                    disabled={busy}
                    icon={<SyncOutlined />}
                    onClick={() => void syncWorkspace(currentWorkspace)}
                  >
                    修复链接
                  </Button>
                  <Button
                    disabled={busy}
                    icon={<MessageOutlined />}
                    onClick={() => void openWorkspaceInChatgpt(currentWorkspace)}
                  >
                    在 ChatGPT 中打开
                  </Button>
                  <Button
                    disabled={!currentWorkspace.members.length || busy}
                    icon={<PlusOutlined />}
                    type="primary"
                    onClick={openClone}
                  >
                    克隆 Workspace
                  </Button>
                  <IconButton
                    danger
                    icon={<DeleteOutlined />}
                    label="删除 Workspace"
                    onClick={() => openDeleteWorkspace(currentWorkspace)}
                  />
                </Space>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)_250px] gap-5 max-[1260px]:grid-cols-1">
                <section className="min-w-0">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    仓库 <Tag bordered={false}>{currentWorkspace.members.length}</Tag>
                  </div>
                  <div className="overflow-hidden rounded-xl border border-[#dce2de] bg-white shadow-[0_8px_30px_rgba(26,38,31,0.04)]">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e6e3] px-5 py-4">
                      <h3 className="font-semibold">仓库</h3>
                      <Space size={8} wrap>
                        <span className="text-xs text-[#7a847e]">
                          {workspaceStatus
                            ? `${new Date(workspaceStatus.checkedAt).toLocaleTimeString()} ${
                                workspaceStatusFresh ? "已检查" : "缓存状态"
                              }`
                            : "尚未检查"}
                        </span>
                        <Button
                          disabled={statusLoading || busy}
                          icon={<SearchOutlined />}
                          loading={statusLoading}
                          onClick={() => void refreshWorkspaceStatus()}
                        >
                          检查状态
                        </Button>
                        <Button
                          icon={<PlusOutlined />}
                          onClick={() => setShowAdd((value) => !value)}
                        >
                          添加仓库
                        </Button>
                      </Space>
                    </div>

                    {showAdd && (
                      <form
                        className="grid grid-cols-[minmax(220px,1.5fr)_minmax(140px,0.8fr)_minmax(200px,1fr)_auto] items-end gap-3 border-b border-[#e1e6e3] bg-[#f8faf9] p-4 max-[1120px]:grid-cols-2"
                        onSubmit={(event) => void addMember(event, currentWorkspace)}
                      >
                        <label
                          className="grid gap-1.5 text-xs font-medium text-[#59635d]"
                          htmlFor="repository-select"
                        >
                          仓库
                          <Select<string>
                            showSearch
                            disabled={!availableRepositories.length}
                            id="repository-select"
                            optionFilterProp="label"
                            options={availableRepositories.map((repository) => ({
                              value: repository.id,
                              label: repository.classificationPath,
                            }))}
                            placeholder="搜索仓库"
                            {...(selectedRepositoryId ? { value: selectedRepositoryId } : {})}
                            onChange={(value) => setSelectedRepositoryId(value)}
                          />
                        </label>
                        <label
                          className="grid gap-1.5 text-xs font-medium text-[#59635d]"
                          htmlFor="repository-alias"
                        >
                          目录别名
                          <Input
                            id="repository-alias"
                            name="repositoryAlias"
                            placeholder="默认使用仓库名"
                            value={alias}
                            onChange={(event) => setAlias(event.target.value)}
                          />
                        </label>
                        <label
                          className="grid gap-1.5 text-xs font-medium text-[#59635d]"
                          htmlFor="repository-branch"
                        >
                          开发分支
                          <Input
                            id="repository-branch"
                            name="repositoryBranch"
                            placeholder="例如 feat/workspace-task"
                            prefix={<BranchesOutlined />}
                            value={branch}
                            onChange={(event) => setBranch(event.target.value)}
                          />
                        </label>
                        <Button
                          disabled={!selectedRepositoryId || !branch.trim() || busy}
                          htmlType="submit"
                          type="primary"
                        >
                          加入 Workspace
                        </Button>
                        <Checkbox
                          checked={createBranch}
                          className="col-span-full"
                          disabled={!branch.trim()}
                          name="createBranch"
                          onChange={(event) => setCreateBranch(event.target.checked)}
                        >
                          新建或跟踪远端同名分支；取消勾选则使用已有本地分支
                        </Checkbox>
                      </form>
                    )}

                    {currentWorkspace.members.length ? (
                      <Table<WorkspaceMember>
                        columns={columns}
                        dataSource={currentWorkspace.members}
                        pagination={false}
                        rowKey="repositoryId"
                        scroll={{ x: 1178 }}
                        size="middle"
                        expandable={{
                          expandedRowRender: (member) => (
                            <div className="grid gap-1 px-12 py-2">
                              <strong className="mb-1 text-xs text-[#59635d]">未提交变更</strong>
                              {statusFor(member)?.changes.map((change) => (
                                <code className="text-xs text-[#657069]" key={change}>
                                  {change}
                                </code>
                              ))}
                            </div>
                          ),
                          rowExpandable: (member) => Boolean(statusFor(member)?.changes.length),
                        }}
                      />
                    ) : (
                      <div className="grid min-h-[300px] place-content-center justify-items-center gap-3">
                        <Empty description="还没有仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                        <Button icon={<PlusOutlined />} onClick={() => setShowAdd(true)}>
                          添加仓库
                        </Button>
                      </div>
                    )}
                  </div>
                </section>

                <aside className="grid content-start gap-4">
                  <section className="rounded-xl border border-[#dce2de] bg-white p-5 shadow-[0_8px_30px_rgba(26,38,31,0.04)]">
                    <h3 className="mb-4 font-semibold">工作区信息</h3>
                    <dl className="grid gap-4 text-sm">
                      <div className="grid gap-1">
                        <dt className="text-xs text-[#7a847e]">路径</dt>
                        <dd className="m-0 min-w-0">
                          <code className="block truncate">{currentWorkspace.absolutePath}</code>
                        </dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-[#7a847e]">成员数量</dt>
                        <dd className="m-0">{currentWorkspace.members.length}</dd>
                      </div>
                      <div className="flex justify-between gap-4">
                        <dt className="text-[#7a847e]">类型</dt>
                        <dd className="m-0">worktree / link</dd>
                      </div>
                      <div className="grid gap-1">
                        <dt className="text-[#7a847e]">说明</dt>
                        <dd className="m-0">每个 worktree 保持独立分支</dd>
                      </div>
                    </dl>
                  </section>
                  <section className="rounded-xl border border-[#dce2de] bg-white p-5 shadow-[0_8px_30px_rgba(26,38,31,0.04)]">
                    <h3 className="mb-4 font-semibold">快捷操作</h3>
                    <Button
                      block
                      icon={<CodeOutlined />}
                      onClick={() => void copyCommand(currentWorkspace)}
                    >
                      复制 cd 命令
                    </Button>
                  </section>
                  {feedback && (
                    <Alert
                      closable
                      description={feedback.message}
                      message={feedback.title}
                      showIcon
                      type={feedback.error ? "error" : "success"}
                      onClose={() => setFeedback(undefined)}
                    />
                  )}
                </aside>
              </div>
            </>
          )}
        </section>
      </main>

      <footer className="flex items-center justify-between border-t border-[#dce2de] bg-[#eef2f0] px-5 text-[11px] text-[#69736d]">
        <span className="flex items-center gap-2">
          <CodeOutlined />
          <i className="h-2 w-2 rounded-full bg-[#28785e]" />
          本地运行
        </span>
        <span>{currentWorkspace?.members.length ?? 0} 个仓库</span>
      </footer>

      <Modal
        centered
        destroyOnHidden
        maskClosable={!busy}
        open={promoteOpen}
        title={promoteMember?.detached ? "转为开发分支" : "切换开发分支"}
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <span className="mr-auto text-xs text-[#7a847e]">
              已有同名本地分支时直接切换，不覆盖提交。
            </span>
            <Button disabled={busy} onClick={() => setPromoteOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!promoteBranch.trim() || busy}
              form="promote-form"
              htmlType="submit"
              loading={busyAction === "切换开发分支" || busyAction === "转为开发分支"}
              type="primary"
            >
              {promoteMember?.detached ? "转为开发分支" : "切换开发分支"}
            </Button>
          </div>
        }
        onCancel={() => !busy && setPromoteOpen(false)}
      >
        <p className="mb-5 text-sm text-[#7a847e]">
          {promoteMember?.alias ?? ""} 将继续使用当前 worktree，不复制文件
        </p>
        <form
          className="grid gap-4"
          id="promote-form"
          onSubmit={(event) => void submitPromoteReference(event)}
        >
          <label className="grid gap-2 text-sm font-medium" htmlFor="promote-branch">
            开发分支名称
            <Input
              id="promote-branch"
              name="promoteBranch"
              placeholder="例如 feat/workspace-task"
              prefix={<BranchesOutlined />}
              value={promoteBranch}
              onChange={(event) => setPromoteBranch(event.target.value)}
            />
            <small className="font-normal text-[#7a847e]">
              已有本地分支直接切换；仅远端存在时自动跟踪；否则从当前 HEAD 创建
            </small>
          </label>
          <div className="flex gap-3 rounded-lg bg-[#edf5f1] p-4 text-sm">
            <ThunderboltOutlined className="mt-0.5 text-[#28785e]" />
            <div>
              <strong>原位切换</strong>
              <p className="mt-1 text-xs leading-5 text-[#657069]">
                保留当前目录；已有分支不会重建。若它也在其他 worktree 打开，请勿两处同时提交。
              </p>
            </div>
          </div>
          {promoteError && (
            <Alert description={promoteError} message="切换失败" showIcon type="error" />
          )}
        </form>
      </Modal>

      <Modal
        centered
        destroyOnHidden
        maskClosable={!busy}
        open={cloneOpen}
        title="克隆 Workspace"
        width={680}
        footer={
          <div className="flex w-full items-center justify-end gap-2">
            <span className="mr-auto text-xs text-[#7a847e]">
              {cloneDevelopmentCount} 个开发分支 · {cloneReferenceIds.length} 个仅参考
            </span>
            <Button disabled={busy} onClick={() => setCloneOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!cloneCanSubmit}
              form="clone-form"
              htmlType="submit"
              loading={busyAction === "克隆 Workspace"}
              type="primary"
            >
              克隆 {cloneSelectedIds.length} 个仓库
            </Button>
          </div>
        }
        onCancel={() => !busy && setCloneOpen(false)}
      >
        <p className="mb-5 text-sm text-[#7a847e]">选择仓库，创建独立工作区</p>
        <form className="grid gap-4" id="clone-form" onSubmit={(event) => void submitClone(event)}>
          <label className="grid gap-2 text-sm font-medium" htmlFor="clone-source">
            源 Workspace
            <Select<string>
              showSearch
              id="clone-source"
              optionFilterProp="label"
              options={state.workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name,
              }))}
              placeholder="搜索 Workspace"
              {...(cloneSourceId ? { value: cloneSourceId } : {})}
              onChange={(value) => setCloneSourceId(value)}
            />
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="clone-target">
            目标名称
            <Input
              id="clone-target"
              name="cloneTarget"
              placeholder="例如 ruyi-feature"
              prefix={<FolderOutlined />}
              value={cloneTargetName}
              onChange={(event) => setCloneTargetName(event.target.value)}
            />
            <small className="truncate font-normal text-[#7a847e]">
              <FolderOutlined className="mr-1.5" />
              {cloneTargetPath}
            </small>
          </label>
          <label className="grid gap-2 text-sm font-medium" htmlFor="clone-branch">
            开发分支名称
            <Input
              disabled={cloneDevelopmentCount === 0}
              id="clone-branch"
              name="cloneBranch"
              placeholder="例如 feat/ruyi-feature"
              prefix={<BranchesOutlined />}
              value={cloneBranchName}
              onChange={(event) => {
                setCloneBranchName(event.target.value);
                setCloneBranchCustomized(true);
              }}
            />
            <small className="font-normal text-[#7a847e]">
              {cloneDevelopmentCount
                ? `${cloneDevelopmentCount} 个开发仓库使用此分支名`
                : "所选仓库均为参考模式，不会新建分支"}
            </small>
          </label>
          <div className="flex gap-3 rounded-lg bg-[#edf5f1] p-4 text-sm">
            <BranchesOutlined className="mt-0.5 text-[#28785e]" />
            <div>
              <strong>优先跟踪远端同名分支</strong>
              <p className="mt-1 text-xs leading-5 text-[#657069]">
                同名分支不存在时从远端默认分支创建；参考仓库仍使用 detached HEAD。
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between text-sm font-medium">
            <span>选择仓库</span>
            <span className="text-xs font-normal text-[#7a847e]">
              已选 {cloneSelectedIds.length} / {cloneSourceMembers.length}
            </span>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              allowClear
              id="clone-repository-search"
              name="cloneRepositorySearch"
              placeholder="搜索仓库名称"
              prefix={<SearchOutlined />}
              value={cloneRepositoryQuery}
              onChange={(event) => setCloneRepositoryQuery(event.target.value)}
            />
            <Button onClick={toggleAllCloneRepositories}>
              {cloneSelectedIds.length === cloneSourceMembers.length ? "取消全选" : "全选"}
            </Button>
          </div>
          <div className="max-h-[300px] overflow-auto rounded-lg border border-[#dce2de]">
            {filteredCloneMembers.map(({ member, repository }) => {
              const selected = cloneSelectedIds.includes(member.repositoryId);
              const reference = cloneReferenceIds.includes(member.repositoryId);
              return (
                <div
                  className="flex items-center gap-3 border-b border-[#edf0ee] p-3 last:border-b-0"
                  key={member.repositoryId}
                >
                  <Checkbox
                    checked={selected}
                    className="min-w-0 flex-1"
                    name={`cloneRepository-${member.repositoryId}`}
                    onChange={() => toggleCloneRepository(member.repositoryId)}
                  >
                    <span className="inline-grid min-w-0 gap-1 align-middle">
                      <strong className="truncate text-sm">{member.alias}</strong>
                      <code className="truncate text-[11px] text-[#7a847e]">
                        {repository?.classificationPath}
                      </code>
                    </span>
                  </Checkbox>
                  <Button
                    aria-label={`${member.alias}：${reference ? "仅作参考" : "创建开发分支"}`}
                    disabled={!selected}
                    icon={reference ? <BookOutlined /> : <BranchesOutlined />}
                    size="small"
                    type={reference ? "primary" : "default"}
                    onClick={() => toggleCloneReference(member.repositoryId)}
                  >
                    {reference ? "仅作参考" : "开发分支"}
                  </Button>
                </div>
              );
            })}
            {!filteredCloneMembers.length && (
              <Empty
                className="my-8"
                description="没有匹配的仓库"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            )}
          </div>
          {busyAction === "克隆 Workspace" && (
            <Alert
              description="正在创建所选仓库的隔离 worktree…"
              icon={<LoadingOutlined spin />}
              message="正在获取远端默认分支"
              showIcon
              type="info"
            />
          )}
          {cloneError && (
            <Alert description={cloneError} message="克隆失败" showIcon type="error" />
          )}
        </form>
      </Modal>

      <Modal
        centered
        maskClosable={!busy}
        open={confirmOpen && Boolean(confirmState)}
        title={confirmState?.title}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button
              danger={confirmState?.action !== "convert-to-reference"}
              loading={Boolean(busyAction)}
              type={confirmState?.action === "convert-to-reference" ? "primary" : "default"}
              onClick={() => void confirmAction()}
            >
              {confirmState?.confirmLabel ?? "确认删除"}
            </Button>
          </>
        }
        onCancel={() => !busy && setConfirmOpen(false)}
      >
        <p className="mb-4 leading-6 text-[#59635d]">{confirmState?.message}</p>
        <Alert
          description={confirmState?.warning ?? "未提交的改动会阻止删除，数据不会被强制丢弃。"}
          icon={<WarningOutlined />}
          showIcon
          type="warning"
        />
      </Modal>
    </div>
  );
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 8,
          colorBgBase: "#ffffff",
          colorBorder: "#dce2de",
          colorPrimary: "#28785e",
          colorText: "#202723",
          colorTextSecondary: "#737d77",
          fontFamily:
            'Geist, "PingFang SC", "Microsoft YaHei", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
        components: {
          Button: { controlHeight: 36, primaryShadow: "none" },
          Input: { controlHeight: 36 },
          Modal: { contentBg: "#ffffff", headerBg: "#ffffff" },
          Select: { controlHeight: 36 },
          Table: { headerBg: "#f5f7f6", headerColor: "#66716a" },
        },
      }}
    >
      <AntApp className="h-full">
        <WorkspaceApp />
      </AntApp>
    </ConfigProvider>
  );
}
