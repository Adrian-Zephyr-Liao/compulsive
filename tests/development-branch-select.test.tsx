import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider } from "../src/devtool-client/app/i18n.js";
import { DevelopmentBranchSelect } from "../src/devtool-client/features/workspaces/components/DevelopmentBranchSelect.js";
afterEach(() => vi.unstubAllGlobals());
describe("development branch selector", () => {
  it.each(["zh-CN", "en-US"])(
    "shows a default-branch choice without a custom input (%s)",
    (locale) => {
      vi.stubGlobal("window", {
        localStorage: { getItem: () => locale },
        navigator: { language: locale },
      });
      const render = (useDefaultBranch: boolean) =>
        renderToStaticMarkup(
          <LanguageProvider>
            <DevelopmentBranchSelect
              useDefaultBranch={useDefaultBranch}
              onDefaultBranchChange={vi.fn()}
              value="feat/task"
              branches={[]}
              loading={false}
              onChange={vi.fn()}
              onFocus={vi.fn()}
              name="developmentBranch"
            />
          </LanguageProvider>,
        );
      const defaultMode = render(true);
      expect(defaultMode).toContain(locale === "zh-CN" ? "主分支开发" : "Default branch");
      expect(defaultMode).toContain(
        locale === "zh-CN" ? "不会强制抢占" : "instead of forcing checkout",
      );
      expect(defaultMode).not.toContain('name="developmentBranch"');
      expect(render(false)).toContain('name="developmentBranch"');
    },
  );
});
