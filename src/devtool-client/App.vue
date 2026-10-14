<script setup lang="ts">
import ActionButton from "@antfu/design/components/Action/ActionButton.vue";
import ActionIconButton from "@antfu/design/components/Action/ActionIconButton.vue";
import FormCheckbox from "@antfu/design/components/Form/FormCheckbox.vue";
import FormCombobox from "@antfu/design/components/Form/FormCombobox.vue";
import FormTextInput from "@antfu/design/components/Form/FormTextInput.vue";
import OverlayModal from "@antfu/design/components/Overlay/OverlayModal.vue";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
const state = ref<DevtoolState>({
  config: { schemaVersion: 1, rootDir: "", workspaceRoot: "", scanRoots: [] },
  repositories: [],
  workspaces: [],
  workspaceStatuses: [],
});
const selectedWorkspaceId = ref<string>();
const workspaceQuery = ref("");
const newWorkspaceName = ref("");
const showCreate = ref(false);
const showAdd = ref(false);
const selectedRepositoryId = ref("");
const alias = ref("");
const branch = ref("");
const createBranch = ref(true);
const busyAction = ref("");
const connectionState = ref<"connecting" | "connected" | "reconnecting" | "failed">("connecting");
const fatalError = ref("");
const feedback = ref<{ title: string; message: string; error: boolean }>();

const cloneOpen = ref(false);
const confirmOpen = ref(false);
const promoteOpen = ref(false);
const cloneSourceId = ref("");
const cloneTargetName = ref("");
const cloneBranchName = ref("");
const cloneBranchCustomized = ref(false);
const cloneRepositoryQuery = ref("");
const cloneSelectedIds = ref<string[]>([]);
const cloneReferenceIds = ref<string[]>([]);
const cloneError = ref("");
const workspaceStatuses = ref<Record<string, WorkspaceStatusResult>>({});
const workspaceStatus = ref<WorkspaceStatusResult>();
const workspaceStatusFresh = ref(false);
const statusLoading = ref(false);
const promoteMember = ref<Extract<WorkspaceMember, { mode: "worktree" }>>();
const promoteBranch = ref("");
const promoteError = ref("");
const confirmState = ref<{
  title: string;
  message: string;
  action: "delete-workspace" | "remove-member" | "convert-to-reference";
  workspace: DevtoolWorkspace;
  member?: WorkspaceMember;
  confirmLabel?: string;
  warning?: string;
}>();
let statusRequestId = 0;
let statusWorkspaceId: string | undefined;
let activeClient: DevframeRpcClient | undefined;
let stopConnectionStatus: (() => void) | undefined;
let reconnectPromise: Promise<DevframeScopedClientRpc<"compulsive">> | undefined;
let reconnectTimer: number | undefined;
let wakeReconnectDelay: (() => void) | undefined;
let reconnectAttempt = 0;
let disposed = false;
let rpcPromise: Promise<DevframeScopedClientRpc<"compulsive">>;

