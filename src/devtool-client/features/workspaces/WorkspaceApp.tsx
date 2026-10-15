import {
  BookOutlined,
  BranchesOutlined,
  CheckCircleFilled,
  CheckOutlined,
  CloseOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DownOutlined,
  FolderOutlined,
  LoadingOutlined,
  MergeOutlined,
  SearchOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  Empty,
  Flex,
  Form,
  Input,
  Layout,
  Listy,
  Modal,
  Select,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import type { MenuProps, TableProps } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  connectDevframe,
  DevframeConnectionError,
  type DevframeRpcClient,
  type DevframeScopedClientRpc,
} from "devframe/client";

import type { DevtoolState, DevtoolWorkspace } from "../../../devtool.js";
import type {
  RepositoryRecord,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceStatusResult,
} from "../../../types.js";
import { RepositoryPanel, type RepositoryStatusCounts } from "./components/RepositoryPanel.js";
import { WorkspaceHeader } from "./components/WorkspaceHeader.js";
import { WorkspaceSidebar } from "./components/WorkspaceSidebar.js";
import { WorkspaceSummary } from "./components/WorkspaceSummary.js";

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

const { Content, Footer } = Layout;
const { Paragraph, Text } = Typography;

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    return `${code}${error.message}`;
  }
  return String(error);
}

