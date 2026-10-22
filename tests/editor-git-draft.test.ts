import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { useEditorGitDraft } from "../src/devtool-client/features/editor/hooks/useEditorGitDraft.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";
import type { ProjectGitStatus } from "../src/project/git.js";

const { update, confirm } = vi.hoisted(() => ({ update: vi.fn(), confirm: vi.fn() }));
vi.mock("react", () => ({
  useState: (value: unknown) => [value, update],
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
}));
vi.mock("antd", () => ({ App: { useApp: () => ({ modal: { confirm } }) } }));
vi.mock("../src/devtool-client/app/i18n.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
const scope = { workspaceId: "workspace:test", repositoryId: "local:test" };
const status: ProjectGitStatus = {
  changes: [
    { path: "a.ts", original: "a.ts", index: "M", worktree: " ", conflict: false, ignored: false },
  ],
  fingerprint: "reviewed",
  head: "abc",
  branch: "feat/test",
  upstream: "",
  ahead: 0,
  behind: 0,
  excludedChanges: false,
  forcePushRequired: false,
};
beforeEach(() => {
  vi.clearAllMocks();
  confirm.mockImplementation(({ onOk }) => onOk());
});
function setup(next = status, busy = false, dirty: string[] = []) {
  const call = vi.fn().mockResolvedValue({ message: "feat: add review", fingerprint: "reviewed" });
  const report = vi.fn();
  const draft = useEditorGitDraft(
    async () => ({ call }) as unknown as WorkspaceRpc,
    scope,
    next,
    busy,
    dirty,
    report,
  );
  return { draft, call, report };
}

describe("Codex commit draft", () => {
  it("fills the message after confirmation, without running a Git mutation", async () => {
    const { draft, call, report } = setup();
    await draft.generateMessage();
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ content: "editor.generateMessageDetail" }),
    );
    expect(call).toHaveBeenCalledExactlyOnceWith("generate-project-commit-message", {
      ...scope,
      fingerprint: "reviewed",
    });
    expect(update).toHaveBeenCalledWith("feat: add review");
    expect(report).not.toHaveBeenCalled();
  });
  it("does not send a patch when cancelled", async () => {
    confirm.mockImplementation(({ onCancel }) => onCancel());
    const { draft, call } = setup();
    await draft.generateMessage();
    expect(call).not.toHaveBeenCalled();
  });
  it("does not overwrite text typed while generating", async () => {
    const { draft, call, report } = setup();
    let resolve!: (value: unknown) => void;
    call.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = draft.generateMessage();
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    draft.setMessage("my newer message");
    update.mockClear();
    resolve({ message: "old generated message", fingerprint: "reviewed" });
    await pending;
    expect(update).not.toHaveBeenCalledWith("old generated message");
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: "editor.generatedMessageStale" }),
    );
  });
  it("invalidates pending results after a scope or Git snapshot change", async () => {
    const { draft, call } = setup();
    let resolve!: (value: unknown) => void;
    call.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const cleanup = vi.mocked(useEffect).mock.calls.at(-1)![0]();
    const pending = draft.generateMessage();
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    if (typeof cleanup === "function") cleanup();
    update.mockClear();
    resolve({ message: "stale", fingerprint: "reviewed" });
    await pending;
    expect(update).not.toHaveBeenCalledWith("stale");
  });
  it("preserves the original draft on failure and prevents duplicate requests", async () => {
    const { draft, call, report } = setup();
    draft.setMessage("original");
    let reject!: (error: Error) => void;
    call.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    const pending = draft.generateMessage();
    await draft.generateMessage();
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    reject(new Error("Codex unavailable"));
    await pending;
    expect(call).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0]![0].content).toContain("editor.replaceMessage");
    expect(update).not.toHaveBeenCalledWith("");
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ message: "Codex unavailable" }));
  });
  it.each(["empty", "conflict", "busy", "dirty"])(
    "does not generate for %s state",
    async (kind) => {
      const next =
        kind === "empty"
          ? { ...status, changes: [] }
          : kind === "conflict"
            ? {
                ...status,
                changes: status.changes.map((change) => ({ ...change, conflict: true })),
              }
            : status;
      const { draft, call } = setup(next, kind === "busy", kind === "dirty" ? ["a.ts"] : []);
      await draft.generateMessage();
      expect(call).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
    },
  );
});
