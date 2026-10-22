import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, translate } from "../src/devtool-client/app/i18n.js";
import EditorDiscardOptions from "../src/devtool-client/features/editor/components/EditorDiscardOptions.js";

afterEach(() => vi.unstubAllGlobals());
describe("discard backup choice", () => {
  it.each(["en-US", "zh-CN"] as const)(
    "defaults to no backup with a visible permanent-loss warning (%s)",
    (locale) => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => locale },
        navigator: { language: locale },
      });
      const html = renderToStaticMarkup(
        <LanguageProvider>
          <EditorDiscardOptions branch="feat/test" count={3} onBackupChange={vi.fn()} />
        </LanguageProvider>,
      );
      expect(html).toContain('type="checkbox"');
      expect(html).not.toContain('checked=""');
      expect(html).toContain(translate(locale, "editor.discardBackup"));
      expect(html).toContain(translate(locale, "editor.discardNoBackupHint"));
    },
  );
});
