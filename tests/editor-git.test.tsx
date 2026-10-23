import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App, ConfigProvider } from "antd";
import { LanguageProvider } from "../src/devtool-client/app/i18n.js";
import EditorGit from "../src/devtool-client/features/editor/components/EditorGit.js";
import { useEditorGit } from "../src/devtool-client/features/editor/hooks/useEditorGit.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";
import { createWorkspaceFunctions } from "../src/devtool/workspace-rpc.js";
import { createRepositoryManager } from "../src/manager.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("editor Git status", () => {
  it("sends the repository branch query through its object schema", async () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => "en-US" },
      navigator: { language: "en-US" },
    });
    const manager = createRepositoryManager();
    const branches = [{ name: "feat/existing", local: true, remote: false }];
    const getBranches = vi.spyOn(manager, "getRepositoryBranches").mockResolvedValue(branches);
    const [, definition] = createWorkspaceFunctions(manager);
    const call = vi.fn(async (name: string, input: unknown) => {
      expect(name).toBe(definition.name);
      const result = await definition.args[0]["~standard"].validate(input);
      if (result.issues) throw new Error(result.issues.map((issue) => issue.message).join("; "));
      return definition.handler!(result.value);
    });
    const getRpc = async () => ({ call }) as unknown as WorkspaceRpc;
    const report = vi.fn();
    const scope = { workspaceId: "workspace:test", repositoryId: "local:test" };
    let git!: ReturnType<typeof useEditorGit>;
    function Harness() {
      git = useEditorGit(getRpc, scope, [], report, vi.fn());
      return null;
    }
    renderToStaticMarkup(
      <LanguageProvider>
        <App>
          <Harness />
        </App>
      </LanguageProvider>,
    );
    await git.loadBranches();
    expect(report).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledWith("get-repository-branches", {
      repositoryId: scope.repositoryId,
    });
    expect(getBranches).toHaveBeenCalledWith(scope.repositoryId);
    await expect(call.mock.results[0]!.value).resolves.toEqual({ branches });
  });

  for (const locale of ["en-US", "zh-CN"])
    it(`does not report excluded changes as a clean repository (${locale})`, () => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => locale },
        navigator: { language: locale },
      });
      const status = {
        excludedChanges: true,
        forcePushRequired: false,
        branch: "feat/test",
        head: "",
        upstream: "",
        ahead: 0,
        behind: 0,
        changes: [],
        fingerprint: "",
      };
      const git: ReturnType<typeof useEditorGit> = {
        status,
        busy: false,
        generating: false,
        generateMessage: vi.fn(async () => {}),
        discardAll: vi.fn(async () => {}),
        recovery: "",
        setRecovery: vi.fn(),
        message: "",
        setMessage: vi.fn(),
        refresh: vi.fn(async () => status),
        run: vi.fn(async () => {}),
        hunk: vi.fn(async () => {}),
        history: {
          open: false,
          path: "",
          commits: [],
          blame: [],
          blameTruncated: false,
          loading: false,
          error: "",
          hasMore: false,
          current: undefined,
          changed: [],
          file: "",
          select: vi.fn(),
          selectFile: vi.fn(),
          loadHistory: vi.fn(async () => {}),
          close: vi.fn(),
          retry: vi.fn(),
          detailLoading: false,
          detailError: undefined,
          diff: undefined,
          diffLoading: false,
          diffError: undefined,
        },
        loadHistory: vi.fn(async () => {}),
        branchOpen: false,
        setBranchOpen: vi.fn(),
        branch: "",
        setBranch: vi.fn(),
        branches: [],
        loadBranches: vi.fn(async () => {}),
        switchBranch: vi.fn(async () => {}),
      };
      const html = renderToStaticMarkup(
        <LanguageProvider>
          <ConfigProvider>
            <EditorGit git={git} dark={false} open={vi.fn()} openDiff={vi.fn()} report={vi.fn()} />
          </ConfigProvider>
        </LanguageProvider>,
      );
      expect(html).toContain('role="status"');
      expect(html).toContain(
        locale === "en-US" ? "Other changes are excluded" : "还有编辑器未展示的变更",
      );
      expect(html).not.toContain(locale === "en-US" ? "Working tree clean" : "工作区干净");
    });
});
