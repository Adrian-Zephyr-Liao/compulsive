import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorHistory } from "../src/devtool-client/features/editor/hooks/useEditorHistory.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";
import type { projectGitHistory } from "../src/project/git.js";

// Run the controller's state/effect lifecycle without installing a second React renderer.
const hooks = vi.hoisted(() => ({
  cursor: 0,
  dirty: false,
  values: new Map<number, unknown>(),
  effects: new Map<number, { deps: unknown[]; cleanup?: (() => void) | undefined }>(),
  pending: [] as (() => void)[],
}));
vi.mock("react", () => ({
  useState: (initial: unknown) => {
    const id = hooks.cursor++;
    if (!hooks.values.has(id)) hooks.values.set(id, initial);
    return [
      hooks.values.get(id),
      (next: unknown) => {
        const value = typeof next === "function" ? next(hooks.values.get(id)) : next;
        if (!Object.is(value, hooks.values.get(id))) {
          hooks.values.set(id, value);
          hooks.dirty = true;
        }
      },
    ];
  },
  useRef: (current: unknown) => {
    const id = hooks.cursor++;
    if (!hooks.values.has(id)) hooks.values.set(id, { current });
    return hooks.values.get(id);
  },
  useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
    const id = hooks.cursor++,
      old = hooks.effects.get(id);
    if (!old || deps.some((dep, index) => !Object.is(dep, old.deps[index]))) {
      hooks.pending.push(() => {
        old?.cleanup?.();
        hooks.effects.set(id, { deps, cleanup: effect() });
      });
    }
  },
}));
beforeEach(() => {
  for (const effect of hooks.effects.values()) effect.cleanup?.();
  hooks.values.clear();
  hooks.effects.clear();
  hooks.pending = [];
});
const scope = { workspaceId: "workspace:test", repositoryId: "local:test" };
const commit = (index: number) => ({
  id: index.toString(16).padStart(40, "a"),
  parents: [],
  author: "CPL Test",
  date: "2026-10-23T10:00:00Z",
  subject: `Commit ${index}`,
});
const page = (count = 2, start = 1): Awaited<ReturnType<typeof projectGitHistory>> => ({
  commits: Array.from({ length: count }, (_, index) => commit(start + index)),
  changed: [],
  blame: [],
  blameTruncated: false,
});
function setup() {
  const call = vi.fn(async (name: string, input: Record<string, unknown>) =>
    name === "get-project-git-diff"
      ? {
          path: input.path,
          original: "old",
          content: "new",
          staged: false,
          fingerprint: "",
          hunks: [],
        }
      : input.revision
        ? { ...page(), changed: ["a.ts", "b.ts"] }
        : page(),
  );
  const getRpc = async () => ({ call }) as unknown as WorkspaceRpc;
  const render = (target = scope) => {
    let result!: ReturnType<typeof useEditorHistory>;
    do {
      hooks.cursor = 0;
      hooks.dirty = false;
      result = useEditorHistory(getRpc, target);
      hooks.pending.splice(0).forEach((effect) => effect());
    } while (hooks.dirty);
    return result;
  };
  return { call, render };
}

describe("commit history controller", () => {
  it("automatically selects a commit and embeds its scoped file diff", async () => {
    const { call, render } = setup();
    await render().loadHistory();
    await vi.waitFor(() => expect(render().diff?.path).toBe("a.ts"));
    expect(render().current?.id).toBe(commit(1).id);
    expect(call).toHaveBeenCalledWith("get-project-git-diff", {
      ...scope,
      path: "a.ts",
      staged: false,
      revision: commit(1).id,
    });
    render().selectFile("b.ts");
    expect(render().diff).toBeUndefined();
    await vi.waitFor(() => expect(render().diff?.path).toBe("b.ts"));
    expect(call.mock.calls.every(([name]) => name.startsWith("get-"))).toBe(true);
  });

  it("keeps all loaded pages and selection when selecting a commit or loading more", async () => {
    const { call, render } = setup();
    call.mockResolvedValueOnce(page(50));
    await render().loadHistory();
    expect(render().hasMore).toBe(true);
    await vi.waitFor(() => expect(render().diff).toBeDefined());
    render().select(commit(40).id);
    render();
    await vi.waitFor(() => expect(render().detailLoading).toBe(false));
    call.mockResolvedValueOnce(page(3, 50));
    await render().loadHistory(50);
    expect(render().commits).toHaveLength(52);
    expect(render().current?.id).toBe(commit(40).id);
    expect(render().hasMore).toBe(false);
  });

  it("ignores a late diff after changing commits, and retains no stale preview on failure", async () => {
    const { call, render } = setup();
    await render().loadHistory();
    await vi.waitFor(() => expect(render().diff).toBeDefined());
    let resolve!: (value: never) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render().selectFile("b.ts");
    render();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    render().select(commit(2).id);
    render();
    await vi.waitFor(() => expect(render().diff).toBeDefined());
    resolve({ path: "late.ts" } as never);
    await Promise.resolve();
    expect(render().diff?.path).toBe("b.ts");
    call.mockRejectedValueOnce(new Error("Preview unavailable"));
    render().selectFile("a.ts");
    render();
    await vi.waitFor(() => expect(render().diffError).toBe("Preview unavailable"));
    expect(render().diff).toBeUndefined();
    render().retry();
    render();
    await vi.waitFor(() => expect(render().diff?.path).toBe("a.ts"));
  });

  it.each(["close", "scope"])("ignores pending list responses after %s", async (action) => {
    const { call, render } = setup();
    let resolve!: (value: ReturnType<typeof page>) => void;
    call.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = render().loadHistory();
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    if (action === "close") render().close();
    const nextScope = action === "scope" ? { ...scope, repositoryId: "local:other" } : scope;
    render(nextScope);
    resolve(page());
    await pending;
    expect(render(nextScope).commits).toHaveLength(0);
    expect(render(nextScope).open).toBe(false);
  });

  it("keeps the file filter and blame during pagination; reports list errors for retry", async () => {
    const { call, render } = setup();
    const blame = [
      { id: commit(1).id, author: "CPL Test", line: 1, content: "hello", summary: "First" },
    ];
    call.mockResolvedValueOnce({ ...page(50), blame });
    await render().loadHistory(0, "", "README.md");
    await vi.waitFor(() => expect(render().diff).toBeDefined());
    call.mockRejectedValueOnce(new Error("Disconnected"));
    await render().loadHistory(50);
    expect(render().error).toBe("Disconnected");
    expect(render().commits).toHaveLength(50);
    expect(render().blame).toEqual(blame);
    expect(call).toHaveBeenLastCalledWith("get-project-git-history", {
      ...scope,
      offset: 50,
      path: "README.md",
    });
    call.mockResolvedValueOnce(page(0));
    await render().loadHistory(50);
    expect(render().error).toBe("");
    expect(render().blame).toEqual(blame);
    expect(render().hasMore).toBe(false);
  });
});
