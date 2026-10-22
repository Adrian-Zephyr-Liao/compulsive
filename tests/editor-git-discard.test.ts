import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { useEditorGit } from "../src/devtool-client/features/editor/hooks/useEditorGit.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";
import type { ProjectGitStatus } from "../src/project/git.js";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  setters: [] as ReturnType<typeof vi.fn>[],
  refs: [] as { current: unknown }[],
  status: undefined as ProjectGitStatus | undefined,
}));
vi.mock("react", () => ({
  createElement: (type: unknown, props: unknown) => ({ type, props }),
  useState: (initial: unknown) => {
    const setter = vi.fn();
    const value = mocks.setters.length ? initial : mocks.status;
    mocks.setters.push(setter);
    return [value, setter];
  },
  useRef: (current: unknown) => {
    const ref = { current };
    mocks.refs.push(ref);
    return ref;
  },
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
}));
vi.mock("antd", () => ({ App: { useApp: () => ({ modal: { confirm: mocks.confirm } }) } }));
vi.mock("../src/devtool-client/app/i18n.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../src/devtool-client/features/editor/hooks/useEditorGitDraft.js", () => ({
  useEditorGitDraft: () => ({
    message: "draft",
    setMessage: vi.fn(),
    generating: false,
    generateMessage: vi.fn(),
  }),
}));
const scope = { workspaceId: "workspace:test", repositoryId: "local:test" };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.setters = [];
  mocks.refs = [];
  mocks.status = {
    changes: [
      {
        path: "a.ts",
        original: "a.ts",
        index: "M",
        worktree: " ",
        conflict: false,
        ignored: false,
      },
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
  mocks.confirm.mockImplementation(({ onOk }) => onOk());
});
function setup(dirty: string[] = []) {
  const next = { ...mocks.status!, changes: [], fingerprint: "clean" };
  const call = vi
    .fn()
    .mockResolvedValue({ status: next, backup: { oid: "backup-oid", message: "CPL backup" } });
  const report = vi.fn(),
    changed = vi.fn();
  return {
    git: useEditorGit(
      async () => ({ call }) as unknown as WorkspaceRpc,
      scope,
      dirty,
      report,
      changed,
    ),
    call,
    report,
    changed,
    next,
  };
}
describe("discard all controller", () => {
  it("requires explicit confirmation, sends a scoped snapshot and keeps the recovery ID", async () => {
    mocks.confirm.mockImplementation(({ content, onOk }) => {
      content.props.onBackupChange(true);
      onOk();
    });
    const { git, call, changed, next } = setup();
    await git.discardAll();
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ okButtonProps: { danger: true }, autoFocusButton: "cancel" }),
    );
    expect(call).toHaveBeenCalledExactlyOnceWith("discard-project-git-changes", {
      ...scope,
      fingerprint: "reviewed",
      confirmed: true,
      backup: true,
    });
    expect(mocks.setters[0]).toHaveBeenCalledWith(next);
    expect(
      mocks.setters.some((set) => set.mock.calls.some(([value]) => value === "backup-oid")),
    ).toBe(true);
    expect(changed).toHaveBeenCalledOnce();
  });
  it("defaults to no backup and requires a second destructive confirmation", async () => {
    const { git, call, next } = setup();
    call.mockResolvedValue({ status: next, backup: null });
    await git.discardAll();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.confirm.mock.calls[1]![0]).toMatchObject({
      title: "editor.discardNoBackupTitle",
      autoFocusButton: "cancel",
      okButtonProps: { danger: true },
    });
    expect(call).toHaveBeenCalledExactlyOnceWith("discard-project-git-changes", {
      ...scope,
      fingerprint: "reviewed",
      confirmed: true,
      backup: false,
    });
    expect(mocks.setters.some((set) => set.mock.calls.some(([value]) => value === ""))).toBe(true);
  });
  it("does not discard when the permanent no-backup confirmation is cancelled", async () => {
    mocks.confirm
      .mockImplementationOnce(({ onOk }) => onOk())
      .mockImplementationOnce(({ onCancel }) => onCancel());
    const { git, call } = setup();
    await git.discardAll();
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(call).not.toHaveBeenCalled();
  });
  it("cancellation never mutates Git", async () => {
    mocks.confirm.mockImplementation(({ onCancel }) => onCancel());
    const { git, call, changed } = setup();
    await git.discardAll();
    expect(call).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
  it("blocks unsaved buffers before confirmation", async () => {
    const { git, call, report } = setup(["a.ts"]);
    await git.discardAll();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(call).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: "editor.saveBeforeGit" }),
    );
  });
  it("rechecks unsaved buffers after confirmation", async () => {
    mocks.confirm.mockImplementation(({ onOk }) => {
      mocks.refs[0]!.current = ["a.ts"];
      onOk();
    });
    const { git, call, report } = setup();
    await git.discardAll();
    expect(call).not.toHaveBeenCalledWith("discard-project-git-changes", expect.anything());
    expect(report).toHaveBeenCalledWith(
      expect.objectContaining({ message: "editor.saveBeforeGit" }),
    );
  });
  it("invalidates an old repository confirmation on unmount", async () => {
    const destroy = vi.fn();
    let confirmOld!: () => void;
    mocks.confirm.mockImplementationOnce(({ content, onOk }) => {
      content.props.onBackupChange(true);
      confirmOld = onOk;
      return { destroy };
    });
    const { git, call } = setup();
    const pending = git.discardAll();
    const cleanup = vi.mocked(useEffect).mock.calls[1]![0]();
    if (typeof cleanup === "function") cleanup();
    expect(destroy).toHaveBeenCalledOnce();
    confirmOld();
    await pending;
    expect(call).not.toHaveBeenCalled();
  });
});