export default function WorkspaceApp() {
  const { message, modal, notification } = AntApp.useApp();
  const [state, setState] = useState(initialState);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [repositoryQuery, setRepositoryQuery] = useState("");
  const [repositoryMode, setRepositoryMode] = useState("all");
  const [repositoryState, setRepositoryState] = useState("all");
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
  const [confirmAcknowledged, setConfirmAcknowledged] = useState(false);
  const [detailMember, setDetailMember] = useState<WorkspaceMember>();
  const [codexTasks, setCodexTasks] = useState<Record<string, "starting" | "running">>({});

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
    setDetailMember(undefined);
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
      setFeedback(undefined);
      void message.success(success);
      return true;
    } catch (error) {
      if (refreshStatus && checkedWorkspaceId === selectedWorkspaceIdRef.current) {
        await refreshWorkspaceStatus(false);
      }
      setFeedback(undefined);
      notification.error({
        title: `${name}失败`,
        description: describeError(error),
        duration: 8,
        placement: "topRight",
      });
      return false;
    } finally {
      setBusyAction("");
    }
  }

  async function createWorkspace(): Promise<void> {
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
      setFeedback(undefined);
      void message.success("已复制 cd 命令");
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

  async function syncWorkspaceBranches(workspace: DevtoolWorkspace): Promise<void> {
    if (busy) return;
    const rpc = await getRpc();
    setBusyAction("批量同步分支");
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
          ? `${failed} 个仓库同步失败`
          : conflicts
            ? `${conflicts} 个仓库产生冲突`
            : "批量同步完成",
        description: (
          <div className="grid gap-2">
            <Text type="secondary">
              {synced} 个已同步，{skipped} 个已跳过，{conflicts} 个冲突，{failed} 个失败。
            </Text>
            {issues.length > 0 && (
              <ul className="m-0 grid max-h-52 gap-1 overflow-auto pl-5">
                {issues.map((item) => (
                  <li key={item.repositoryId}>
                    <Text strong>{item.alias}</Text>
                    <Text type="secondary">：{item.message}</Text>
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
        title: "批量同步失败",
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
      title: "批量同步工作区分支",
      content: (
        <div className="grid gap-2 text-sm">
          <Text>将逐个处理工作区内由 CPL 管理的仓库：</Text>
          <ul className="m-0 grid gap-1 pl-5 text-[var(--ant-color-text-secondary)]">
            <li>开发分支合并远端同名分支和最新主分支，成功后推送</li>
            <li>参考仓库更新到最新主分支并保持 detached</li>
            <li>未提交变更与已完成分支会跳过；冲突会保留以便后续处理</li>
          </ul>
        </div>
      ),
      okText: "开始同步",
      cancelText: "取消",
      onOk: () => syncWorkspaceBranches(workspace),
    });
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

  async function openMemberInCodex(
    workspace: DevtoolWorkspace,
    member: WorkspaceMember,
  ): Promise<void> {
    const status = statusFor(member);
    if (!status?.conflicts.length) return;
    const repositoryPath =
      member.mode === "worktree"
        ? member.worktreePath
        : (repositoryFor(member)?.absolutePath ?? workspace.absolutePath);
    const prompt = `请协助处理仓库 ${member.alias} 当前工作区的 Git 冲突。

工作目录：${repositoryPath}
当前分支：${status.branch}
冲突文件：
${status.conflicts.map((file) => `- ${file}`).join("\n")}

处理要求：
1. 先检查 git status 和冲突两侧内容，理解现有业务意图后逐文件合并。
2. 如果当前处于 rebase，且冲突很多或会在多个提交中反复解决，先确认原始状态可恢复，再执行 git rebase --abort，改为 git merge 远端主分支后解决冲突。
3. 保留双方有效改动，不使用 git checkout --ours/--theirs 批量覆盖。
4. 直接在当前工作目录处理，不创建新的项目、Workspace、分支或 worktree。
5. 解决全部冲突后执行 git add，并完成本地提交；如果继续 rebase，应完成必要的 rebase --continue，确保最终 HEAD 已提交，不创建空提交。提交信息遵循仓库现有规范。
6. 不要 push、reset、clean，也不要清理原有未提交内容。
7. 运行与改动相关的最小验证，最后报告提交 SHA、验证结果和每个冲突的处理依据。`;
    const rpc = await getRpc();
    const messageKey = `codex-${member.repositoryId}`;
    if (codexTasks[member.repositoryId]) return;
    setCodexTasks((current) => ({ ...current, [member.repositoryId]: "starting" }));
    void message.loading({ content: "正在创建 Codex 聊天…", key: messageKey, duration: 0 });
    try {
      const turn = await rpc.call("open-workspace-member-in-codex", {
        workspaceId: workspace.id,
        repositoryId: member.repositoryId,
        prompt,
      });
      setCodexTasks((current) => ({ ...current, [member.repositoryId]: "running" }));
      void message.loading({ content: "Codex 正在处理冲突并提交…", key: messageKey, duration: 0 });
      const result = await rpc.call("wait-for-codex-turn", { turnId: turn.turnId });
      if (result.status === "failed") throw new Error(result.message ?? "Codex turn failed.");
      void message.success({ content: "Codex 已处理冲突并完成本地提交", key: messageKey });
      if (selectedWorkspaceIdRef.current === workspace.id) await refreshWorkspaceStatus(false);
    } catch (error) {
      message.destroy(messageKey);
      notification.error({
        title: "Codex 处理失败",
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

  function openPromoteReference(workspace: DevtoolWorkspace, member: WorktreeMember): void {
    setPromoteMember(member);
    setPromoteBranch(
      member.detached ? `workspace/${workspace.name}/${member.alias}` : member.branch,
    );
    setPromoteError("");
    setPromoteOpen(true);
  }

  async function submitPromoteReference(): Promise<void> {
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
    if (member.mode === "worktree" && member.detached) return true;
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

  async function executePush(
    workspace: DevtoolWorkspace,
    member: WorkspaceMember,
    force = false,
  ): Promise<void> {
    const rpc = await getRpc();
    await runAction(
      force ? "安全强制推送" : "同步并 Push 分支",
      () =>
        rpc.call("push-workspace-member", {
          workspaceId: workspace.id,
          repositoryId: member.repositoryId,
          force,
        }),
      force ? `已使用 --force-with-lease 推送 ${member.alias}` : `已同步并推送 ${member.alias}`,
      workspace.id,
    );
  }

  function pushMember(workspace: DevtoolWorkspace, member: WorkspaceMember): void {
    if (!statusFor(member)?.forcePushRequired) {
      void executePush(workspace, member);
      return;
    }
    modal.confirm({
      centered: true,
      title: "Rebase 已改写远端分支历史",
      icon: <WarningOutlined />,
      content: (
        <div className="grid gap-2">
          <Text>普通 Push 会被远端拒绝。确认后将使用安全强推更新 {member.alias} 的远端分支。</Text>
          <Text type="secondary">
            实际执行 --force-with-lease；如果远端在 Rebase
            后又有新提交，推送会自动停止，不会覆盖他人改动。
          </Text>
        </div>
      ),
      okText: "使用安全强推",
      okType: "danger",
      cancelText: "取消",
      onOk: () => executePush(workspace, member, true),
    });
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

  async function addMember(workspace: DevtoolWorkspace): Promise<void> {
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

  async function submitClone(): Promise<void> {
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
      setFeedback(undefined);
      void message.success(
        `Workspace 克隆完成：${cloneDevelopmentCount} 个开发分支，${cloneReferenceIds.length} 个参考 worktree`,
      );
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
    setConfirmAcknowledged(false);
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
    setConfirmAcknowledged(true);
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
    setConfirmAcknowledged(true);
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
    if (status.conflicts.length) {
      return (
        <Button
          className="!h-6 !rounded-md !px-2 !text-xs"
          color="danger"
          variant="filled"
          onClick={() => setDetailMember(member)}
        >
          {status.conflicts.length} 个冲突
        </Button>
      );
    }
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
      <Space className="max-w-full [&_.ant-tag]:mr-0 [&_.ant-tag]:w-fit" size={[4, 4]} wrap>
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
        {status.forcePushRequired && (
          <Tooltip title="Rebase 改写了已推送的提交，需确认后使用 --force-with-lease">
            <Tag color="error" icon={<WarningOutlined />}>
              Rebase 后需安全强推
            </Tag>
          </Tooltip>
        )}
        {!status.ahead && !status.behind && (
          <Tag color="success" icon={<CheckOutlined />}>
            已同步 {status.defaultBranch}
          </Tag>
        )}
        {status.changes.length ? (
          <Button
            className="!h-6 !rounded-md !px-2 !text-xs"
            color="orange"
            variant="filled"
            onClick={() => setDetailMember(member)}
          >
            {status.changes.length} 项未提交
          </Button>
        ) : (
          <Tag>工作区干净</Tag>
        )}
      </Space>
    );
  }

  const columns: NonNullable<TableProps<WorkspaceMember>["columns"]> = [
    {
      title: "仓库",
      key: "repository",
      width: 230,
      render: (_, member) => {
        const repositoryPath = repositoryFor(member)?.classificationPath ?? member.repositoryId;
        return (
          <div
            className={`relative grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-2.5 ${
              isNonDefaultBranch(member)
                ? "before:absolute before:-top-2 before:-bottom-2 before:-left-3 before:w-[3px] before:rounded-sm before:bg-[var(--ant-color-primary)] before:content-['']"
                : ""
            }`}
          >
            <FolderOutlined className="mt-1 !text-base !text-[var(--ant-color-primary)]" />
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
      title: "分支",
      key: "branch",
      width: 180,
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
          <div className="grid w-full min-w-0 gap-0.5 [&_.ant-tag]:mr-0 [&_.ant-tag]:w-fit">
            <Tooltip title={activeBranch}>
              <Text className="block min-w-0 max-w-full" code ellipsis strong={nonDefault}>
                {activeBranch}
              </Text>
            </Tooltip>
            {nonDefault && <Tag color="purple">开发分支</Tag>}
          </div>
        );
      },
    },
    {
      title: "本地状态",
      key: "status",
      width: 250,
      render: (_, member) => renderHealth(member),
    },
    {
      title: "类型",
      key: "mode",
      width: 90,
      render: (_, member) => (
        <Tag className="!mr-0 w-fit">
          {member.mode === "worktree" && !member.detached ? "开发" : "参考"}
        </Tag>
      ),
    },
    {
      title: "操作",
      key: "actions",
      fixed: "right",
      width: 150,
      render: (_, member) => {
        if (!currentWorkspace) return null;
        const status = statusFor(member);
        const worktree = member.mode === "worktree" ? member : undefined;
        const menuItems: MenuProps["items"] = [];
        if (canRebase(member)) {
          menuItems.push({
            key: "rebase",
            icon: worktree?.detached ? <CloudDownloadOutlined /> : <MergeOutlined />,
            label: worktree?.detached ? "拉取最新主分支" : "Rebase 远端主分支",
          });
        }
        if (canPush(member)) {
          menuItems.push({
            key: "push",
            icon: <CloudUploadOutlined />,
            label: status?.forcePushRequired ? "使用安全强推" : "同步并 Push 分支",
            danger: Boolean(status?.forcePushRequired),
          });
        }
        if (worktree) {
          menuItems.push({
            key: "switch",
            icon: <BranchesOutlined />,
            label: worktree.detached ? "转为开发分支" : "切换开发分支",
          });
        }
        if (worktree && !worktree.detached) {
          menuItems.push({ key: "reference", icon: <BookOutlined />, label: "转为参考" });
        }
        menuItems.push({
          key: "remove",
          danger: true,
          icon: <CloseOutlined />,
          label: "移出工作区",
        });

        const handleMenuClick: NonNullable<MenuProps["onClick"]> = ({ key }) => {
          if (key === "rebase") void rebaseMember(currentWorkspace, member);
          if (key === "push") pushMember(currentWorkspace, member);
          if (key === "switch" && worktree) openPromoteReference(currentWorkspace, worktree);
          if (key === "reference" && worktree) openConvertToReference(currentWorkspace, worktree);
          if (key === "remove") openRemoveMember(currentWorkspace, member);
        };

        return (
          <Space size={0}>
            <Button
              danger={Boolean(status?.conflicts.length)}
              disabled={busy}
              type="link"
              onClick={() =>
                status?.conflicts.length
                  ? setDetailMember(member)
                  : void openMemberInVscode(currentWorkspace, member)
              }
            >
              {status?.conflicts.length ? "处理冲突" : "打开"}
            </Button>
            <Dropdown
              disabled={busy}
              menu={{ items: menuItems, onClick: handleMenuClick }}
              placement="bottomRight"
              trigger={["click"]}
            >
              <Button type="link">
                更多 <DownOutlined />
              </Button>
            </Dropdown>
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
    <>
      <Layout className="h-full min-w-[980px] bg-[var(--ant-color-bg-layout)]">
        <WorkspaceSidebar
          busy={busy}
          filteredWorkspaces={filteredWorkspaces}
          newWorkspaceName={newWorkspaceName}
          selectedWorkspaceId={selectedWorkspaceId}
          showCreate={showCreate}
          workspaceQuery={workspaceQuery}
          workspaceRoot={state.config?.workspaceRoot ?? ""}
          onCreateWorkspace={() => void createWorkspace()}
          onNewWorkspaceNameChange={setNewWorkspaceName}
          onSelectWorkspace={(id) => {
            selectedWorkspaceIdRef.current = id;
            setSelectedWorkspaceId(id);
          }}
          onToggleCreate={() => setShowCreate((value) => !value)}
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
            workspaceName={currentWorkspace?.name}
          />

          <Content
            aria-busy={busy}
            className="min-w-0 overflow-auto bg-[radial-gradient(circle_at_92%_0%,rgba(91,85,231,0.05),transparent_36%),linear-gradient(135deg,#f8faff_0%,var(--ant-color-bg-layout)_58%,#faf9ff_100%)]"
          >
            {connectionState === "failed" ? (
              <Alert description={fatalError} title="无法连接 Devframe" showIcon type="error" />
            ) : connectionState !== "connected" && !currentWorkspace ? (
              <Flex align="center" className="min-h-[360px]" gap={16} justify="center" vertical>
                <Spin size="large" />
                <Text strong>
                  {connectionState === "reconnecting"
                    ? "正在重新连接 Devframe"
                    : "正在读取 Workspace"}
                </Text>
                {fatalError && <Text type="secondary">{fatalError}</Text>}
              </Flex>
            ) : !currentWorkspace ? (
              <Flex align="center" className="min-h-[360px]" justify="center">
                <Empty description="还没有 Workspace，使用左侧加号创建第一个 Workspace。" />
              </Flex>
            ) : (
              <div className="grid min-w-[940px] grid-cols-[minmax(720px,1fr)] items-stretch gap-4 px-5 pt-4 pb-6">
                <WorkspaceSummary
                  absolutePath={currentWorkspace.absolutePath}
                  busy={busy}
                  developmentCount={currentWorkspace.members.filter(isNonDefaultBranch).length}
                  memberCount={currentWorkspace.members.length}
                  name={currentWorkspace.name}
                  statusLabel={
                    workspaceStatus ? (workspaceStatusFresh ? "刚刚检查" : "缓存状态") : "尚未检查"
                  }
                  onClone={openClone}
                  onDelete={() => openDeleteWorkspace(currentWorkspace)}
                />

                <RepositoryPanel
                  busy={busy}
                  branchSyncing={busyAction === "批量同步分支"}
                  columns={columns}
                  feedback={feedback}
                  filteredMembers={filteredMembers}
                  members={currentWorkspace.members}
                  mode={repositoryMode}
                  query={repositoryQuery}
                  state={repositoryState}
                  status={workspaceStatus}
                  statusCounts={repositoryStatusCounts}
                  statusLoading={statusLoading}
                  onAddRepository={() => setShowAdd(true)}
                  onBatchSync={() => confirmWorkspaceBranchSync(currentWorkspace)}
                  onCheckStatus={() => void refreshWorkspaceStatus()}
                  onCloseFeedback={() => setFeedback(undefined)}
                  onCopyCommand={() => void copyCommand(currentWorkspace)}
                  onModeChange={setRepositoryMode}
                  onOpenChatgpt={() => void openWorkspaceInChatgpt(currentWorkspace)}
                  onQueryChange={setRepositoryQuery}
                  onStateChange={setRepositoryState}
                  onSyncWorkspace={() => void syncWorkspace(currentWorkspace)}
                />
              </div>
            )}
          </Content>
          <Footer className="grid min-h-10 grid-cols-[minmax(240px,1fr)_minmax(280px,1.3fr)] items-center gap-6 border-t border-[var(--ant-color-split)] !bg-white/90 !px-5 !py-2 backdrop-blur-sm">
            <Text ellipsis type="secondary">
              <DatabaseOutlined /> 配置已持久化 · {state.config?.workspaceRoot || "—"}
            </Text>
            <Text ellipsis type="secondary">
              <FolderOutlined /> 当前工作区：{currentWorkspace?.absolutePath ?? "—"}
            </Text>
          </Footer>
        </Layout>
      </Layout>

      <Drawer
        closable={{ "aria-label": "关闭仓库状态详情" }}
        destroyOnHidden
        extra={
          detailMember && currentWorkspace && !statusFor(detailMember)?.conflicts.length ? (
            <Button
              icon={<CodeOutlined />}
              onClick={() => void openMemberInVscode(currentWorkspace, detailMember)}
            >
              在 VS Code 中打开
            </Button>
          ) : null
        }
        open={Boolean(detailMember)}
        size={480}
        title={
          detailMember
            ? `${detailMember.alias} · ${statusFor(detailMember)?.conflicts.length ? "冲突详情" : "本地详情"}`
            : "本地详情"
        }
        onClose={() => setDetailMember(undefined)}
      >
        {detailMember &&
          (() => {
            const status = statusFor(detailMember);
            if (!status?.conflicts.length && !status?.changes.length) {
              return <Empty description="工作区干净" image={Empty.PRESENTED_IMAGE_SIMPLE} />;
            }
            return (
              <div className="grid gap-6">
                {Boolean(status.conflicts.length) && currentWorkspace && (
                  <section className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-3">
                    <Text strong>选择处理方式</Text>
                    <Text className="mt-1 mb-3 block" type="secondary">
                      人工精确处理，或以完全访问权限创建普通 Codex 聊天交给 AI 处理。
                    </Text>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        block
                        disabled={busy}
                        icon={<CodeOutlined />}
                        type="primary"
                        onClick={() => void openMemberInVscode(currentWorkspace, detailMember)}
                      >
                        VS Code 人工处理
                      </Button>
                      <Tooltip title="以完全访问权限创建可在 Codex 中继续查看的聊天，不新建项目">
                        <Button
                          block
                          disabled={busy || Boolean(codexTasks[detailMember.repositoryId])}
                          icon={<ThunderboltOutlined />}
                          loading={Boolean(codexTasks[detailMember.repositoryId])}
                          onClick={() => void openMemberInCodex(currentWorkspace, detailMember)}
                        >
                          {codexTasks[detailMember.repositoryId] === "starting"
                            ? "正在启动"
                            : codexTasks[detailMember.repositoryId] === "running"
                              ? "Codex 处理中"
                              : "交给 Codex 处理"}
                        </Button>
                      </Tooltip>
                    </div>
                  </section>
                )}
                {Boolean(status.conflicts.length) && (
                  <section>
                    <Text className="mb-2 block" strong type="danger">
                      冲突文件（{status.conflicts.length}）
                    </Text>
                    <Listy<string>
                      className="rounded-md border border-[var(--ant-color-border-secondary)]"
                      classNames={{ item: "!px-3 !py-2" }}
                      items={status.conflicts}
                      rowKey={(item) => item}
                      itemRender={(item) => <Text code>{item}</Text>}
                    />
                  </section>
                )}
                {Boolean(status.changes.length) && (
                  <section>
                    <Text className="mb-2 block" strong>
                      未提交变更（{status.changes.length}）
                    </Text>
                    <Listy<string>
                      className="rounded-md border border-[var(--ant-color-border-secondary)]"
                      classNames={{ item: "!px-3 !py-2" }}
                      items={status.changes}
                      rowKey={(item) => item}
                      itemRender={(item) => <Text code>{item}</Text>}
                    />
                  </section>
                )}
              </div>
            );
          })()}
      </Drawer>

      <Modal
        centered
        destroyOnHidden
        mask={{ closable: !busy }}
        open={showAdd}
        title="添加仓库"
        width={560}
        footer={
          <Space>
            <Button disabled={busy} onClick={() => setShowAdd(false)}>
              取消
            </Button>
            <Button
              disabled={!selectedRepositoryId || !branch.trim() || busy}
              form="add-repository-form"
              htmlType="submit"
              loading={busyAction === "添加仓库"}
              type="primary"
            >
              添加
            </Button>
          </Space>
        }
        onCancel={() => !busy && setShowAdd(false)}
      >
        <Paragraph type="secondary">选择仓库和开发分支，加入当前工作区。</Paragraph>
        <Form
          id="add-repository-form"
          layout="vertical"
          onFinish={() => currentWorkspace && void addMember(currentWorkspace)}
        >
          <Form.Item label="仓库" required>
            <Select<string>
              showSearch={{ optionFilterProp: "label" }}
              disabled={!availableRepositories.length}
              id="repository-select"
              options={availableRepositories.map((repository) => ({
                value: repository.id,
                label: repository.classificationPath,
              }))}
              placeholder="搜索仓库"
              {...(selectedRepositoryId ? { value: selectedRepositoryId } : {})}
              onChange={(value) => setSelectedRepositoryId(value)}
            />
          </Form.Item>
          <Form.Item label="目录别名">
            <Input
              id="repository-alias"
              name="repositoryAlias"
              placeholder="默认使用仓库名"
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
            />
          </Form.Item>
          <Form.Item
            extra="远端有同名分支时自动关联；否则从远端主分支创建"
            label="开发分支"
            required
          >
            <Input
              id="repository-branch"
              name="repositoryBranch"
              placeholder="例如 feat/workspace-task"
              prefix={<BranchesOutlined />}
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
            />
          </Form.Item>
          <Form.Item className="!mb-0" label="分支方式">
            <Segmented
              block
              options={[
                { label: "新建或跟踪远端同名分支", value: "create" },
                { label: "使用已有本地分支", value: "existing" },
              ]}
              value={createBranch ? "create" : "existing"}
              onChange={(value) => setCreateBranch(value === "create")}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        centered
        destroyOnHidden
        mask={{ closable: !busy }}
        open={promoteOpen}
        title={promoteMember?.detached ? "转为开发分支" : "切换开发分支"}
        footer={
          <Flex align="center" justify="space-between">
            <Text type="secondary">已有同名本地分支时直接切换，不覆盖提交。</Text>
            <Space>
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
            </Space>
          </Flex>
        }
        onCancel={() => !busy && setPromoteOpen(false)}
      >
        <Paragraph type="secondary">
          {promoteMember?.alias ?? ""} 将继续使用当前 worktree，不复制文件
        </Paragraph>
        <Form id="promote-form" layout="vertical" onFinish={() => void submitPromoteReference()}>
          <Form.Item
            extra="已有本地分支直接切换；仅远端存在时自动跟踪；否则从当前 HEAD 创建"
            label="开发分支名称"
            required
          >
            <Input
              id="promote-branch"
              name="promoteBranch"
              placeholder="例如 feat/workspace-task"
              prefix={<BranchesOutlined />}
              value={promoteBranch}
              onChange={(event) => setPromoteBranch(event.target.value)}
            />
          </Form.Item>
          <Alert
            description="保留当前目录；已有分支不会重建。若它也在其他 worktree 打开，请勿两处同时提交。"
            icon={<ThunderboltOutlined />}
            title="原位切换"
            showIcon
            type="info"
          />
          {promoteError && (
            <Alert description={promoteError} title="切换失败" showIcon type="error" />
          )}
        </Form>
      </Modal>

      <Modal
        centered
        classNames={{ body: "max-h-[calc(100dvh-220px)] overflow-y-auto" }}
        destroyOnHidden
        mask={{ closable: !busy }}
        open={cloneOpen}
        title="克隆工作区"
        width={840}
        footer={
          <Flex align="center" justify="space-between">
            <Text type="secondary">
              {cloneDevelopmentCount} 个开发分支 · {cloneReferenceIds.length} 个仅参考
            </Text>
            <Space>
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
            </Space>
          </Flex>
        }
        onCancel={() => !busy && setCloneOpen(false)}
      >
        <Paragraph type="secondary">
          基于现有工作区创建一个新的工作区，并选择需要克隆的仓库。
        </Paragraph>
        <Form id="clone-form" layout="vertical" onFinish={() => void submitClone()}>
          <div className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] items-start gap-6 max-[761px]:grid-cols-1">
            <div className="min-w-0">
              <Form.Item label="源 Workspace" required>
                <Select<string>
                  showSearch={{ optionFilterProp: "label" }}
                  id="clone-source"
                  options={state.workspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  }))}
                  placeholder="搜索 Workspace"
                  {...(cloneSourceId ? { value: cloneSourceId } : {})}
                  onChange={(value) => setCloneSourceId(value)}
                />
              </Form.Item>
              <Form.Item label="新工作区名称" required>
                <Input
                  id="clone-target"
                  name="cloneTarget"
                  placeholder="例如 ruyi-feature"
                  prefix={<FolderOutlined />}
                  value={cloneTargetName}
                  onChange={(event) => setCloneTargetName(event.target.value)}
                />
              </Form.Item>
              <Alert
                className="mb-5 [&_.ant-alert-description]:truncate"
                description={cloneTargetPath}
                icon={<FolderOutlined />}
                showIcon
                type="info"
              />
              <Form.Item
                extra={
                  cloneDevelopmentCount
                    ? "已有远端分支时自动关联，否则从远端主分支创建"
                    : "所选仓库均为参考模式，不会新建分支"
                }
                label="默认开发分支"
                required={cloneDevelopmentCount > 0}
              >
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
              </Form.Item>
            </div>
            <div className="min-w-0">
              <Flex align="center" className="mb-2 min-h-8" justify="space-between">
                <Text strong>选择仓库</Text>
                <Text type="secondary">
                  已选 {cloneSelectedIds.length} / {cloneSourceMembers.length}
                </Text>
              </Flex>
              <Space.Compact block className="mb-3">
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
              </Space.Compact>
              {filteredCloneMembers.length ? (
                <Listy
                  className="max-h-[300px] overflow-auto rounded-md border border-[var(--ant-color-border-secondary)] [&_.ant-checkbox-wrapper]:min-w-0 [&_.ant-space]:min-w-0"
                  classNames={{ item: "!px-3 !py-2 [&>.ant-flex]:min-w-0" }}
                  items={filteredCloneMembers}
                  rowKey={({ member }) => member.repositoryId}
                  itemRender={({ member, repository }) => {
                    const selected = cloneSelectedIds.includes(member.repositoryId);
                    const reference = cloneReferenceIds.includes(member.repositoryId);
                    return (
                      <Flex align="center" className="min-w-0" gap={16} justify="space-between">
                        <Checkbox
                          checked={selected}
                          className="min-w-0 flex-1 overflow-hidden"
                          name={`cloneRepository-${member.repositoryId}`}
                          onChange={() => toggleCloneRepository(member.repositoryId)}
                        >
                          <Space orientation="vertical" size={0}>
                            <Text strong>{member.alias}</Text>
                            <Text className="block !max-w-[190px]" code ellipsis type="secondary">
                              {repository?.classificationPath}
                            </Text>
                          </Space>
                        </Checkbox>
                        <Segmented
                          aria-label={`${member.alias} 克隆模式`}
                          disabled={!selected}
                          options={[
                            { label: "开发", value: "worktree" },
                            { label: "仅参考", value: "reference" },
                          ]}
                          size="small"
                          value={reference ? "reference" : "worktree"}
                          onChange={(value) => {
                            if ((value === "reference") !== reference)
                              toggleCloneReference(member.repositoryId);
                          }}
                        />
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
                  <Empty description="没有匹配的仓库" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                </Flex>
              )}
            </div>
          </div>
          {busyAction === "克隆 Workspace" && (
            <Alert
              description="正在创建所选仓库的隔离 worktree…"
              icon={<LoadingOutlined spin />}
              title="正在获取远端默认分支"
              showIcon
              type="info"
            />
          )}
          {cloneError && <Alert description={cloneError} title="克隆失败" showIcon type="error" />}
        </Form>
      </Modal>

      <Modal
        centered
        mask={{ closable: !busy }}
        open={confirmOpen && Boolean(confirmState)}
        title={confirmState?.title}
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)}>取消</Button>
            <Button
              danger={confirmState?.action !== "convert-to-reference"}
              disabled={confirmState?.action === "delete-workspace" && !confirmAcknowledged}
              loading={Boolean(busyAction)}
              type="primary"
              onClick={() => void confirmAction()}
            >
              {confirmState?.confirmLabel ?? "确认删除"}
            </Button>
          </>
        }
        onCancel={() => !busy && setConfirmOpen(false)}
      >
        <Paragraph>{confirmState?.message}</Paragraph>
        <Alert
          description={confirmState?.warning ?? "未提交的改动会阻止删除，数据不会被强制丢弃。"}
          icon={<WarningOutlined />}
          showIcon
          type="warning"
        />
        {confirmState?.action === "delete-workspace" && (
          <Checkbox
            checked={confirmAcknowledged}
            className="mt-4"
            onChange={(event) => setConfirmAcknowledged(event.target.checked)}
          >
            我已了解此操作不可撤销
          </Checkbox>
        )}
      </Modal>
    </>
  );
}
