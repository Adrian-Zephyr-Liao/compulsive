<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { connectDevframe } from "devframe/client";

import type { DevtoolState, DevtoolWorkspace } from "../devtool.js";
import type {
  RepositoryRecord,
  WorkspaceMember,
  WorkspaceMemberStatus,
  WorkspaceStatusResult,
} from "../types.js";
import ActionIconButton from "./ActionIconButton.vue";

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
const addRepositoryOpen = ref(false);
const addRepositoryQuery = ref("");
const alias = ref("");
const branch = ref("");
const createBranch = ref(true);
const busyAction = ref("");
const connectionState = ref<"connecting" | "connected" | "failed">("connecting");
const fatalError = ref("");
const feedback = ref<{ title: string; message: string; error: boolean }>();

const cloneDialog = ref<HTMLDialogElement>();
const confirmDialog = ref<HTMLDialogElement>();
const promoteDialog = ref<HTMLDialogElement>();
const cloneSourceId = ref("");
const cloneSourceOpen = ref(false);
const cloneSourceQuery = ref("");
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
let returnFocus: HTMLElement | null = null;
let statusRequestId = 0;
let statusWorkspaceId: string | undefined;

const rpcPromise = connectDevframe().then((client) => client.scope("compulsive").rpc);
const busy = computed(() => Boolean(busyAction.value));
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
const selectedRepository = computed(() =>
  availableRepositories.value.find((repository) => repository.id === selectedRepositoryId.value),
);
const filteredAvailableRepositories = computed(() => {
  const query = addRepositoryQuery.value.trim().toLowerCase();
  return availableRepositories.value.filter((repository) =>
    [repository.name, repository.classificationPath].some((value) =>
      value.toLowerCase().includes(query),
    ),
  );
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
const filteredCloneSources = computed(() => {
  const query = cloneSourceQuery.value.trim().toLowerCase();
  return state.value.workspaces.filter((workspace) =>
    [workspace.name, workspace.absolutePath].some((value) => value.toLowerCase().includes(query)),
  );
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
  addRepositoryOpen.value = false;
  addRepositoryQuery.value = "";
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
  cloneSourceOpen.value = false;
  cloneSourceQuery.value = "";
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
function repositoryFor(member: WorkspaceMember): RepositoryRecord | undefined {
  return state.value.repositories.find((repository) => repository.id === member.repositoryId);
}
function statusFor(member: WorkspaceMember): WorkspaceMemberStatus | undefined {
  return workspaceStatus.value?.members.find(
    (status) => status.repositoryId === member.repositoryId,
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
function rememberFocus(): void {
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
}
function restoreFocus(): void {
  nextTick(() => returnFocus?.focus());
}
async function refresh(preferredWorkspaceId = selectedWorkspaceId.value): Promise<void> {
  const rpc = await rpcPromise;
  state.value = await rpc.call("get-state");
  workspaceStatuses.value = Object.fromEntries(
    state.value.workspaceStatuses.map((status) => [status.workspaceId, status]),
  );
  selectedWorkspaceId.value = state.value.workspaces.some(
    (workspace) => workspace.id === preferredWorkspaceId,
  )
    ? preferredWorkspaceId
    : state.value.workspaces[0]?.id;
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
  rememberFocus();
  promoteMember.value = member;
  promoteBranch.value = `workspace/${workspace.name}/${member.alias}`;
  promoteError.value = "";
  promoteDialog.value?.showModal();
  nextTick(() => document.querySelector<HTMLInputElement>("#promote-branch")?.focus());
}
function closePromoteReference(): void {
  if (!busy.value) promoteDialog.value?.close();
}
async function submitPromoteReference(): Promise<void> {
  const workspace = currentWorkspace.value;
  const member = promoteMember.value;
  const branch = promoteBranch.value.trim();
  if (!workspace || !member || !branch || busy.value) return;
  const rpc = await rpcPromise;
  promoteError.value = "";
  const succeeded = await runAction(
    "切换开发分支",
    () =>
      rpc.call("promote-workspace-reference", {
        workspaceId: workspace.id,
        repositoryId: member.repositoryId,
        branch,
      }),
    `已将 ${member.alias} 转为开发分支`,
    workspace.id,
  );
  if (succeeded) {
    promoteDialog.value?.close();
  } else promoteError.value = feedback.value?.message ?? "转换失败";
}
function canRebase(member: WorkspaceMember): boolean {
  const status = statusFor(member);
  return Boolean(
    workspaceStatusFresh.value &&
    member.mode === "worktree" &&
    !member.detached &&
    status &&
    !status.comparisonError &&
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
    "Rebase 主分支",
    () =>
      rpc.call("rebase-workspace-member", {
        workspaceId: workspace.id,
        repositoryId: member.repositoryId,
      }),
    `已更新 ${member.alias}`,
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
  rememberFocus();
  cloneSourceId.value = currentWorkspace.value?.id ?? state.value.workspaces[0]?.id ?? "";
  cloneTargetName.value = "";
  cloneBranchName.value = "";
  cloneBranchCustomized.value = false;
  cloneError.value = "";
  cloneRepositoryQuery.value = "";
  cloneSelectedIds.value = cloneSource.value?.members.map((member) => member.repositoryId) ?? [];
  cloneReferenceIds.value = [];
  cloneDialog.value?.showModal();
  nextTick(() => document.querySelector<HTMLInputElement>("#clone-name")?.focus());
}
function closeClone(): void {
  if (!busy.value) cloneDialog.value?.close();
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
    cloneDialog.value?.close();
  } catch (error) {
    cloneError.value = describeError(error);
    feedback.value = { title: "克隆失败", message: cloneError.value, error: true };
  } finally {
    busyAction.value = "";
  }
}
function openDeleteWorkspace(workspace: DevtoolWorkspace): void {
  rememberFocus();
  confirmState.value = {
    title: `删除 ${workspace.name}？`,
    message:
      "将移除 Workspace 及其干净的 worktree；未提交的改动会阻止删除。ChatGPT 暂无项目删除接口，如已添加需在应用中手动移除。",
    action: "delete-workspace",
    workspace,
  };
  confirmDialog.value?.showModal();
}
function openRemoveMember(workspace: DevtoolWorkspace, member: WorkspaceMember): void {
  rememberFocus();
  confirmState.value = {
    title: `移除 ${member.alias}？`,
    message: `将从 ${workspace.name} 移除该成员；未提交的改动会阻止操作。`,
    action: "remove-member",
    workspace,
    member,
  };
  confirmDialog.value?.showModal();
}
function openConvertToReference(
  workspace: DevtoolWorkspace,
  member: Extract<WorkspaceMember, { mode: "worktree" }>,
): void {
  rememberFocus();
  confirmState.value = {
    title: `将 ${member.alias} 转为参考？`,
    message: `worktree 将切换到最新远端主分支的 detached HEAD；本地分支 ${member.branch} 会保留。`,
    warning: "存在未提交改动时会阻止转换，不会强制覆盖文件。",
    confirmLabel: "转为参考",
    action: "convert-to-reference",
    workspace,
    member,
  };
  confirmDialog.value?.showModal();
}
async function confirmAction(): Promise<void> {
  const pending = confirmState.value;
  if (!pending || busy.value) return;
  confirmDialog.value?.close();
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

onMounted(async () => {
  try {
    await rpcPromise;
    connectionState.value = "connected";
    await refresh();
  } catch (error) {
    connectionState.value = "failed";
    fatalError.value = describeError(error);
  }
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
        <span :class="busy ? 'spinner' : 'connection-dot'" />{{
          connectionState === "failed" ? "连接失败" : busy ? busyAction : "已连接"
        }}
      </div>
    </header>

    <main class="workspace-layout" :aria-busy="busy">
      <aside class="workspace-sidebar" aria-label="Workspace 索引">
        <div class="sidebar-title">
          <h1>Workspace</h1>
          <button
            class="icon-button"
            type="button"
            aria-label="新建 Workspace"
            @click="showCreate = !showCreate"
          >
            <span class="i-ph-plus" />
          </button>
        </div>
        <form v-if="showCreate" class="create-row" @submit.prevent="createWorkspace">
          <label class="sr-only" for="workspace-name">Workspace 名称</label
          ><input
            id="workspace-name"
            v-model="newWorkspaceName"
            class="control"
            required
            placeholder="Workspace 名称"
          /><button class="button primary compact" type="submit" :disabled="busy">创建</button>
        </form>
        <label class="search-control"
          ><span class="i-ph-magnifying-glass" /><span class="sr-only">搜索 Workspace</span
          ><input v-model="workspaceQuery" type="search" placeholder="搜索 Workspace"
        /></label>
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
        <div v-if="fatalError" class="feedback-card error" role="alert">
          <strong>无法连接 Devframe</strong>
          <p>{{ fatalError }}</p>
        </div>
        <div v-else-if="connectionState === 'connecting'" class="empty page">
          <span class="spinner large" /><strong>正在读取 Workspace</strong>
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
              <button class="button" type="button" @click="copyCommand(currentWorkspace)">
                <span class="i-ph-copy" />复制路径</button
              ><button
                class="button"
                type="button"
                :disabled="busy"
                @click="syncWorkspace(currentWorkspace)"
              >
                <span class="i-ph-arrows-clockwise" />修复链接</button
              ><button
                class="button"
                type="button"
                :disabled="busy"
                @click="openWorkspaceInChatgpt(currentWorkspace)"
              >
                <span class="i-ph-open-ai-logo" />在 ChatGPT 中打开</button
              ><button
                class="button primary"
                type="button"
                :disabled="!currentWorkspace.members.length || busy"
                @click="openClone"
              >
                <span class="i-ph-plus" />克隆 Workspace</button
              ><button
                class="icon-button"
                type="button"
                aria-label="删除 Workspace"
                @click="openDeleteWorkspace(currentWorkspace)"
              >
                <span class="i-ph-trash" />
              </button>
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
                    <button
                      class="button"
                      type="button"
                      :disabled="statusLoading"
                      @click="refreshWorkspaceStatus()"
                    >
                      <span v-if="statusLoading" class="spinner" />
                      <span v-else class="i-ph-magnifying-glass" />检查状态
                    </button>
                    <button class="button" type="button" @click="showAdd = !showAdd">
                      <span class="i-ph-plus" />添加仓库
                    </button>
                  </div>
                </div>
                <form v-if="showAdd" class="add-form" @submit.prevent="addMember(currentWorkspace)">
                  <div
                    class="add-repository-field"
                    @keydown.escape.stop="addRepositoryOpen = false"
                  >
                    <span>仓库</span>
                    <button
                      class="select-trigger"
                      type="button"
                      :disabled="!availableRepositories.length"
                      :aria-expanded="addRepositoryOpen"
                      aria-haspopup="listbox"
                      @click="addRepositoryOpen = !addRepositoryOpen"
                    >
                      <span
                        ><span class="i-ph-git-branch" />{{
                          selectedRepository?.classificationPath ?? "暂无可用仓库"
                        }}</span
                      >
                      <span class="i-ph-caret-down" />
                    </button>
                    <div v-if="addRepositoryOpen" class="select-popover add-select-popover">
                      <label class="search-control"
                        ><span class="i-ph-magnifying-glass" /><span class="sr-only">搜索仓库</span
                        ><input v-model="addRepositoryQuery" type="search" placeholder="搜索仓库"
                      /></label>
                      <div role="listbox" aria-label="可添加的仓库">
                        <button
                          v-for="repository in filteredAvailableRepositories"
                          :key="repository.id"
                          type="button"
                          role="option"
                          :aria-selected="repository.id === selectedRepositoryId"
                          @click="
                            selectedRepositoryId = repository.id;
                            addRepositoryOpen = false;
                          "
                        >
                          <span class="i-ph-git-branch" />{{ repository.classificationPath }}
                          <span v-if="repository.id === selectedRepositoryId" class="i-ph-check" />
                        </button>
                        <p v-if="!filteredAvailableRepositories.length" class="popover-empty">
                          没有匹配的仓库
                        </p>
                      </div>
                    </div>
                  </div>
                  <label
                    ><span>目录别名</span
                    ><input v-model="alias" class="control" placeholder="默认使用仓库名" /></label
                  ><label
                    ><span>分支</span
                    ><input v-model="branch" class="control" placeholder="留空自动创建" /></label
                  ><label class="checkbox"
                    ><input
                      v-model="createBranch"
                      type="checkbox"
                      :disabled="!branch.trim()"
                    />新建指定分支</label
                  ><button
                    class="button primary"
                    type="submit"
                    :disabled="!selectedRepositoryId || busy"
                  >
                    加入 Workspace
                  </button>
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
                        tooltip="Rebase 远端主分支"
                        icon="i-ph-git-merge"
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
                        v-if="member.mode === 'worktree' && member.detached"
                        tooltip="转为开发分支"
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
                  <button class="button" type="button" @click="showAdd = true">添加仓库</button>
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
                <button class="quick-action" type="button" @click="copyCommand(currentWorkspace)">
                  <span class="i-ph-terminal-window" />复制 cd 命令
                </button>
              </section>
              <section
                v-if="feedback"
                class="feedback-card"
                :class="{ error: feedback.error }"
                :role="feedback.error ? 'alert' : 'status'"
              >
                <button
                  class="icon-button feedback-close"
                  type="button"
                  aria-label="关闭反馈"
                  @click="feedback = undefined"
                >
                  <span class="i-ph-x" /></button
                ><span :class="feedback.error ? 'i-ph-x-circle-fill' : 'i-ph-check-circle-fill'" />
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

    <dialog ref="promoteDialog" class="modal confirm-modal" @close="restoreFocus">
      <form method="dialog" class="modal-card" @submit.prevent="submitPromoteReference">
        <header>
          <div>
            <h2>转为开发分支</h2>
            <p>{{ promoteMember?.alias }} 将继续使用当前 worktree，不复制文件</p>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="关闭"
            :disabled="busy"
            @click="closePromoteReference"
          >
            <span class="i-ph-x" />
          </button>
        </header>
        <div class="modal-body">
          <label class="field"
            ><span>开发分支名称</span
            ><input
              id="promote-branch"
              v-model="promoteBranch"
              class="control"
              required
              autocomplete="off"
              placeholder="例如 feat/workspace-task"
            /><small
              ><span class="i-ph-git-branch" />新分支从当前 reference 创建；已有分支直接切换</small
            ></label
          >
          <div class="origin-note">
            <span class="i-ph-lightning" />
            <div>
              <strong>原位切换</strong>
              <p>保留当前目录；已有分支不会重建。若它也在其他 worktree 打开，请勿两处同时提交。</p>
            </div>
          </div>
          <div v-if="promoteError" class="inline-error" role="alert">
            <strong>转换失败</strong>
            <p>{{ promoteError }}</p>
          </div>
        </div>
        <footer>
          <span>已有同名本地分支时直接切换，不覆盖提交。</span>
          <div>
            <button class="button" type="button" :disabled="busy" @click="closePromoteReference">
              取消
            </button>
            <button class="button primary" type="submit" :disabled="!promoteBranch.trim() || busy">
              <span v-if="busyAction === '切换开发分支'" class="spinner small" />切换开发分支
            </button>
          </div>
        </footer>
      </form>
    </dialog>

    <dialog ref="cloneDialog" class="modal clone-modal" @close="restoreFocus">
      <form method="dialog" class="modal-card" @submit.prevent="submitClone">
        <header>
          <div>
            <h2>克隆 Workspace</h2>
            <p>选择仓库，创建独立工作区</p>
          </div>
          <button
            class="icon-button"
            type="button"
            aria-label="关闭"
            :disabled="busy"
            @click="closeClone"
          >
            <span class="i-ph-x" />
          </button>
        </header>
        <div class="modal-body">
          <label class="field"
            ><span>源 Workspace</span
            ><button
              class="select-trigger"
              type="button"
              :aria-expanded="cloneSourceOpen"
              aria-haspopup="listbox"
              @click="cloneSourceOpen = !cloneSourceOpen"
            >
              <span><span class="i-ph-folder" />{{ cloneSource?.name ?? "选择 Workspace" }}</span
              ><span class="i-ph-caret-down" /></button
          ></label>
          <div v-if="cloneSourceOpen" class="select-popover">
            <label class="search-control"
              ><span class="i-ph-magnifying-glass" /><span class="sr-only">搜索源 Workspace</span
              ><input v-model="cloneSourceQuery" type="search" placeholder="搜索 Workspace"
            /></label>
            <div role="listbox" aria-label="源 Workspace">
              <button
                v-for="workspace in filteredCloneSources"
                :key="workspace.id"
                type="button"
                role="option"
                :aria-selected="workspace.id === cloneSourceId"
                @click="cloneSourceId = workspace.id"
              >
                <span class="i-ph-folder" />{{ workspace.name
                }}<span v-if="workspace.id === cloneSourceId" class="i-ph-check" />
              </button>
              <p v-if="!filteredCloneSources.length" class="popover-empty">没有匹配的 Workspace</p>
            </div>
          </div>
          <label class="field"
            ><span>目标名称</span
            ><input
              id="clone-name"
              v-model="cloneTargetName"
              class="control"
              required
              autocomplete="off"
              placeholder="例如 ruyi-feature"
            /><small><span class="i-ph-folder" />{{ cloneTargetPath }}</small></label
          >
          <label class="field"
            ><span>开发分支名称</span
            ><input
              v-model="cloneBranchName"
              class="control"
              :disabled="cloneDevelopmentCount === 0"
              :required="cloneDevelopmentCount > 0"
              autocomplete="off"
              placeholder="例如 feat/ruyi-feature"
              @input="cloneBranchCustomized = true"
            /><small
              ><span class="i-ph-git-branch" />{{
                cloneDevelopmentCount
                  ? `${cloneDevelopmentCount} 个开发仓库使用此分支名`
                  : "所选仓库均为参考模式，不会新建分支"
              }}</small
            ></label
          >
          <div class="origin-note">
            <span class="i-ph-git-branch-duotone" />
            <div>
              <strong>从远端默认分支创建</strong>
              <p>开发仓库创建自定义分支；参考仓库使用 detached HEAD，不继承本地改动。</p>
            </div>
          </div>
          <div class="repository-picker-heading">
            <label for="clone-repository-search">选择仓库</label
            ><span>已选 {{ cloneSelectedIds.length }} / {{ cloneSourceMembers.length }}</span>
          </div>
          <div class="picker-search-row">
            <label class="search-control"
              ><span class="i-ph-magnifying-glass" /><input
                id="clone-repository-search"
                v-model="cloneRepositoryQuery"
                type="search"
                placeholder="搜索仓库名称" /></label
            ><button class="button" type="button" @click="toggleAllCloneRepositories">
              {{ cloneSelectedIds.length === cloneSourceMembers.length ? "取消全选" : "全选" }}
            </button>
          </div>
          <div class="repository-picker">
            <div
              v-for="{ member, repository } in filteredCloneMembers"
              :key="member.repositoryId"
              class="repository-picker-row"
            >
              <label class="repository-choice"
                ><input
                  type="checkbox"
                  :checked="cloneSelectedIds.includes(member.repositoryId)"
                  @change="toggleCloneRepository(member.repositoryId)"
                /><span class="i-ph-git-branch" /><span class="repository-choice-copy"
                  ><strong>{{ member.alias }}</strong
                  ><code>{{ repository?.classificationPath }}</code></span
                ></label
              ><button
                class="repository-mode"
                :class="{ reference: cloneReferenceIds.includes(member.repositoryId) }"
                type="button"
                :disabled="!cloneSelectedIds.includes(member.repositoryId)"
                :aria-pressed="cloneReferenceIds.includes(member.repositoryId)"
                :aria-label="`${member.alias}：${
                  cloneReferenceIds.includes(member.repositoryId) ? '仅作参考' : '创建开发分支'
                }`"
                @click="toggleCloneReference(member.repositoryId)"
              >
                <span
                  :class="
                    cloneReferenceIds.includes(member.repositoryId)
                      ? 'i-ph-book-open-text'
                      : 'i-ph-git-branch'
                  "
                />{{ cloneReferenceIds.includes(member.repositoryId) ? "仅作参考" : "开发分支" }}
              </button>
            </div>
            <div v-if="!filteredCloneMembers.length" class="empty compact">没有匹配的仓库</div>
          </div>
          <div v-if="busyAction === '克隆 Workspace'" class="clone-progress" role="status">
            <span class="spinner" /><span
              ><strong>正在获取远端默认分支</strong
              ><small>正在创建所选仓库的隔离 worktree…</small></span
            >
          </div>
          <div v-if="cloneError" class="inline-error" role="alert">
            <strong>克隆失败</strong>
            <p>{{ cloneError }}</p>
          </div>
        </div>
        <footer>
          <span
            >{{ cloneDevelopmentCount }} 个开发分支 · {{ cloneReferenceIds.length }} 个仅参考</span
          >
          <div>
            <button class="button" type="button" :disabled="busy" @click="closeClone">取消</button
            ><button class="button primary" type="submit" :disabled="!cloneCanSubmit">
              <span v-if="busy" class="spinner small" />克隆 {{ cloneSelectedIds.length }} 个仓库
            </button>
          </div>
        </footer>
      </form>
    </dialog>

    <dialog ref="confirmDialog" class="modal confirm-modal" @close="restoreFocus">
      <div v-if="confirmState" class="modal-card">
        <header>
          <h2>{{ confirmState.title }}</h2>
          <button
            class="icon-button"
            type="button"
            aria-label="关闭"
            @click="confirmDialog?.close()"
          >
            <span class="i-ph-x" />
          </button>
        </header>
        <div class="modal-body">
          <p>{{ confirmState.message }}</p>
          <div class="warning-note">
            <span class="i-ph-warning" />{{
              confirmState.warning ?? "未提交的改动会阻止删除，数据不会被强制丢弃。"
            }}
          </div>
        </div>
        <footer>
          <span />
          <div>
            <button class="button" type="button" @click="confirmDialog?.close()">取消</button
            ><button
              class="button"
              :class="confirmState.action === 'convert-to-reference' ? 'primary' : 'danger'"
              type="button"
              @click="confirmAction"
            >
              {{ confirmState.confirmLabel ?? "确认删除" }}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  </div>
</template>
