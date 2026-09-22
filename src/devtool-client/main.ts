import { connectDevframe } from "devframe/client";

import type { DevtoolState, DevtoolWorkspace } from "../devtool.js";
import type { RepositoryRecord, WorkspaceMember } from "../types.js";
import "./styles.css";

interface AddMemberInput {
  workspaceId: string;
  repositoryId: string;
  alias?: string;
  branch?: string;
  createBranch: boolean;
}

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app mount point.");

app.innerHTML = `
  <header class="topbar">
    <div>
      <p class="eyebrow">LOCAL DEVTOOL</p>
      <h1>Compulsive</h1>
    </div>
    <span id="connection" class="status" role="status" aria-live="polite">正在连接</span>
  </header>
  <main class="layout">
    <aside class="sidebar" aria-label="Workspace 列表">
      <form id="create-workspace" class="create-form">
        <label for="workspace-name">新建 Workspace</label>
        <div class="field-row">
          <input id="workspace-name" name="name" required autocomplete="off" placeholder="例如 task-a" />
          <button type="submit">创建</button>
        </div>
      </form>
      <label class="search-label" for="search">筛选</label>
      <input id="search" type="search" placeholder="名称或路径" />
      <nav id="workspace-list" class="workspace-list" aria-label="Workspace"></nav>
    </aside>
    <section id="workspace-detail" class="detail" aria-live="polite">
      <p class="empty">正在加载 Workspace…</p>
    </section>
  </main>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
`;

const connection = requiredElement<HTMLSpanElement>("#connection");
const list = requiredElement<HTMLElement>("#workspace-list");
const detail = requiredElement<HTMLElement>("#workspace-detail");
const search = requiredElement<HTMLInputElement>("#search");
const createForm = requiredElement<HTMLFormElement>("#create-workspace");
const toast = requiredElement<HTMLDivElement>("#toast");
const layout = requiredElement<HTMLElement>(".layout");

let state: DevtoolState = { repositories: [], workspaces: [] };
let selectedWorkspaceId: string | undefined;
let busy = false;

