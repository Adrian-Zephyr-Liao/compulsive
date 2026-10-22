import type { ComponentProps, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DevtoolWorkspace } from "../src/devtool.js";
import type { RepositoryId, WorkspaceBranchSyncItem, WorkspaceId } from "../src/types.js";
import { translate } from "../src/devtool-client/app/i18n.js";
import { BatchSyncFeedback } from "../src/devtool-client/features/workspaces/components/BatchSyncFeedback.js";
import { useWorkspaceActions } from "../src/devtool-client/features/workspaces/hooks/useWorkspaceActions.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";

const mocks = vi.hoisted(() => ({
  locale: "en-US" as "en-US" | "zh-CN",
  confirm: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  messageWarning: vi.fn(),
}));
vi.mock("antd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("antd")>()),
  App: {
    useApp: () => ({
      modal: { confirm: mocks.confirm },
      notification: { warning: mocks.warning, success: mocks.success, error: mocks.error },
      message: { warning: mocks.messageWarning },
    }),
  },
}));
vi.mock("../src/devtool-client/app/i18n.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/devtool-client/app/i18n.js")>();
  return {
    ...actual,
    useI18n: () => ({
      t: (
        key: Parameters<typeof actual.translate>[1],
        variables?: Record<string, string | number>,
      ) => actual.translate(mocks.locale, key, variables),
    }),
  };
});

const member = {
  repositoryId: "local:conflict" as RepositoryId,
  alias: "conflict-repository",
  mode: "worktree" as const,
  branch: "feat/task",
  worktreePath: "/fixture/conflict-repository",
};
const workspace: DevtoolWorkspace = {
  id: "workspace:batch-test" as WorkspaceId,
  name: "Batch requirement",
  absolutePath: "/fixture/requirement",
  members: [member],
  cdCommand: "cd /fixture/requirement",
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};
const conflict: WorkspaceBranchSyncItem = {
  repositoryId: member.repositoryId,
  alias: member.alias,
  outcome: "conflict",
  phase: "rebase",
  message: "Rebase stopped in task.ts",
  backup: { oid: "a".repeat(40), restored: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.locale = "en-US";
});

function setup(items: WorkspaceBranchSyncItem[]) {
  const call = vi.fn().mockResolvedValue({ workspaceId: workspace.id, items });
  const getRpc = vi.fn().mockResolvedValue({ call } as unknown as WorkspaceRpc);
  const refresh = vi.fn().mockResolvedValue(undefined);
  const refreshWorkspaceStatus = vi.fn().mockResolvedValue(undefined);
  const selectedWorkspaceIdRef = { current: workspace.id as string | undefined };
  const onInspectSyncConflict = vi.fn();
  const setBusyAction = vi.fn();
  const setRepositoryState = vi.fn();
  const actions = useWorkspaceActions({
    busy: false,
    getRpc,
    refresh,
    refreshWorkspaceStatus,
    workspaceStatus: undefined,
    selectedWorkspaceIdRef,
    setBusyAction,
    setFeedback: vi.fn(),
    setRepositoryState,
    onInspectSyncConflict,
  });
  actions.confirmWorkspaceBranchSync(workspace);
  return {
    call,
    getRpc,
    refresh,
    refreshWorkspaceStatus,
    selectedWorkspaceIdRef,
    onInspectSyncConflict,
    setBusyAction,
    setRepositoryState,
    run: () => mocks.confirm.mock.calls.at(-1)![0].onOk() as Promise<void>,
  };
}

function resultDescription() {
  const options = (mocks.warning.mock.calls.at(-1) ??
    mocks.error.mock.calls.at(-1) ??
    mocks.success.mock.calls.at(-1))![0];
  return options.description as ReactElement<ComponentProps<typeof BatchSyncFeedback>>;
}

