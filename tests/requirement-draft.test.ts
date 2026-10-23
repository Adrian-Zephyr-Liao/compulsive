import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRequirementDraft } from "../src/devtool-client/features/workspaces/hooks/useRequirementDraft.js";
import type { RepositoryRecord } from "../src/types.js";

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
vi.mock("react", () => ({
  useMemo: (factory: () => unknown) => factory(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = initial;
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] = typeof value === "function" ? value(state.values[index]) : value;
      },
    ];
  },
}));
const repositories = ["one", "two"].map((name) => ({
  id: `local:${name}`,
  name,
  classificationPath: `local/${name}`,
})) as RepositoryRecord[];
function render(busy = false) {
  state.index = 0;
  return useRequirementDraft({
    busy,
    currentWorkspace: undefined,
    repositories,
    workspaceRoot: "/example/Workspaces",
    workspaces: [],
    onResetBranches: vi.fn(),
  });
}
beforeEach(() => {
  state.values = [];
  vi.clearAllMocks();
});

describe("per-repository development choices", () => {
  it("accepts default-branch development without requiring a custom branch", () => {
    let draft = render();
    draft.openCreate();
    draft = render();
    draft.setTargetName("task");
    draft.toggleRepository("local:one");
    draft = render();
    expect(draft.canSubmit).toBe(false);
    draft.setRepositoryDefaultBranch("local:one", true);
    draft = render();
    expect(draft.canSubmit).toBe(true);
    expect(draft.defaultBranchIds).toEqual(["local:one"]);
    expect(render(true).canSubmit).toBe(false);
    draft.setRepositoryDefaultBranch("local:one", false);
    expect(render().canSubmit).toBe(false);
  });
  it("keeps choices independent and excludes reference or deselected repositories", () => {
    let draft = render();
    draft.openCreate();
    draft = render();
    draft.setTargetName("task");
    draft.toggleRepository("local:one");
    draft.toggleRepository("local:two");
    draft = render();
    draft.setRepositoryDefaultBranch("local:one", true);
    draft.setRepositoryBranch("local:two", "feat/custom");
    draft = render();
    expect(draft.canSubmit).toBe(true);
    expect(draft.repositoryBranches["local:two"]).toBe("feat/custom");
    draft.toggleReference("local:one");
    draft = render();
    expect(draft.defaultBranchIds).toEqual([]);
    expect(draft.developmentIds).toEqual(["local:two"]);
    draft.toggleRepository("local:one");
    draft = render();
    draft.toggleRepository("local:one");
    expect(render().defaultBranchIds).toEqual([]);
    draft.openCreate();
    expect(render().selectedIds).toEqual([]);
    expect(render().defaultBranchIds).toEqual([]);
  });
  it("keeps the empty search scoped to selected repositories", () => {
    let draft = render();
    draft.openCreate();
    draft = render();
    expect(draft.filteredRepositories).toEqual([]);
    draft.setRepositoryQuery("two");
    expect(render().filteredRepositories.map(({ repository }) => repository.id)).toEqual([
      "local:two",
    ]);
  });
});