function requiredElement<T extends Element>(selector: string): T {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing element: ${selector}`);
  return value;
}

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  return element;
}

function button(label: string, className = "secondary"): HTMLButtonElement {
  const element = node("button", { className, text: label });
  element.type = "button";
  return element;
}

function currentWorkspace(): DevtoolWorkspace | undefined {
  return state.workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
}

function repositoryFor(member: WorkspaceMember): RepositoryRecord | undefined {
  return state.repositories.find((repository) => repository.id === member.repositoryId);
}

function setBusy(value: boolean): void {
  busy = value;
  layout.inert = value;
  layout.classList.toggle("busy", value);
  layout.setAttribute("aria-busy", String(value));
  connection.textContent = value ? "正在处理" : "已连接";
  connection.classList.toggle("working", value);
}

let toastTimer: number | undefined;
function notify(message: string, isError = false): void {
  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("visible");
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3200);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = "code" in error && typeof error.code === "string" ? `${error.code}: ` : "";
    return `${code}${error.message}`;
  }
  return String(error);
}

async function main(): Promise<void> {
  const rpc = (await connectDevframe()).scope("compulsive").rpc;

  async function refresh(preferredWorkspaceId = selectedWorkspaceId): Promise<void> {
    state = await rpc.call("get-state");
    selectedWorkspaceId = state.workspaces.some(
      (workspace) => workspace.id === preferredWorkspaceId,
    )
      ? preferredWorkspaceId
      : state.workspaces[0]?.id;
    render();
  }

  async function action(task: () => Promise<unknown>, success: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await task();
      await refresh();
      notify(success);
    } catch (error) {
      notify(describeError(error), true);
    } finally {
      setBusy(false);
    }
  }

  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = requiredElement<HTMLInputElement>("#workspace-name");
    const name = input.value.trim();
    if (!name) return;
    void action(async () => {
      const workspace = await rpc.call("create-workspace", { name });
      selectedWorkspaceId = workspace.id;
      input.value = "";
    }, `已创建 ${name}`);
  });

  search.addEventListener("input", renderWorkspaceList);

  function render(): void {
    renderWorkspaceList();
    renderWorkspaceDetail();
  }

  function renderWorkspaceList(): void {
    const query = search.value.trim().toLowerCase();
    const workspaces = state.workspaces.filter((workspace) =>
      [workspace.name, workspace.absolutePath].some((value) => value.toLowerCase().includes(query)),
    );
    list.replaceChildren();
    if (workspaces.length === 0) {
      list.append(node("p", { className: "empty", text: "没有匹配的 Workspace" }));
      return;
    }
    for (const workspace of workspaces) {
      const item = button("", "workspace-item");
      item.classList.toggle("selected", workspace.id === selectedWorkspaceId);
      if (workspace.id === selectedWorkspaceId) item.setAttribute("aria-current", "page");
      item.append(
        node("strong", { text: workspace.name }),
        node("span", {
          text: `${String(workspace.members.length)} 个仓库 · ${workspace.absolutePath}`,
        }),
      );
      item.addEventListener("click", () => {
        selectedWorkspaceId = workspace.id;
        render();
      });
      list.append(item);
    }
  }

  function renderWorkspaceDetail(): void {
    const workspace = currentWorkspace();
    detail.replaceChildren();
    if (!workspace) {
      const empty = node("div", { className: "detail-empty" });
      empty.append(
        node("p", { className: "eyebrow", text: "WORKSPACE" }),
        node("h2", { text: "还没有 Workspace" }),
        node("p", { text: "从左侧创建一个，再加入当前任务需要的仓库。" }),
      );
      detail.append(empty);
      return;
    }

    const heading = node("div", { className: "detail-heading" });
    const title = node("div");
    title.append(
      node("p", { className: "eyebrow", text: "WORKSPACE" }),
      node("h2", { text: workspace.name }),
      node("code", { text: workspace.absolutePath }),
    );
    const actions = node("div", { className: "actions" });
    const copy = button("复制 cd");
    copy.addEventListener("click", () => {
      void navigator.clipboard
        .writeText(workspace.cdCommand)
        .then(() => notify("已复制 cd 命令"))
        .catch((error: unknown) => notify(describeError(error), true));
    });
    const sync = button("同步");
    sync.addEventListener("click", () => {
      void action(() => rpc.call("sync-workspace", { workspaceId: workspace.id }), "同步完成");
    });
    const removeWorkspace = button("删除", "danger");
    removeWorkspace.addEventListener("click", () => {
      if (!window.confirm(`删除 Workspace “${workspace.name}”？只允许删除干净的 worktree。`)) {
        return;
      }
      void action(async () => {
        await rpc.call("delete-workspace", { workspaceId: workspace.id });
        selectedWorkspaceId = undefined;
      }, `已删除 ${workspace.name}`);
    });
    actions.append(copy, sync, removeWorkspace);
    heading.append(title, actions);

    const members = node("section", { className: "panel" });
    const membersTitle = node("div", { className: "section-title" });
    membersTitle.append(
      node("h3", { text: "仓库" }),
      node("span", { text: String(workspace.members.length) }),
    );
    members.append(membersTitle);
    const memberList = node("div", { className: "member-list" });
    if (workspace.members.length === 0) {
      memberList.append(node("p", { className: "empty", text: "这个 Workspace 还是空的。" }));
    }
    for (const member of workspace.members) {
      const repository = repositoryFor(member);
      const row = node("article", { className: "member" });
      const body = node("div");
      body.append(
        node("strong", { text: member.alias }),
        node("span", { text: repository?.classificationPath ?? member.repositoryId }),
        node("code", { text: member.mode === "worktree" ? member.branch : "linked checkout" }),
      );
      const remove = button("移除", "ghost danger-text");
      remove.addEventListener("click", () => {
        if (!window.confirm(`从 ${workspace.name} 移除 ${member.alias}？`)) return;
        void action(
          () =>
            rpc.call("remove-workspace-member", {
              workspaceId: workspace.id,
              repositoryId: member.repositoryId,
            }),
          `已移除 ${member.alias}`,
        );
      });
      row.append(body, remove);
      memberList.append(row);
    }
    members.append(memberList);

    const addPanel = renderAddMember(
      workspace,
      (input) => rpc.call("add-workspace-member", input),
      action,
    );
    detail.append(heading, members, addPanel);
  }

  connection.textContent = "已连接";
  await refresh();
}

function renderAddMember(
  workspace: DevtoolWorkspace,
  addMember: (input: AddMemberInput) => Promise<unknown>,
  action: (task: () => Promise<unknown>, success: string) => Promise<void>,
): HTMLElement {
  const panel = node("section", { className: "panel" });
  panel.append(node("h3", { text: "添加仓库" }));
  const available = state.repositories.filter(
    (repository) => !workspace.members.some((member) => member.repositoryId === repository.id),
  );
  if (available.length === 0) {
    panel.append(node("p", { className: "empty", text: "没有可添加的已登记仓库。" }));
    return panel;
  }

  const form = node("form", { className: "member-form" });
  const searchLabel = node("label", { text: "筛选仓库" });
  const repositorySearch = node("input");
  repositorySearch.type = "search";
  repositorySearch.placeholder = "名称或路径";
  searchLabel.append(repositorySearch);

  const repositoryLabel = node("label", { text: "仓库" });
  const repositorySelect = node("select");
  repositorySelect.name = "repositoryId";

  function renderRepositories(): void {
    const query = repositorySearch.value.trim().toLowerCase();
    const matches = available.filter((repository) =>
      [repository.name, repository.classificationPath, repository.absolutePath].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
    repositorySelect.replaceChildren();
    for (const repository of matches) {
      const option = node("option", { text: repository.classificationPath });
      option.value = repository.id;
      repositorySelect.append(option);
    }
    if (matches.length === 0) {
      const option = node("option", { text: "没有匹配的仓库" });
      option.disabled = true;
      option.selected = true;
      repositorySelect.append(option);
    }
    repositorySelect.disabled = matches.length === 0;
  }
  repositorySearch.addEventListener("input", renderRepositories);
  renderRepositories();
  repositoryLabel.append(repositorySelect);

  const aliasLabel = node("label", { text: "目录别名（可选）" });
  const aliasInput = node("input");
  aliasInput.name = "alias";
  aliasInput.placeholder = "默认使用仓库名";
  aliasLabel.append(aliasInput);

  const branchLabel = node("label", { text: "分支（可选）" });
  const branchInput = node("input");
  branchInput.name = "branch";
  branchInput.placeholder = "留空自动创建 workspace/...";
  branchLabel.append(branchInput);

  const createLabel = node("label", { className: "check" });
  const createInput = node("input");
  createInput.type = "checkbox";
  createInput.name = "createBranch";
  createInput.checked = true;
  createInput.disabled = true;
  createLabel.append(createInput, document.createTextNode("新建指定分支"));
  branchInput.addEventListener("input", () => {
    createInput.disabled = !branchInput.value.trim();
    if (createInput.disabled) createInput.checked = true;
  });

  const submit = button("加入 Workspace", "primary");
  submit.type = "submit";
  form.append(searchLabel, repositoryLabel, aliasLabel, branchLabel, createLabel, submit);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const branch = branchInput.value.trim();
    const alias = aliasInput.value.trim();
    const repository = available.find((item) => item.id === repositorySelect.value);
    if (!repository) return;
    void action(
      () =>
        addMember({
          workspaceId: workspace.id,
          repositoryId: repository.id,
          ...(alias ? { alias } : {}),
          ...(branch ? { branch } : {}),
          createBranch: createInput.checked,
        }),
      `已添加 ${repository.name}`,
    );
  });
  panel.append(form);
  return panel;
}

void main().catch((error: unknown) => {
  connection.textContent = "连接失败";
  connection.classList.add("failed");
  const message = node("p", { className: "fatal", text: describeError(error) });
  message.setAttribute("role", "alert");
  detail.replaceChildren(message);
});
