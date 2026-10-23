import type { ModalProps } from "antd";
import { ConfigProvider, theme } from "antd";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../src/devtool-client/app/i18n.js";
import EditorGitHistory from "../src/devtool-client/features/editor/components/EditorGitHistory.js";
import { useEditorHistory } from "../src/devtool-client/features/editor/hooks/useEditorHistory.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";

vi.mock("antd", async (importOriginal) => ({
  ...(await importOriginal<typeof import("antd")>()),
  // Render portal contents for server-markup assertions; the browser checks the real Modal.
  Modal: ({ open, children, title }: ModalProps) =>
    open ? (
      <div role="dialog">
        {title}
        {children}
      </div>
    ) : null,
}));
afterEach(() => vi.unstubAllGlobals());
const commit = {
  id: "a".repeat(40),
  parents: ["b".repeat(40)],
  author: "CPL Test",
  subject: "fix(editor): keep history selection",
  date: "2026-10-23T10:00:00Z",
};
function render(
  locale: string,
  dark: boolean,
  overrides: Partial<ReturnType<typeof useEditorHistory>> = {},
) {
  vi.stubGlobal("window", {
    localStorage: { getItem: () => locale },
    navigator: { language: locale },
  });
  function Harness() {
    const history = useEditorHistory(async () => ({}) as WorkspaceRpc, {
      workspaceId: "workspace:test",
      repositoryId: "local:test",
    });
    return <EditorGitHistory history={{ ...history, open: true, ...overrides }} dark={dark} />;
  }
  return renderToStaticMarkup(
    <LanguageProvider>
      <ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
        <Harness />
      </ConfigProvider>
    </LanguageProvider>,
  );
}
describe("history presentation", () => {
  for (const locale of ["en-US", "zh-CN"])
    it.each([false, true])(
      `separates the graph and commit details (${locale}, dark=%s)`,
      (dark) => {
        const html = render(locale, dark, {
          commits: [commit],
          current: commit,
          changed: ["src/index.ts"],
          file: "src/index.ts",
        });
        expect(html.match(/role="dialog"/g)).toHaveLength(1);
        expect(html).toContain('aria-current="true"');
        expect(html).toContain('aria-hidden="true"');
        expect(html).toContain('dateTime="2026-10-23T10:00:00Z"');
        expect(html).toContain(locale === "en-US" ? "Commit details" : "提交详情");
        expect(html).toContain(locale === "en-US" ? "Select changed file" : "选择变更文件");
        expect(html).toContain("src/index.ts");
        expect(html).toContain(commit.subject);
        expect(html).not.toContain("editor.history");
      },
    );
  it("provides empty, list failure and detail failure states without stale changes", () => {
    expect(render("en-US", false)).toContain("No commits yet");
    const failedList = render("en-US", false, { error: "Disconnected" });
    expect(failedList).toContain('role="alert"');
    expect(failedList).toContain("Disconnected");
    expect(failedList).toContain("Retry");
    const failedDetail = render("en-US", false, {
      commits: [commit],
      current: commit,
      detailError: "History unavailable",
    });
    expect(failedDetail).toContain("Unable to load commit changes");
    expect(failedDetail).toContain("History unavailable");
    expect(failedDetail).not.toContain("Select changed file");
  });
});
