import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import EditorFileIcon from "../src/devtool-client/features/editor/components/EditorFileIcon.js";
describe("editor file-type icon theme", () => {
  it.each([
    ["README.MD", "file-markdown"],
    ["preview.png", "file-image"],
    ["App.tsx", "api"],
    ["index.ts", "code"],
    ["index.js", "code"],
    ["package.json", "setting"],
    [".gitignore", "branches"],
    ["index.html", "html5"],
    ["report.pdf", "file-pdf"],
    ["data.csv", "file-excel"],
    ["archive.zip", "file-zip"],
    ["LICENSE", "file-text"],
  ])("recognizes %s without external image requests", (name, icon) => {
    const html = renderToStaticMarkup(<EditorFileIcon name={name} />);
    expect(html).toContain(`data-icon="${icon}"`);
    expect(html).toContain("var(--ant-color-");
    expect(html).not.toContain("<img");
  });
  it("distinguishes open and closed folders", () => {
    expect(renderToStaticMarkup(<EditorFileIcon name="src" directory />)).toContain(
      'data-icon="folder"',
    );
    expect(renderToStaticMarkup(<EditorFileIcon name="src" directory expanded />)).toContain(
      'data-icon="folder-open"',
    );
  });
  it("inherits selected-row contrast instead of forcing a type color", () => {
    expect(renderToStaticMarkup(<EditorFileIcon name="app.ts" selected />)).toContain(
      'style="color:inherit"',
    );
  });
});
