import { beforeEach, describe, expect, it, vi } from "vitest";
import { Children, isValidElement, type ReactElement } from "react";
import { Tree } from "antd";
import EditorExplorer from "../src/devtool-client/features/editor/components/EditorExplorer.js";
const update = vi.hoisted(() => vi.fn());
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: () => [[], update],
  useEffect: vi.fn(),
}));
vi.mock("../src/devtool-client/app/i18n.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
function find(element: unknown, type: unknown): ReactElement<Record<string, any>> | undefined {
  if (!isValidElement(element)) return;
  if (element.type === type) return element as ReactElement<Record<string, any>>;
  for (const child of Children.toArray(
    (element.props as { children?: React.ReactNode }).children,
  )) {
    const found = find(child, type);
    if (found) return found;
  }
}
beforeEach(() => vi.clearAllMocks());
describe("editor directory tree", () => {
  it("uses native click expansion and keeps file opening and lazy loading", async () => {
    const props = {
      directories: {
        "": {
          path: "",
          entries: [
            { name: "src", path: "src", directory: true },
            { name: "README.md", path: "README.md", directory: false },
          ],
          truncated: false,
        },
      },
      loading: false,
      path: "README.md",
      changes: [],
      load: vi.fn(async () => {}),
      open: vi.fn(),
      action: vi.fn(),
      refresh: vi.fn(),
      report: vi.fn(),
      name: "Demo",
    };
    const tree = find(EditorExplorer(props), Tree.DirectoryTree)!;
    expect(tree.props.expandAction).toBe("click");
    tree.props.onSelect([], { node: { key: "src", isLeaf: false } });
    expect(props.open).not.toHaveBeenCalled();
    tree.props.onSelect([], { node: { key: "README.md", isLeaf: true } });
    expect(props.open).toHaveBeenCalledWith("README.md");
    tree.props.onExpand(["src"]);
    expect(update).toHaveBeenCalledWith(["src"]);
    await tree.props.loadData({ key: "src" });
    expect(props.load).toHaveBeenCalledWith("src");
    props.load.mockRejectedValueOnce(new Error("unavailable"));
    await tree.props.loadData({ key: "src" });
    expect(props.report).toHaveBeenCalledWith(expect.objectContaining({ message: "unavailable" }));
  });
});
