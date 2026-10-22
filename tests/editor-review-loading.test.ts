import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorReview } from "../src/devtool-client/features/editor/hooks/useEditorReview.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";
import type { ProjectGitStatus } from "../src/project/git.js";

const { setResult, select } = vi.hoisted(() => ({ setResult: vi.fn(), select: vi.fn() }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
  useState: (initial: unknown) => [initial, initial === "" ? select : setResult],
}));
beforeEach(() => vi.clearAllMocks());
const scope = { workspaceId: "workspace:test", repositoryId: "local:test" };
const snapshot: ProjectGitStatus = {
  excludedChanges: false,
  forcePushRequired: false,
  branch: "feat/test",
  head: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  fingerprint: "fresh",
  changes: [
    {
      path: "new.ts",
      original: "new.ts",
      index: "?",
      worktree: "?",
      conflict: false,
      ignored: false,
    },
  ],
};
const setup = () => vi.mocked(useEffect).mock.calls.at(-1)![0]();

describe("review diff requests", () => {
  it("selects a previewable change and passes a scoped object to the RPC", async () => {
    const diff = {
      path: "new.ts",
      original: "",
      content: "new source",
      staged: false,
      fingerprint: "fresh",
      hunks: [],
    };
    const call = vi.fn().mockResolvedValue(diff);
    const getRpc = async () => ({ call }) as unknown as WorkspaceRpc;
    const review = useEditorReview(getRpc, scope, snapshot, true);
    expect(review.current?.change.path).toBe("new.ts");
    expect(review.loading).toBe(true);
    setup();
    await vi.waitFor(() =>
      expect(setResult).toHaveBeenCalledWith(expect.objectContaining({ diff })),
    );
    expect(call).toHaveBeenCalledWith("get-project-git-diff", {
      ...scope,
      path: "new.ts",
      staged: false,
    });
  });

  it("ignores a response after switching views, files or repositories", async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    const call = vi.fn().mockReturnValue(pending);
    const getRpc = async () => ({ call }) as unknown as WorkspaceRpc;
    useEditorReview(getRpc, scope, snapshot, true);
    const cleanup = setup();
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    if (typeof cleanup === "function") cleanup();
    setResult.mockClear();
    resolve({ path: "old-file.ts" });
    await pending;
    await Promise.resolve();
    expect(setResult).not.toHaveBeenCalled();
  });

  it("reports unavailable files without keeping another file's diff", async () => {
    const call = vi.fn().mockRejectedValue(new Error("Binary changes require an external viewer."));
    useEditorReview(async () => ({ call }) as unknown as WorkspaceRpc, scope, snapshot, true);
    setup();
    await vi.waitFor(() =>
      expect(setResult).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Binary changes require an external viewer." }),
      ),
    );
    expect(setResult.mock.calls.at(-1)![0]).not.toHaveProperty("diff");
  });

  it.each(["inactive", "empty", "conflict"])(
    "does not request a misleading diff for %s",
    (state) => {
      const call = vi.fn();
      const next =
        state === "empty"
          ? { ...snapshot, changes: [] }
          : state === "conflict"
            ? {
                ...snapshot,
                changes: snapshot.changes.map((change) => ({ ...change, conflict: true })),
              }
            : snapshot;
      useEditorReview(
        async () => ({ call }) as unknown as WorkspaceRpc,
        scope,
        next,
        state !== "inactive",
      );
      expect(setup()).toBeUndefined();
      expect(call).not.toHaveBeenCalled();
    },
  );
});
