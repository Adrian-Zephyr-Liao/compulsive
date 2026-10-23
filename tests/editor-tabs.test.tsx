import { renderToStaticMarkup } from "react-dom/server";
import { ConfigProvider } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../src/devtool-client/app/i18n.js";
import { createThemeConfig } from "../src/devtool-client/app/theme.js";
import EditorFileTabs from "../src/devtool-client/features/editor/components/EditorFileTabs.js";

afterEach(() => vi.unstubAllGlobals());

describe("native editor tabs", () => {
  for (const dark of [false, true]) {
    it(`keeps source/preview tabs distinct and marks dirty buffers without hiding close (dark=${dark})`, () => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => "en-US" },
        navigator: { language: "en-US" },
      });
      const close = vi.fn();
      const html = renderToStaticMarkup(
        <LanguageProvider>
          <ConfigProvider theme={createThemeConfig(dark)}>
            <EditorFileTabs
              column={{
                id: "column-a",
                active: "README.md",
                tabs: [
                  { path: "README.md", pinned: true, preview: false, cursor: 5, scroll: 0 },
                  { path: "README.md", pinned: true, preview: true, cursor: 0, scroll: 0 },
                  {
                    path: "README.md",
                    pinned: true,
                    preview: false,
                    diff: "staged",
                    cursor: 0,
                    scroll: 0,
                  },
                  {
                    path: "README.md",
                    pinned: true,
                    preview: false,
                    diff: "working",
                    cursor: 0,
                    scroll: 0,
                  },
                ],
              }}
              editor={{
                close,
                setColumns: vi.fn(),
                documents: {
                  "README.md": {
                    path: "README.md",
                    content: "edited",
                    saved: "original",
                    version: "v1",
                    bytes: 6,
                    conflict: false,
                  },
                },
              }}
            >
              <div>active editor buffer</div>
            </EditorFileTabs>
          </ConfigProvider>
        </LanguageProvider>,
      );
      expect(html).toContain("ant-tabs-editable-card");
      expect(html.match(/role="tab"/g)).toHaveLength(4);
      expect(html.match(/ant-tabs-tab-remove/g)).toHaveLength(4);
      expect(html).toContain("Staged");
      expect(html).toContain("Changes");
      expect(html.match(/ant-badge-status-dot/g)).toHaveLength(2);
      expect(html).toContain("ant-badge-status-dot");
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('aria-label="Close"');
      expect(html).toContain('role="tabpanel"');
      expect(html).toContain('style="height:100%;overflow:hidden"');
      expect(html.match(/active editor buffer/g)).toHaveLength(1);
      expect(close).not.toHaveBeenCalled();
    });
  }
});
