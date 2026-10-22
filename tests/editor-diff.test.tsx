import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../src/devtool-client/app/i18n.js";
import EditorDiff from "../src/devtool-client/features/editor/components/EditorDiff.js";

afterEach(() => vi.unstubAllGlobals());

describe("embedded diff layout", () => {
  it.each([false, true])(
    "uses the review's retained layout without a modal (side=%s)",
    (sideBySide) => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => "en-US" },
        navigator: { language: "en-US" },
      });
      const html = renderToStaticMarkup(
        <LanguageProvider>
          <EditorDiff
            path="src/index.ts"
            original="before"
            content="after"
            dark={false}
            close={vi.fn()}
            embedded
            sideBySide={sideBySide}
            onSideChange={vi.fn()}
          />
        </LanguageProvider>,
      );
      const selected = html.match(/<label[^>]*ant-segmented-item-selected[\s\S]*?<\/label>/)?.[0];
      expect(selected).toContain(sideBySide ? "Side by side" : "Inline");
      expect(html).toContain('aria-label="Diff · src/index.ts"');
      expect(html).not.toContain('role="dialog"');
    },
  );

  it.each(["en-US", "zh-CN"])(
    "renders both image versions without text hunk controls (%s)",
    (locale) => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => locale },
        navigator: { language: locale },
      });
      const before = "data:image/png;base64,before";
      const after = "data:image/png;base64,after";
      const html = renderToStaticMarkup(
        <LanguageProvider>
          <EditorDiff
            path="logo.png"
            original=""
            content=""
            images={{ original: before, content: after }}
            dark={false}
            close={vi.fn()}
            embedded
          />
        </LanguageProvider>,
      );
      expect(html).toContain(before);
      expect(html).toContain(after);
      expect(html).toContain(locale === "en-US" ? "Before" : "变更前");
      expect(html).toContain(locale === "en-US" ? "After" : "变更后");
      expect(html).not.toContain("ant-segmented");
      expect(html).not.toContain("cm-editor");
    },
  );

  it.each(["original", "content"] as const)(
    "shows the absent image side for %s-only changes",
    (side) => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => "en-US" },
        navigator: { language: "en-US" },
      });
      const html = renderToStaticMarkup(
        <LanguageProvider>
          <EditorDiff
            path="image.png"
            original=""
            content=""
            images={{ [side]: "data:image/png;base64,one" }}
            dark={false}
            close={vi.fn()}
            embedded
          />
        </LanguageProvider>,
      );
      expect(html).toContain("No image in this version");
      expect(html.match(/<img /g)).toHaveLength(1);
    },
  );

  it("keeps an image-to-text replacement readable without interpreting HTML", () => {
    vi.stubGlobal("window", {
      localStorage: { getItem: () => "en-US" },
      navigator: { language: "en-US" },
    });
    const html = renderToStaticMarkup(
      <LanguageProvider>
        <EditorDiff
          path="replaced.png"
          original=""
          content="<script>not executable</script>"
          images={{ original: "data:image/png;base64,original" }}
          dark={false}
          close={vi.fn()}
          embedded
        />
      </LanguageProvider>,
    );
    expect(html).toContain("&lt;script&gt;not executable&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("No image in this version");
  });
});
