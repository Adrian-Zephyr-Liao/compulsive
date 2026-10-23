import { afterEach, describe, expect, it, vi } from "vitest";

import { createServerFunctions } from "../src/devtool.js";
import { createRepositoryManager } from "../src/manager.js";
import * as codex from "../src/codex.js";
import * as preferences from "../src/devtool-preferences.js";
import type { ManagerConfig, WorkspaceRecord, WorkspaceStatusResult } from "../src/types.js";

afterEach(() => vi.restoreAllMocks());

const config: ManagerConfig = {
  schemaVersion: 1,
  rootDir: "/example/Code",
  workspaceRoot: "/example/Workspaces",
  scanRoots: [],
};
const workspace: WorkspaceRecord = {
  id: "workspace:test" as WorkspaceRecord["id"],
  name: "Task",
  absolutePath: "/example/Workspaces/Task",
  members: [],
  createdAt: "2026-10-21",
  updatedAt: "2026-10-21",
};

describe("devtool rpc", () => {
  it("validates and forwards default-branch selections for add and clone", async () => {
    const manager = createRepositoryManager();
    const add = vi.spyOn(manager, "addWorkspaceMember").mockResolvedValue(workspace);
    const clone = vi.spyOn(manager, "cloneWorkspace").mockResolvedValue(workspace);
    const functions = createServerFunctions(manager);
    for (const [name, input] of [
      [
        "add-workspace-member",
        {
          workspaceId: workspace.id,
          repositoryId: "local:test",
          createBranch: true,
          useDefaultBranch: true,
        },
      ],
      [
        "clone-workspace",
        { name: "Task", repositoryIds: ["local:test"], defaultBranchRepositoryIds: ["local:test"] },
      ],
    ] as const) {
      const definition = functions.find((fn) => fn.name === name)!;
      const result = await definition.args[0]!["~standard"].validate(input);
      expect(result.issues).toBeUndefined();
      if (result.issues) throw new Error("Invalid RPC fixture");
      await definition.handler!(result.value as never);
    }
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ useDefaultBranch: true, mode: "worktree" }),
    );
    expect(clone).toHaveBeenCalledWith(
      expect.objectContaining({ defaultBranchRepositoryIds: ["local:test"] }),
    );
  });

  it("exposes workspace actions", () => {
    const names = createServerFunctions(createRepositoryManager()).map(({ name }) => name);
    expect(names).toHaveLength(58);
    expect(new Set(names).size).toBe(names.length);

    expect(names).toContain("clone-workspace");
    expect(names).toContain("update-config");
    expect(names).toContain("update-devtool-preferences");
    expect(names).toContain("run-doctor");
    expect(names).toEqual(
      expect.arrayContaining([
        "get-worktree-audit",
        "start-worktree-audit",
        "wait-worktree-audit",
        "cancel-worktree-audit",
        "ignore-worktree-audit",
        "open-audit-worktree",
        "preview-audit-removal",
        "remove-audit-worktree",
      ]),
    );
    expect(names).toContain("get-repository-branches");
    expect(names).toContain("list-project-directory");
    expect(names).toContain("read-project-file");
    expect(names).toContain("open-workspace-in-chatgpt");
    expect(names).toContain("promote-workspace-reference");
    expect(names).toContain("switch-workspace-member-branch");
    expect(names).toContain("convert-workspace-to-reference");
    expect(names).toContain("rebase-workspace-member");
    expect(names).toContain("push-workspace-member");
    expect(names).toContain("sync-workspace-branches");
    expect(names).toContain("get-workspace-status");
    expect(names).toContain("open-workspace-member-in-vscode");
    expect(names).toContain("open-workspace-member-in-codex");
    expect(names).toContain("wait-for-codex-turn");
  });

  it("assembles state and omits status snapshots for deleted workspaces", async () => {
    vi.spyOn(preferences, "devtoolPreferences").mockResolvedValue({ dark: true });
    const manager = createRepositoryManager();
    const retained: WorkspaceStatusResult = {
      workspaceId: workspace.id,
      checkedAt: "2026-10-21",
      members: [],
    };
    Object.assign(manager, {
      getConfig: vi.fn().mockResolvedValue(config),
      search: vi.fn().mockResolvedValue([]),
      searchWorkspaces: vi.fn().mockResolvedValue([workspace]),
      getWorkspaceStatuses: vi
        .fn()
        .mockResolvedValue([retained, { ...retained, workspaceId: "workspace:deleted" }]),
    });
    const action = createServerFunctions(manager).find((fn) => fn.name === "get-state")!;
    expect(await action.handler!()).toEqual({
      preferences: { dark: true },
      config,
      repositories: [],
      workspaces: [{ ...workspace, cdCommand: "cd -- '/example/Workspaces/Task'" }],
      workspaceStatuses: [retained],
    });
  });

  it("preserves explicit push and audited-removal confirmations across RPC groups", async () => {
    const manager = createRepositoryManager();
    const push = vi.spyOn(manager, "pushWorkspaceMember").mockResolvedValue();
    const remove = vi.spyOn(manager, "removeAuditedWorktree").mockResolvedValue({
      removedPath: "/example/worktree",
      report: null,
      retainedCommitRef: null,
      warning: null,
    });
    const functions = createServerFunctions(manager);
    const pushRpc = functions.find((fn) => fn.name === "push-workspace-member")!;
    await pushRpc.handler!({
      workspaceId: workspace.id,
      repositoryId: "local:example",
      force: true,
    });
    expect(push).toHaveBeenCalledWith({
      workspaceId: workspace.id,
      repositoryId: "local:example",
      force: true,
    });
    const removalRpc = functions.find((fn) => fn.name === "remove-audit-worktree")!;
    const input = {
      id: "finding",
      fingerprint: "fresh",
      confirmedPath: "/example/worktree",
      includeIgnored: false,
    };
    await removalRpc.handler!(input);
    expect(remove).toHaveBeenCalledWith({ ...input, force: false });
  });

  it("retains Codex turn deduplication and completion state within a server instance", async () => {
    const manager = createRepositoryManager();
    const repositoryId = "local:example";
    Object.assign(manager, {
      searchWorkspaces: vi.fn().mockResolvedValue([
        {
          ...workspace,
          members: [
            {
              repositoryId,
              alias: "example",
              mode: "worktree",
              branch: "feat/task",
              worktreePath: "/example/worktree",
            },
          ],
        },
      ]),
      search: vi.fn().mockResolvedValue([{ id: repositoryId, absolutePath: "/example/canonical" }]),
    });
    let complete!: (value: codex.CodexTurnCompletion) => void;
    const completion = new Promise<codex.CodexTurnCompletion>((resolve) => {
      complete = resolve;
    });
    const start = vi
      .spyOn(codex, "startCodexTurn")
      .mockResolvedValue({ threadId: "thread", turnId: "turn", completion });
    const functions = createServerFunctions(manager);
    const open = functions.find((fn) => fn.name === "open-workspace-member-in-codex")!;
    const input = {
      workspaceId: workspace.id,
      repositoryId,
      prompt: "Resolve and commit conflicts",
    };
    await Promise.all([open.handler!(input), open.handler!(input)]);
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith("/example/worktree", input.prompt);
    const wait = functions.find((fn) => fn.name === "wait-for-codex-turn")!;
    complete({ status: "completed" });
    await expect(wait.handler!({ turnId: "turn" })).resolves.toEqual({ status: "completed" });
    expect(() => wait.handler!({ turnId: "unknown" })).toThrow("Codex turn is not registered");
  });
});