describe("batch sync feedback", () => {
  it.each(["en-US", "zh-CN"] as const)(
    "shows every incomplete repository and retained backup (%s)",
    (locale) => {
      mocks.locale = locale;
      const items: WorkspaceBranchSyncItem[] = [
        {
          ...conflict,
          repositoryId: "local:synced" as RepositoryId,
          alias: "saved-repository",
          outcome: "synced",
          backup: { oid: "b".repeat(40), restored: true },
        },
        {
          repositoryId: "local:skipped" as RepositoryId,
          alias: "skipped-repository",
          outcome: "skipped",
          phase: "preflight",
          message: "An operation is unfinished",
        },
        conflict,
        {
          repositoryId: "local:failed" as RepositoryId,
          alias: "failed-repository",
          outcome: "failed",
          phase: "fetch",
          message: "Remote unavailable",
        },
        {
          ...conflict,
          repositoryId: "local:push" as RepositoryId,
          alias: "push-repository",
          outcome: "push-required",
          phase: "push",
          backup: { oid: "c".repeat(40), restored: true },
        },
      ];
      const html = renderToStaticMarkup(
        <BatchSyncFeedback items={items} onInspectConflict={vi.fn()} />,
      );
      for (const item of items) expect(html).toContain(item.alias);
      expect(html).toContain("An operation is unfinished");
      expect(html).toContain("Remote unavailable");
      expect(html).toContain(translate(locale, "feedback.batchPhaseFetch"));
      expect(html).toContain(translate(locale, "feedback.batchBackupRestored"));
      expect(html).toContain(translate(locale, "feedback.batchBackupPending"));
      expect(html).toContain("a".repeat(40));
      expect(html).toContain("b".repeat(40));
      expect(html).toContain(translate(locale, "feedback.batchResolveConflict"));
      expect(html).not.toContain("{pushRequired}");
    },
  );

  it("refreshes requirement metadata before status and does not call skipped repositories successful", async () => {
    const fixture = setup([
      {
        repositoryId: member.repositoryId,
        alias: member.alias,
        message: conflict.message,
        outcome: "skipped",
        phase: "preflight",
      },
    ]);
    await fixture.run();
    expect(fixture.call).toHaveBeenCalledExactlyOnceWith("sync-workspace-branches", {
      workspaceId: workspace.id,
    });
    expect(fixture.refresh).toHaveBeenCalledExactlyOnceWith(workspace.id);
    expect(fixture.refreshWorkspaceStatus).toHaveBeenCalledExactlyOnceWith(true);
    expect(fixture.refresh.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.refreshWorkspaceStatus.mock.invocationCallOrder[0]!,
    );
    expect(mocks.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: translate("en-US", "feedback.batchIncomplete"),
        duration: 0,
      }),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(resultDescription())).toContain(conflict.message);
  });

  it("opens existing conflict details only after an explicit click in the same requirement", async () => {
    const fixture = setup([conflict]);
    await fixture.run();
    expect(fixture.onInspectSyncConflict).not.toHaveBeenCalled();
    expect(fixture.setRepositoryState).toHaveBeenCalledWith("conflicts");
    resultDescription().props.onInspectConflict(member.repositoryId);
    expect(fixture.onInspectSyncConflict).toHaveBeenCalledExactlyOnceWith(member);
    expect(fixture.call).toHaveBeenCalledTimes(1);
    fixture.selectedWorkspaceIdRef.current = "workspace:another";
    resultDescription().props.onInspectConflict(member.repositoryId);
    expect(fixture.onInspectSyncConflict).toHaveBeenCalledTimes(1);
    expect(mocks.messageWarning).toHaveBeenCalledWith(
      translate("en-US", "feedback.batchSelectionChanged", { name: workspace.name }),
    );
  });

  it("does not navigate back or refresh another requirement after a selection change", async () => {
    const fixture = setup([conflict]);
    fixture.selectedWorkspaceIdRef.current = "workspace:another";
    await fixture.run();
    expect(fixture.refresh).toHaveBeenCalledWith(undefined);
    expect(fixture.refreshWorkspaceStatus).not.toHaveBeenCalled();
    expect(fixture.setRepositoryState).not.toHaveBeenCalled();
  });

  it("keeps completed RPC results visible when refreshing metadata fails", async () => {
    const fixture = setup([{ ...conflict, outcome: "push-required", phase: "push" }]);
    fixture.refresh.mockRejectedValue(new Error("Connection lost"));
    await fixture.run();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith(expect.objectContaining({ duration: 0 }));
    const html = renderToStaticMarkup(resultDescription());
    expect(html).toContain(conflict.alias);
    expect(html).toContain("Connection lost");
    expect(html).toContain("This batch did not force-push");
    expect(fixture.call).toHaveBeenCalledTimes(1);
  });

  it("distinguishes restore failures from rebase conflicts without promising a Codex action", () => {
    const html = renderToStaticMarkup(
      <BatchSyncFeedback items={[{ ...conflict, phase: "restore" }]} onInspectConflict={vi.fn()} />,
    );
    expect(html).toContain(translate("en-US", "feedback.batchInspectRestore"));
    expect(html).not.toContain(translate("en-US", "feedback.batchResolveConflict"));
    expect(html).toContain(translate("en-US", "feedback.batchBackupPending"));
  });

  it("reports full success only when all repositories synced, with retained stash metadata", async () => {
    const fixture = setup([
      { ...conflict, outcome: "synced", backup: { oid: conflict.backup!.oid, restored: true } },
    ]);
    await fixture.run();
    expect(mocks.warning).not.toHaveBeenCalled();
    expect(mocks.success).toHaveBeenCalledWith(
      expect.objectContaining({ title: translate("en-US", "feedback.batchComplete"), duration: 8 }),
    );
    expect(renderToStaticMarkup(resultDescription())).toContain(
      translate("en-US", "feedback.batchBackupRestored"),
    );
  });

  it("requires confirmation for stash, rebase, ordinary push and indexed restoration before sending RPC", () => {
    const fixture = setup([conflict]);
    expect(fixture.call).not.toHaveBeenCalled();
    const html = renderToStaticMarkup(mocks.confirm.mock.calls[0]![0].content);
    expect(html).toContain("stash -u");
    expect(html).toContain("origin/master or origin/main");
    expect(html).toContain("push normally");
    expect(html).toContain("stash apply --index");
    expect(html).toContain("VS Code or Codex");
  });

  it("reports connection acquisition failures and always clears the busy state", async () => {
    const fixture = setup([conflict]);
    fixture.getRpc.mockRejectedValue(new Error("Disconnected"));
    await fixture.run();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.objectContaining({
        title: translate("en-US", "feedback.batchFailed"),
        description: "Disconnected",
      }),
    );
    expect(fixture.setBusyAction).toHaveBeenLastCalledWith("");
    expect(fixture.call).not.toHaveBeenCalled();
  });

  it.each(["en-US", "zh-CN"] as const)(
    "preserves CPL stashes and existing drafts in the Codex prompt (%s)",
    (locale) => {
      const prompt = translate(locale, "codex.prompt", {
        name: "repo",
        path: "/fixture",
        branch: "feat/test",
        conflicts: "task.ts",
      });
      expect(prompt).toContain("stash@{0}");
      expect(prompt).toContain(locale === "en-US" ? "pre-existing drafts" : "用户原有草稿");
      expect(prompt).toContain(locale === "en-US" ? "finish with a local commit" : "完成本地提交");
    },
  );
});