const busy = computed(() => Boolean(busyAction.value) || connectionState.value !== "connected");
const currentWorkspace = computed(() =>
  state.value.workspaces.find((workspace) => workspace.id === selectedWorkspaceId.value),
);
const filteredWorkspaces = computed(() => {
  const query = workspaceQuery.value.trim().toLowerCase();
  return state.value.workspaces.filter((workspace) =>
    [workspace.name, workspace.absolutePath].some((value) => value.toLowerCase().includes(query)),
  );
});
const availableRepositories = computed(() => {
  const memberIds = new Set(currentWorkspace.value?.members.map((member) => member.repositoryId));
  return state.value.repositories.filter((repository) => !memberIds.has(repository.id));
});
const repositoryOptions = computed(() =>
  availableRepositories.value.map((repository) => ({
    value: repository.classificationPath,
    label: repository.classificationPath,
  })),
);
const selectedRepositoryPath = computed({
  get: () =>
    availableRepositories.value.find((repository) => repository.id === selectedRepositoryId.value)
      ?.classificationPath ?? "",
  set: (path: string | undefined) => {
    selectedRepositoryId.value =
      availableRepositories.value.find((repository) => repository.classificationPath === path)
        ?.id ?? "";
  },
});
const cloneSource = computed(() =>
  state.value.workspaces.find((workspace) => workspace.id === cloneSourceId.value),
);
const cloneSourceMembers = computed(() =>
  (cloneSource.value?.members ?? []).map((member) => ({
    member,
    repository: repositoryFor(member),
  })),
);
const cloneSourceOptions = computed(() =>
  state.value.workspaces.map((workspace) => ({ value: workspace.name, label: workspace.name })),
);
const cloneSourceName = computed({
  get: () => cloneSource.value?.name ?? "",
  set: (name: string | undefined) => {
    cloneSourceId.value =
      state.value.workspaces.find((workspace) => workspace.name === name)?.id ?? "";
  },
});
const filteredCloneMembers = computed(() => {
  const query = cloneRepositoryQuery.value.trim().toLowerCase();
  return cloneSourceMembers.value.filter(({ member, repository }) =>
    [member.alias, repository?.classificationPath ?? ""].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
});
const cloneTargetPath = computed(() => {
  const name = cloneTargetName.value.trim();
  const workspaceRoot = state.value.config?.workspaceRoot ?? "";
  return name ? `${workspaceRoot.replace(/\/$/, "")}/${name}` : workspaceRoot;
});
const cloneDevelopmentCount = computed(
  () =>
    cloneSelectedIds.value.filter((repositoryId) => !cloneReferenceIds.value.includes(repositoryId))
      .length,
);
const cloneCanSubmit = computed(
  () =>
    cloneTargetName.value.trim() &&
    cloneSelectedIds.value.length > 0 &&
    (cloneDevelopmentCount.value === 0 || cloneBranchName.value.trim()) &&
    !busy.value,
);

watch(selectedWorkspaceId, (workspaceId) => {
  showAdd.value = false;
  alias.value = "";
  branch.value = "";
  createBranch.value = true;
  workspaceStatus.value = workspaceId ? workspaceStatuses.value[workspaceId] : undefined;
  workspaceStatusFresh.value = false;
});
watch(availableRepositories, (repositories) => {
  if (!repositories.some((repository) => repository.id === selectedRepositoryId.value))
    selectedRepositoryId.value = repositories[0]?.id ?? "";
});
watch(cloneSourceId, () => {
  cloneRepositoryQuery.value = "";
  cloneSelectedIds.value = cloneSource.value?.members.map((member) => member.repositoryId) ?? [];
  cloneReferenceIds.value = [];
});
watch(cloneTargetName, (name) => {
  if (!cloneBranchCustomized.value) {
    cloneBranchName.value = name.trim() ? `workspace/${name.trim()}` : "";
  }
});
watch(branch, (value) => {
  if (!value.trim()) createBranch.value = true;
});

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    return `${code}${error.message}`;
  }
  return String(error);
}
function applyState(
  nextState: DevtoolState,
  preferredWorkspaceId = selectedWorkspaceId.value,
): void {
  state.value = nextState;
  workspaceStatuses.value = Object.fromEntries(
    state.value.workspaceStatuses.map((status) => [status.workspaceId, status]),
  );
  selectedWorkspaceId.value = state.value.workspaces.some(
    (workspace) => workspace.id === preferredWorkspaceId,
  )
    ? preferredWorkspaceId
    : state.value.workspaces[0]?.id;
}
async function waitForReconnectHost(): Promise<void> {
  const url =
    activeClient?.connection.metaBaseUrl ?? new URL("./__connection.json", document.baseURI);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Devframe connection check failed: ${response.status}`);
}
async function loadState(
  rpc: DevframeScopedClientRpc<"compulsive">,
  reconnecting: boolean,
): Promise<DevtoolState> {
  const request = rpc.call("get-state");
  if (!reconnecting) return request;
  let timer: number | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => reject(new Error("Devframe reconnect timed out.")), 5_000);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
async function connectRpc(reconnecting = false): Promise<DevframeScopedClientRpc<"compulsive">> {
  connectionState.value = reconnecting ? "reconnecting" : "connecting";
  let client: DevframeRpcClient | undefined;
  try {
    if (reconnecting) await waitForReconnectHost();
    client = await connectDevframe();
    const previousClient = activeClient;
    stopConnectionStatus?.();
    activeClient = client;
    stopConnectionStatus = client.events.on("connection:status", (status) => {
      if (client !== activeClient) return;
      if (status === "unauthorized") {
        connectionState.value = "failed";
        fatalError.value = describeError(
          client.connectionError ?? "Devframe authorization failed.",
        );
      } else if (status === "disconnected" || status === "error") {
        void reconnect(client.connectionError ?? "Devframe connection closed.").catch(
          () => undefined,
        );
      }
    });
    previousClient?.close?.();
    const rpc = client.scope("compulsive").rpc;
    applyState(await loadState(rpc, reconnecting));
    if (client !== activeClient) throw new Error("Devframe connection was replaced.");
    reconnectAttempt = 0;
    fatalError.value = "";
    connectionState.value = "connected";
    return rpc;
  } catch (error) {
    if (client && client === activeClient) {
      stopConnectionStatus?.();
      stopConnectionStatus = undefined;
      activeClient = undefined;
      client.close?.();
    }
    fatalError.value = describeError(error);
    if (error instanceof DevframeConnectionError && error.kind === "auth") {
      connectionState.value = "failed";
    }
    throw error;
  }
}
function reconnect(error: unknown): Promise<DevframeScopedClientRpc<"compulsive">> {
  if (error instanceof DevframeConnectionError && error.kind === "auth") {
    connectionState.value = "failed";
    fatalError.value = describeError(error);
    return Promise.reject(error);
  }
  if (reconnectPromise) return reconnectPromise;
  connectionState.value = "reconnecting";
  fatalError.value = describeError(error);
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
        if (connectionError instanceof DevframeConnectionError && connectionError.kind === "auth") {
          throw connectionError;
        }
        fatalError.value = describeError(connectionError);
      }
    }
    throw new Error("Devframe connection closed.");
  })();
  reconnectPromise = promise;
  rpcPromise = promise;
  void promise
    .finally(() => {
      if (reconnectPromise === promise) reconnectPromise = undefined;
    })
    .catch(() => undefined);
  return promise;
}
function repositoryFor(member: WorkspaceMember): RepositoryRecord | undefined {
  return state.value.repositories.find((repository) => repository.id === member.repositoryId);
}
function statusFor(member: WorkspaceMember): WorkspaceMemberStatus | undefined {
  return workspaceStatus.value?.members.find(
    (status) => status.repositoryId === member.repositoryId,
  );
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
  const branch = status?.branch ?? member.branch;
  const defaultBranch = status?.defaultBranch?.replace(/^origin\//, "");
  return defaultBranch ? branch !== defaultBranch : branch !== "main" && branch !== "master";
}
function storeWorkspaceStatus(status: WorkspaceStatusResult): void {
  workspaceStatuses.value[status.workspaceId] = status;
  workspaceStatus.value = status;
  workspaceStatusFresh.value = true;
}
async function refresh(preferredWorkspaceId = selectedWorkspaceId.value): Promise<void> {
  const rpc = await rpcPromise;
  applyState(await rpc.call("get-state"), preferredWorkspaceId);
}
async function runAction(
  name: string,
  task: () => Promise<unknown>,
  success: string,
  preferredWorkspaceId?: string,
  refreshStatus = true,
): Promise<boolean> {
  if (busy.value) return false;
  const checkedWorkspaceId = workspaceStatus.value?.workspaceId;
  busyAction.value = name;
  try {
    await task();
    await refresh(preferredWorkspaceId);
    if (refreshStatus && checkedWorkspaceId === selectedWorkspaceId.value) {
      await refreshWorkspaceStatus(false);
    }
    feedback.value = { title: success, message: "操作已安全完成。", error: false };
    return true;
  } catch (error) {
    if (refreshStatus && checkedWorkspaceId === selectedWorkspaceId.value) {
      await refreshWorkspaceStatus(false);
    }
    feedback.value = { title: `${name}失败`, message: describeError(error), error: true };
    return false;
  } finally {
    busyAction.value = "";
  }
}
async function createWorkspace(): Promise<void> {
  const name = newWorkspaceName.value.trim();
  if (!name) return;
  const rpc = await rpcPromise;
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
    newWorkspaceName.value = "";
    showCreate.value = false;
  }
}
async function copyCommand(workspace: DevtoolWorkspace): Promise<void> {
  try {
    await navigator.clipboard.writeText(workspace.cdCommand);
    feedback.value = { title: "已复制 cd 命令", message: workspace.cdCommand, error: false };
  } catch (error) {
    feedback.value = { title: "复制失败", message: describeError(error), error: true };
  }
}
async function syncWorkspace(workspace: DevtoolWorkspace): Promise<void> {
  const rpc = await rpcPromise;
  await runAction(
    "同步 Workspace",
    () => rpc.call("sync-workspace", { workspaceId: workspace.id }),
    "Workspace 已同步",
    workspace.id,
  );
}
async function refreshWorkspaceStatus(fetchRemote = true): Promise<void> {
  const workspaceId = selectedWorkspaceId.value;
  if (!workspaceId || (statusLoading.value && statusWorkspaceId === workspaceId)) return;
  const requestId = ++statusRequestId;
  statusWorkspaceId = workspaceId;
  statusLoading.value = true;
  try {
    const rpc = await rpcPromise;
    const result = await rpc.call("get-workspace-status", {
      workspaceId,
      fetchRemote,
    });
    if (requestId === statusRequestId && selectedWorkspaceId.value === workspaceId) {
      storeWorkspaceStatus(result);
    }
  } catch (error) {
    if (requestId === statusRequestId) {
      feedback.value = { title: "状态刷新失败", message: describeError(error), error: true };
    }
  } finally {
    if (requestId === statusRequestId) statusLoading.value = false;
  }
}
async function openMemberInVscode(
  workspace: DevtoolWorkspace,
  member: WorkspaceMember,
): Promise<void> {
  const rpc = await rpcPromise;
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
function openPromoteReference(
  workspace: DevtoolWorkspace,
  member: Extract<WorkspaceMember, { mode: "worktree" }>,
): void {
  promoteMember.value = member;
  promoteBranch.value = member.detached
    ? `workspace/${workspace.name}/${member.alias}`
    : member.branch;
  promoteError.value = "";
  promoteOpen.value = true;
}
function closePromoteReference(): void {
  if (!busy.value) promoteOpen.value = false;
}
async function submitPromoteReference(): Promise<void> {
  const workspace = currentWorkspace.value;
  const member = promoteMember.value;
  const branch = promoteBranch.value.trim();
  if (!workspace || !member || !branch || busy.value) return;
  const rpc = await rpcPromise;
  promoteError.value = "";
  const succeeded = await runAction(
    member.detached ? "转为开发分支" : "切换开发分支",
    () =>
      rpc.call("switch-workspace-member-branch", {
        workspaceId: workspace.id,
        repositoryId: member.repositoryId,
        branch,
      }),
    member.detached ? `已将 ${member.alias} 转为开发分支` : `已切换 ${member.alias} 的分支`,
    workspace.id,
  );
  if (succeeded) {
    promoteOpen.value = false;
  } else promoteError.value = feedback.value?.message ?? "转换失败";
}
function canRebase(member: WorkspaceMember): boolean {
  const status = statusFor(member);
  return Boolean(
    workspaceStatusFresh.value &&
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
    workspaceStatusFresh.value &&
    member.mode === "worktree" &&
    !member.detached &&
    status?.unpushed &&
    !status.changes.length &&
    !status.conflicts.length,
  );
}
async function rebaseMember(workspace: DevtoolWorkspace, member: WorkspaceMember): Promise<void> {
  const rpc = await rpcPromise;
  await runAction(
    member.mode === "worktree" && member.detached ? "更新参考代码" : "Rebase 主分支",
    () =>
      rpc.call("rebase-workspace-member", {
        workspaceId: workspace.id,
        repositoryId: member.repositoryId,
      }),
    member.mode === "worktree" && member.detached
      ? `已拉取 ${member.alias} 的最新主分支`
      : `已更新 ${member.alias}`,
    workspace.id,
  );
}
async function pushMember(workspace: DevtoolWorkspace, member: WorkspaceMember): Promise<void> {
  const rpc = await rpcPromise;
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
  const rpc = await rpcPromise;
  await runAction(
    "打开 ChatGPT",
    () => rpc.call("open-workspace-in-chatgpt", { workspaceId: workspace.id }),
    "已在 ChatGPT 中打开",
    workspace.id,
    false,
  );
}
async function addMember(workspace: DevtoolWorkspace): Promise<void> {
  const repository = availableRepositories.value.find(
    (item) => item.id === selectedRepositoryId.value,
  );
  if (!repository) return;
  const rpc = await rpcPromise;
  const succeeded = await runAction(
    "添加仓库",
    () =>
      rpc.call("add-workspace-member", {
        workspaceId: workspace.id,
        repositoryId: repository.id,
        ...(alias.value.trim() ? { alias: alias.value.trim() } : {}),
        ...(branch.value.trim() ? { branch: branch.value.trim() } : {}),
        createBranch: createBranch.value,
      }),
    `已添加 ${repository.name}`,
    workspace.id,
  );
  if (succeeded) showAdd.value = false;
}
function openClone(): void {
  cloneSourceId.value = currentWorkspace.value?.id ?? state.value.workspaces[0]?.id ?? "";
  cloneTargetName.value = "";
  cloneBranchName.value = "";
  cloneBranchCustomized.value = false;
  cloneError.value = "";
  cloneRepositoryQuery.value = "";
  cloneSelectedIds.value = cloneSource.value?.members.map((member) => member.repositoryId) ?? [];
  cloneReferenceIds.value = [];
  cloneOpen.value = true;
}
function closeClone(): void {
  if (!busy.value) cloneOpen.value = false;
}
function toggleCloneRepository(id: string): void {
  if (cloneSelectedIds.value.includes(id)) {
    cloneSelectedIds.value = cloneSelectedIds.value.filter((selected) => selected !== id);
    cloneReferenceIds.value = cloneReferenceIds.value.filter((reference) => reference !== id);
  } else cloneSelectedIds.value = [...cloneSelectedIds.value, id];
}
function toggleAllCloneRepositories(): void {
  const allIds = cloneSourceMembers.value.map(({ member }) => member.repositoryId);
  if (cloneSelectedIds.value.length === allIds.length) {
    cloneSelectedIds.value = [];
    cloneReferenceIds.value = [];
  } else cloneSelectedIds.value = allIds;
}
function toggleCloneReference(id: string): void {
  cloneReferenceIds.value = cloneReferenceIds.value.includes(id)
    ? cloneReferenceIds.value.filter((reference) => reference !== id)
    : [...cloneReferenceIds.value, id];
}
async function submitClone(): Promise<void> {
  if (!cloneCanSubmit.value) return;
  const rpc = await rpcPromise;
  cloneError.value = "";
  busyAction.value = "克隆 Workspace";
  try {
    const workspace = await rpc.call("clone-workspace", {
      sourceWorkspaceId: cloneSourceId.value,
      name: cloneTargetName.value.trim(),
      repositoryIds: cloneSelectedIds.value,
      ...(cloneDevelopmentCount.value > 0 ? { branchName: cloneBranchName.value.trim() } : {}),
      referenceRepositoryIds: cloneReferenceIds.value,
    });
    await refresh(workspace.id);
    feedback.value = {
      title: "Workspace 克隆完成",
      message: `已创建 ${cloneDevelopmentCount.value} 个开发分支和 ${cloneReferenceIds.value.length} 个参考 worktree。`,
      error: false,
    };
    cloneOpen.value = false;
  } catch (error) {
    cloneError.value = describeError(error);
    feedback.value = { title: "克隆失败", message: cloneError.value, error: true };
  } finally {
    busyAction.value = "";
  }
}
function openDeleteWorkspace(workspace: DevtoolWorkspace): void {
  confirmState.value = {
    title: `删除 ${workspace.name}？`,
    message:
      "将删除 Workspace、其干净的 worktree，以及磁盘上的整个 Workspace 目录。ChatGPT 暂无项目删除接口，如已添加需在应用中手动移除。",
    warning: "目录内所有文件都会永久删除；未提交的 worktree 改动会阻止删除。",
    confirmLabel: "永久删除",
    action: "delete-workspace",
    workspace,
  };
  confirmOpen.value = true;
}
function openRemoveMember(workspace: DevtoolWorkspace, member: WorkspaceMember): void {
  confirmState.value = {
    title: `移除 ${member.alias}？`,
    message: `将从 ${workspace.name} 移除该成员；未提交的改动会阻止操作。`,
    action: "remove-member",
    workspace,
    member,
  };
  confirmOpen.value = true;
}
function openConvertToReference(
  workspace: DevtoolWorkspace,
  member: Extract<WorkspaceMember, { mode: "worktree" }>,
): void {
  confirmState.value = {
    title: `将 ${member.alias} 转为参考？`,
    message: `worktree 将切换到最新远端主分支的 detached HEAD；本地分支 ${member.branch} 会保留。`,
    warning: "存在未提交改动时会阻止转换，不会强制覆盖文件。",
    confirmLabel: "转为参考",
    action: "convert-to-reference",
    workspace,
    member,
  };
  confirmOpen.value = true;
}
async function confirmAction(): Promise<void> {
  const pending = confirmState.value;
  if (!pending || busy.value) return;
  confirmOpen.value = false;
  const rpc = await rpcPromise;
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

rpcPromise = connectRpc().catch((error) => reconnect(error));

onMounted(async () => {
  try {
    await rpcPromise;
  } catch (error) {
    connectionState.value = "failed";
    fatalError.value = describeError(error);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
  wakeReconnectDelay?.();
  stopConnectionStatus?.();
  activeClient?.close?.();
});
</script>

<template>
  <div class="app-shell">
    <header class="topbar">
      <div class="brand">
        <span class="i-ph-git-branch-duotone brand-mark" /><strong>Compulsive</strong
        ><span class="brand-divider" /><span>Workspace DevTool</span>
      </div>
      <div class="connection" :class="connectionState" role="status" aria-live="polite">
        <span
          :class="connectionState !== 'connected' || busyAction ? 'spinner' : 'connection-dot'"
        />{{
          connectionState === "failed"
            ? "连接失败"
            : connectionState === "reconnecting"
              ? "正在重连"
              : connectionState === "connecting"
                ? "正在连接"
                : busyAction || "已连接"
        }}
      </div>
    </header>

    <main class="workspace-layout" :aria-busy="busy">
      <aside class="workspace-sidebar" aria-label="Workspace 索引">
        <div class="sidebar-title">
          <h1>Workspace</h1>
          <ActionIconButton
            icon="i-ph-plus"
            tooltip="新建 Workspace"
            @click="showCreate = !showCreate"
          />
        </div>
        <form v-if="showCreate" class="create-row" @submit.prevent="createWorkspace">
          <FormTextInput
            v-model="newWorkspaceName"
            icon="i-ph-folder-plus"
            placeholder="Workspace 名称"
          >
            <template #prefix><span class="sr-only">Workspace 名称</span></template>
          </FormTextInput>
          <ActionButton variant="primary" type="submit" :disabled="busy">创建</ActionButton>
        </form>
        <FormTextInput
          v-model="workspaceQuery"
          type="search"
          icon="i-ph-magnifying-glass"
          clearable
          placeholder="搜索 Workspace"
        />
        <nav class="workspace-list" aria-label="Workspace">
          <button
            v-for="workspace in filteredWorkspaces"
            :key="workspace.id"
            class="workspace-item"
            :class="{ selected: workspace.id === selectedWorkspaceId }"
            type="button"
            :aria-current="workspace.id === selectedWorkspaceId ? 'page' : undefined"
            @click="selectedWorkspaceId = workspace.id"
          >
            <span class="i-ph-folder-duotone workspace-icon" /><span class="workspace-copy"
              ><strong>{{ workspace.name }}</strong
              ><small>{{ workspace.members.length }} 名成员</small></span
            >
          </button>
          <div v-if="!filteredWorkspaces.length" class="empty compact">
            <span class="i-ph-folder-dashed" />没有匹配项
          </div>
        </nav>
        <div class="root-note">
          <span class="i-ph-hard-drives-duotone" /><span
            ><small>本地根目录</small><code>{{ state.config?.workspaceRoot || "—" }}</code></span
          >
        </div>
      </aside>

      <section class="workspace-content">
        <div v-if="connectionState === 'failed'" class="feedback-card error" role="alert">
          <strong>无法连接 Devframe</strong>
          <p>{{ fatalError }}</p>
        </div>
        <div v-else-if="connectionState !== 'connected' && !currentWorkspace" class="empty page">
          <span class="spinner large" /><strong>{{
            connectionState === "reconnecting" ? "正在重新连接 Devframe" : "正在读取 Workspace"
          }}</strong>
          <p v-if="fatalError">{{ fatalError }}</p>
        </div>
        <div v-else-if="!currentWorkspace" class="empty page">
          <span class="i-ph-folders-duotone" /><strong>还没有 Workspace</strong>
          <p>使用左侧加号创建第一个 Workspace。</p>
        </div>
        <template v-else>
          <div class="content-heading">
            <div class="heading-copy">
              <p>工作空间 <span>/</span> {{ currentWorkspace.name }}</p>
              <h2>{{ currentWorkspace.name }}</h2>
              <code>{{ currentWorkspace.absolutePath }}</code>
            </div>
            <div class="heading-actions">
              <ActionButton icon="i-ph-copy" @click="copyCommand(currentWorkspace)">
                复制路径
              </ActionButton>
              <ActionButton
                icon="i-ph-arrows-clockwise"
                :disabled="busy"
                @click="syncWorkspace(currentWorkspace)"
              >
                修复链接
              </ActionButton>
              <ActionButton
                icon="i-ph-open-ai-logo"
                :disabled="busy"
                @click="openWorkspaceInChatgpt(currentWorkspace)"
              >
                在 ChatGPT 中打开
              </ActionButton>
              <ActionButton
                variant="primary"
                icon="i-ph-plus"
                :disabled="!currentWorkspace.members.length || busy"
                @click="openClone"
              >
                克隆 Workspace
              </ActionButton>
              <ActionIconButton
                icon="i-ph-trash"
                tooltip="删除 Workspace"
                @click="openDeleteWorkspace(currentWorkspace)"
              />
            </div>
          </div>

          <div class="content-grid">
            <section class="repository-panel">
              <div class="section-tabs">
                <strong
                  >仓库 <span>{{ currentWorkspace.members.length }}</span></strong
                >
              </div>
              <div class="repository-card">
                <div class="repository-card-heading">
                  <h3>仓库</h3>
                  <div class="repository-heading-actions">
                    <small>
                      {{
                        workspaceStatus
                          ? `${new Date(workspaceStatus.checkedAt).toLocaleTimeString()} ${
                              workspaceStatusFresh ? "已检查" : "缓存状态"
                            }`
                          : "尚未检查"
                      }}
                    </small>
                    <ActionButton
                      icon="i-ph-magnifying-glass"
                      :loading="statusLoading"
                      :disabled="statusLoading"
                      @click="refreshWorkspaceStatus()"
                    >
                      检查状态
                    </ActionButton>
                    <ActionButton icon="i-ph-plus" @click="showAdd = !showAdd">
                      添加仓库
                    </ActionButton>
                  </div>
                </div>
                <form v-if="showAdd" class="add-form" @submit.prevent="addMember(currentWorkspace)">
                  <label class="add-repository-field">
                    <span>仓库</span>
                    <FormCombobox
                      v-model="selectedRepositoryPath"
                      class="w-full"
                      :options="repositoryOptions"
                      :disabled="!availableRepositories.length"
                      placeholder="搜索仓库"
                    >
                      <template #option="{ option }">
                        <span class="combobox-option"
                          ><span class="i-ph-git-branch" />{{ option.label }}</span
                        >
                      </template>
                      <template #empty>没有匹配的仓库</template>
                    </FormCombobox>
                  </label>
                  <div class="form-field">
                    <span>目录别名</span>
                    <FormTextInput v-model="alias" placeholder="默认使用仓库名">
                      <template #prefix><span class="sr-only">目录别名</span></template>
                    </FormTextInput>
                  </div>
                  <div class="form-field">
                    <span>分支</span>
                    <FormTextInput
                      v-model="branch"
                      icon="i-ph-git-branch"
                      placeholder="例如 feat/workspace-task"
                    >
                      <template #prefix><span class="sr-only">分支</span></template>
                    </FormTextInput>
                  </div>
                  <FormCheckbox v-model="createBranch" class="checkbox" :disabled="!branch.trim()"
                    >新建或跟踪远端同名分支；取消勾选则使用已有本地分支</FormCheckbox
                  >
                  <ActionButton
                    class="add-submit"
                    variant="primary"
                    type="submit"
                    :disabled="!selectedRepositoryId || !branch.trim() || busy"
                  >
                    加入 Workspace
                  </ActionButton>
                </form>
                <div v-if="currentWorkspace.members.length" class="repository-table">
                  <div class="table-head">
                    <span>仓库</span><span>分支</span><span>本地状态</span><span>类型</span
                    ><span>操作</span>
                  </div>
                  <article
                    v-for="member in currentWorkspace.members"
                    :key="member.repositoryId"
                    class="repository-row"
                  >
                    <div class="repository-name">
                      <span class="i-ph-git-branch-duotone" /><span
                        ><strong>{{ member.alias }}</strong
                        ><small>{{
                          repositoryFor(member)?.classificationPath ?? member.repositoryId
                        }}</small></span
                      >
                    </div>
                    <div
                      class="repository-branch"
                      :class="{ 'non-default': isNonDefaultBranch(member) }"
                    >
                      <code>{{
                        statusFor(member)?.branch ??
                        (member.mode === "worktree"
                          ? member.detached
                            ? `参考 · ${member.branch}`
                            : member.branch
                          : "—")
                      }}</code
                      ><span v-if="isNonDefaultBranch(member)" class="branch-marker">非主分支</span>
                    </div>
                    <div class="branch-health">
                      <span v-if="statusFor(member)?.conflicts.length" class="health-chip conflict"
                        >{{ statusFor(member)!.conflicts.length }} 个冲突</span
                      >
                      <span
                        v-if="statusFor(member)?.comparisonError"
                        class="health-chip warning"
                        :title="statusFor(member)?.comparisonError"
                        ><span class="i-ph-warning-circle" />无法比较</span
                      ><template v-else-if="statusFor(member)">
                        <span
                          v-if="statusFor(member)!.mergedIntoDefault"
                          class="health-chip merged"
                          title="远端开发分支的最新提交已包含在主分支中"
                          ><span class="i-ph-check-circle-fill" />{{
                            isTaskComplete(member)
                              ? "已合入主分支 · 可开启新 Workspace"
                              : "远端已合入 · 本地仍有改动"
                          }}</span
                        >
                        <span v-if="statusFor(member)!.behind" class="health-chip behind"
                          >↓ {{ statusFor(member)!.behind }} 落后
                          {{ statusFor(member)!.defaultBranch }}</span
                        ><span v-if="statusFor(member)!.ahead" class="health-chip ahead"
                          >↑ {{ statusFor(member)!.ahead }} 领先
                          {{ statusFor(member)!.defaultBranch }}</span
                        ><span v-if="statusFor(member)!.unpushed" class="health-chip push"
                          ><span class="i-ph-cloud-arrow-up" />{{
                            statusFor(member)!.unpushed
                          }}
                          未推送</span
                        ><span
                          v-if="!statusFor(member)!.ahead && !statusFor(member)!.behind"
                          class="health-chip clean"
                          ><span class="i-ph-check" />已同步
                          {{ statusFor(member)!.defaultBranch }}</span
                        ><span
                          class="health-chip"
                          :class="{ dirty: statusFor(member)!.changes.length }"
                          >{{
                            statusFor(member)!.changes.length
                              ? `${statusFor(member)!.changes.length} 项未提交`
                              : "工作区干净"
                          }}</span
                        ></template
                      ><span v-else class="health-chip">点击检查</span>
                    </div>
                    <span class="mode-badge">{{
                      member.mode === "worktree" && member.detached ? "reference" : member.mode
                    }}</span>
                    <div class="repository-actions">
                      <ActionIconButton
                        :class="{ 'conflict-action': statusFor(member)?.conflicts.length }"
                        :tooltip="
                          statusFor(member)?.conflicts.length
                            ? '在 VS Code 中解决冲突'
                            : '在 VS Code 中打开'
                        "
                        :icon="
                          statusFor(member)?.conflicts.length
                            ? 'i-ph-warning-octagon-fill'
                            : 'i-ph-code'
                        "
                        @click="openMemberInVscode(currentWorkspace, member)"
                      />
                      <ActionIconButton
                        v-if="canRebase(member)"
                        :tooltip="
                          member.mode === 'worktree' && member.detached
                            ? '拉取最新主分支'
                            : 'Rebase 远端主分支'
                        "
                        :icon="
                          member.mode === 'worktree' && member.detached
                            ? 'i-ph-cloud-arrow-down'
                            : 'i-ph-git-merge'
                        "
                        :disabled="busy"
                        @click="rebaseMember(currentWorkspace, member)"
                      />
                      <ActionIconButton
                        v-if="canPush(member)"
                        tooltip="Rebase 同名远端分支并 Push"
                        icon="i-ph-cloud-arrow-up"
                        :disabled="busy"
                        @click="pushMember(currentWorkspace, member)"
                      />
                      <ActionIconButton
                        v-if="member.mode === 'worktree'"
                        :tooltip="member.detached ? '转为开发分支' : '切换开发分支'"
                        icon="i-ph-git-branch"
                        @click="openPromoteReference(currentWorkspace, member)"
                      />
                      <ActionIconButton
                        v-if="member.mode === 'worktree' && !member.detached"
                        tooltip="转为参考"
                        icon="i-ph-book-open-text"
                        @click="openConvertToReference(currentWorkspace, member)"
                      />
                      <ActionIconButton
                        tooltip="移出 Workspace"
                        icon="i-ph-x"
                        @click="openRemoveMember(currentWorkspace, member)"
                      />
                    </div>
                    <details v-if="statusFor(member)?.changes.length" class="working-tree-changes">
                      <summary>查看 {{ statusFor(member)!.changes.length }} 项未提交变更</summary>
                      <code v-for="change in statusFor(member)!.changes" :key="change">{{
                        change
                      }}</code>
                    </details>
                  </article>
                </div>
                <div v-else class="empty repository-empty">
                  <span class="i-ph-folder-open-duotone" /><strong>还没有仓库</strong>
                  <p>添加已有仓库，开始组织工作区。</p>
                  <ActionButton icon="i-ph-plus" @click="showAdd = true">添加仓库</ActionButton>
                </div>
              </div>
            </section>

            <aside class="workspace-info">
              <section>
                <h3>工作区信息</h3>
                <dl>
                  <div>
                    <dt>路径</dt>
                    <dd>
                      <code>{{ currentWorkspace.absolutePath }}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>成员数量</dt>
                    <dd>{{ currentWorkspace.members.length }}</dd>
                  </div>
                  <div>
                    <dt>类型</dt>
                    <dd>worktree / link</dd>
                  </div>
                  <div>
                    <dt>说明</dt>
                    <dd>每个 worktree 保持独立分支</dd>
                  </div>
                </dl>
              </section>
              <section>
                <h3>快捷操作</h3>
                <ActionButton
                  class="quick-action"
                  icon="i-ph-terminal-window"
                  @click="copyCommand(currentWorkspace)"
                  >复制 cd 命令</ActionButton
                >
              </section>
              <section
                v-if="feedback"
                class="feedback-card"
                :class="{ error: feedback.error }"
                :role="feedback.error ? 'alert' : 'status'"
              >
                <ActionIconButton
                  class="feedback-close"
                  icon="i-ph-x"
                  tooltip="关闭反馈"
                  @click="feedback = undefined"
                />
                <span :class="feedback.error ? 'i-ph-x-circle-fill' : 'i-ph-check-circle-fill'" />
                <div>
                  <strong>{{ feedback.title }}</strong>
                  <p>{{ feedback.message }}</p>
                </div>
              </section>
            </aside>
          </div>
        </template>
      </section>
    </main>

    <footer class="statusbar">
      <span><span class="i-ph-terminal-window" /> <i /> 本地运行</span
      ><span>{{ currentWorkspace?.members.length ?? 0 }} 个仓库</span>
    </footer>

    <OverlayModal
      v-model:open="promoteOpen"
      :title="promoteMember?.detached ? '转为开发分支' : '切换开发分支'"
      :description="`${promoteMember?.alias ?? ''} 将继续使用当前 worktree，不复制文件`"
    >
      <form id="promote-form" class="modal-form" @submit.prevent="submitPromoteReference">
        <div class="field">
          <span>开发分支名称</span>
          <FormTextInput
            v-model="promoteBranch"
            icon="i-ph-git-branch"
            placeholder="例如 feat/workspace-task"
          >
            <template #prefix><span class="sr-only">开发分支名称</span></template>
          </FormTextInput>
          <small
            ><span class="i-ph-git-branch" />已有本地分支直接切换；仅远端存在时自动跟踪；否则从当前
            HEAD 创建</small
          >
        </div>
        <div class="origin-note">
          <span class="i-ph-lightning" />
          <div>
            <strong>原位切换</strong>
            <p>保留当前目录；已有分支不会重建。若它也在其他 worktree 打开，请勿两处同时提交。</p>
          </div>
        </div>
        <div v-if="promoteError" class="inline-error" role="alert">
          <strong>切换失败</strong>
          <p>{{ promoteError }}</p>
        </div>
      </form>
      <template #footer>
        <span class="modal-footer-note">已有同名本地分支时直接切换，不覆盖提交。</span>
        <ActionButton :disabled="busy" @click="closePromoteReference">取消</ActionButton>
        <ActionButton
          variant="primary"
          type="submit"
          form="promote-form"
          :loading="busyAction === '切换开发分支' || busyAction === '转为开发分支'"
          :disabled="!promoteBranch.trim() || busy"
          >{{ promoteMember?.detached ? "转为开发分支" : "切换开发分支" }}</ActionButton
        >
      </template>
    </OverlayModal>

    <OverlayModal
      v-model:open="cloneOpen"
      title="克隆 Workspace"
      description="选择仓库，创建独立工作区"
    >
      <form id="clone-form" class="modal-form clone-form" @submit.prevent="submitClone">
        <label class="field">
          <span>源 Workspace</span>
          <FormCombobox
            v-model="cloneSourceName"
            class="w-full"
            :options="cloneSourceOptions"
            placeholder="搜索 Workspace"
          >
            <template #option="{ option }">
              <span class="combobox-option"><span class="i-ph-folder" />{{ option.label }}</span>
            </template>
            <template #empty>没有匹配的 Workspace</template>
          </FormCombobox>
        </label>
        <div class="field">
          <span>目标名称</span>
          <FormTextInput
            v-model="cloneTargetName"
            icon="i-ph-folder"
            placeholder="例如 ruyi-feature"
          >
            <template #prefix><span class="sr-only">目标名称</span></template>
          </FormTextInput>
          <small><span class="i-ph-folder" />{{ cloneTargetPath }}</small>
        </div>
        <div class="field">
          <span>开发分支名称</span>
          <FormTextInput
            v-model="cloneBranchName"
            icon="i-ph-git-branch"
            :disabled="cloneDevelopmentCount === 0"
            placeholder="例如 feat/ruyi-feature"
            @update:model-value="cloneBranchCustomized = true"
          >
            <template #prefix><span class="sr-only">开发分支名称</span></template>
          </FormTextInput>
          <small
            ><span class="i-ph-git-branch" />{{
              cloneDevelopmentCount
                ? `${cloneDevelopmentCount} 个开发仓库使用此分支名`
                : "所选仓库均为参考模式，不会新建分支"
            }}</small
          >
        </div>
        <div class="origin-note">
          <span class="i-ph-git-branch-duotone" />
          <div>
            <strong>优先跟踪远端同名分支</strong>
            <p>同名分支不存在时从远端默认分支创建；参考仓库仍使用 detached HEAD。</p>
          </div>
        </div>
        <div class="repository-picker-heading">
          <span>选择仓库</span>
          <span>已选 {{ cloneSelectedIds.length }} / {{ cloneSourceMembers.length }}</span>
        </div>
        <div class="picker-search-row">
          <FormTextInput
            v-model="cloneRepositoryQuery"
            type="search"
            icon="i-ph-magnifying-glass"
            clearable
            placeholder="搜索仓库名称"
          />
          <ActionButton type="button" @click="toggleAllCloneRepositories">
            {{ cloneSelectedIds.length === cloneSourceMembers.length ? "取消全选" : "全选" }}
          </ActionButton>
        </div>
        <div class="repository-picker">
          <div
            v-for="{ member, repository } in filteredCloneMembers"
            :key="member.repositoryId"
            class="repository-picker-row"
          >
            <FormCheckbox
              class="repository-choice"
              :model-value="cloneSelectedIds.includes(member.repositoryId)"
              @update:model-value="toggleCloneRepository(member.repositoryId)"
            >
              <span class="i-ph-git-branch" />
              <span class="repository-choice-copy">
                <strong>{{ member.alias }}</strong>
                <code>{{ repository?.classificationPath }}</code>
              </span>
            </FormCheckbox>
            <ActionButton
              class="repository-mode"
              type="button"
              :class="{ reference: cloneReferenceIds.includes(member.repositoryId) }"
              size="sm"
              :icon="
                cloneReferenceIds.includes(member.repositoryId)
                  ? 'i-ph-book-open-text'
                  : 'i-ph-git-branch'
              "
              :disabled="!cloneSelectedIds.includes(member.repositoryId)"
              :aria-pressed="cloneReferenceIds.includes(member.repositoryId)"
              :aria-label="`${member.alias}：${
                cloneReferenceIds.includes(member.repositoryId) ? '仅作参考' : '创建开发分支'
              }`"
              @click="toggleCloneReference(member.repositoryId)"
              >{{
                cloneReferenceIds.includes(member.repositoryId) ? "仅作参考" : "开发分支"
              }}</ActionButton
            >
          </div>
          <div v-if="!filteredCloneMembers.length" class="empty compact">没有匹配的仓库</div>
        </div>
        <div v-if="busyAction === '克隆 Workspace'" class="clone-progress" role="status">
          <span class="spinner" />
          <span
            ><strong>正在获取远端默认分支</strong
            ><small>正在创建所选仓库的隔离 worktree…</small></span
          >
        </div>
        <div v-if="cloneError" class="inline-error" role="alert">
          <strong>克隆失败</strong>
          <p>{{ cloneError }}</p>
        </div>
      </form>
      <template #footer>
        <span class="modal-footer-note">
          {{ cloneDevelopmentCount }} 个开发分支 · {{ cloneReferenceIds.length }} 个仅参考
        </span>
        <ActionButton :disabled="busy" @click="closeClone">取消</ActionButton>
        <ActionButton
          variant="primary"
          type="submit"
          form="clone-form"
          :loading="busyAction === '克隆 Workspace'"
          :disabled="!cloneCanSubmit"
          >克隆 {{ cloneSelectedIds.length }} 个仓库</ActionButton
        >
      </template>
    </OverlayModal>

    <OverlayModal v-if="confirmState" v-model:open="confirmOpen" :title="confirmState.title">
      <div class="confirm-copy">
        <p>{{ confirmState.message }}</p>
        <div class="warning-note">
          <span class="i-ph-warning" />{{
            confirmState.warning ?? "未提交的改动会阻止删除，数据不会被强制丢弃。"
          }}
        </div>
      </div>
      <template #footer>
        <ActionButton @click="confirmOpen = false">取消</ActionButton>
        <ActionButton
          :variant="confirmState.action === 'convert-to-reference' ? 'primary' : 'action'"
          :class="{ 'danger-action': confirmState.action !== 'convert-to-reference' }"
          :loading="busy"
          @click="confirmAction"
          >{{ confirmState.confirmLabel ?? "确认删除" }}</ActionButton
        >
      </template>
    </OverlayModal>
  </div>
</template>
