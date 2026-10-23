import { useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorDiff } from "../src/devtool-client/features/editor/hooks/useEditorDiff.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";

const { setResult } = vi.hoisted(() => ({ setResult: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: vi.fn(),
  useState: (initial: unknown) => [initial, initial === 0 ? vi.fn() : setResult],
}));
vi.mock("../src/devtool-client/app/i18n.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
const scope = { workspaceId: "workspace:test", repositoryId: "local:test" };
const setup = (call: ReturnType<typeof vi.fn>) => {
  useEditorDiff(
    async () => ({ call }) as unknown as WorkspaceRpc,
    scope,
    "removed.ts",
    true,
    "fresh",
  );
  return vi.mocked(useEffect).mock.calls.at(-1)![0]();
};
beforeEach(() => vi.clearAllMocks());

describe("Diff tab requests", () => {
  it("loads the selected saved Git version without opening a source buffer", async () => {
    const diff = {
      path: "removed.ts",
      original: "old",
      content: "",
      staged: true,
      hunks: [],
      fingerprint: "fresh",
    };
    const call = vi.fn().mockResolvedValue(diff);
    setup(call);
    await vi.waitFor(() =>
      expect(setResult).toHaveBeenCalledWith(expect.objectContaining({ diff })),
    );
    expect(call).toHaveBeenCalledExactlyOnceWith("get-project-git-diff", {
      ...scope,
      path: "removed.ts",
      staged: true,
    });
  });
  it("ignores a late response after closing the tab or changing its scope", async () => {
    let resolve!: (value: unknown) => void;
    const call = vi.fn().mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const cleanup = setup(call);
    await vi.waitFor(() => expect(call).toHaveBeenCalled());
    if (typeof cleanup === "function") cleanup();
    resolve({ path: "removed.ts" });
    await Promise.resolve();
    await Promise.resolve();
    expect(setResult).not.toHaveBeenCalled();
  });
  it("returns a recoverable error rather than another file's result", async () => {
    setup(vi.fn().mockRejectedValue(new Error("Diff changed. Refresh.")));
    await vi.waitFor(() =>
      expect(setResult).toHaveBeenCalledWith(
        expect.objectContaining({ error: "Diff changed. Refresh." }),
      ),
    );
    expect(setResult.mock.calls.at(-1)![0]).not.toHaveProperty("diff");
  });
});
