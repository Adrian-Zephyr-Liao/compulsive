import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, translate } from "../src/devtool-client/app/i18n.js";
import { AppearanceProvider } from "../src/devtool-client/app/appearance.js";
import { DevtoolRoutes, routePaths } from "../src/devtool-client/app/routes.js";
import EditorPage from "../src/devtool-client/features/editor/EditorPage.js";
import type { DevtoolWorkspace } from "../src/devtool.js";

const workspace: DevtoolWorkspace = {
  id: "workspace:preview" as DevtoolWorkspace["id"],
  name: "Preview",
  absolutePath: "/example/requirement",
  createdAt: "2026-10-22",
  updatedAt: "2026-10-22",
  cdCommand: "cd /example/requirement",
  members: [
    {
      repositoryId: "host:team/project" as DevtoolWorkspace["members"][number]["repositoryId"],
      alias: "project",
      mode: "link",
    },
  ],
};

afterEach(() => vi.unstubAllGlobals());

describe("project preview route", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    for (const dark of [false, true]) {
      it(`inherits the global theme without creating another RPC connection (${locale}, dark=${dark})`, () => {
        vi.stubGlobal("window", {
          localStorage: { getItem: () => locale },
          navigator: { language: locale },
        });
        const getRpc = vi.fn();
        const onOpenVscode = vi.fn();
        const url = `${routePaths.codePreview(workspace.id, workspace.members[0]!.repositoryId)}?file=src%2Findex.ts`;
        const router = createMemoryRouter(
          [
            {
              path: "*",
              element: (
                <DevtoolRoutes
                  defaultWorkspaceId={workspace.id}
                  requirementExists
                  requirements={<div>repository table</div>}
                  settings={<div>settings page</div>}
                  codePreview={
                    <EditorPage
                      workspace={workspace}
                      getRpc={getRpc}
                      onOpenVscode={onOpenVscode}
                      onThemeChange={vi.fn()}
                    />
                  }
                />
              ),
            },
          ],
          { initialEntries: [url] },
        );
        const html = renderToStaticMarkup(
          <LanguageProvider>
            <AppearanceProvider initialDark={dark}>
              <RouterProvider router={router} />
            </AppearanceProvider>
          </LanguageProvider>,
        );
        expect(html).toContain(translate(locale, "editor.title"));
        expect(html).toContain(dark ? "editor-dark" : "editor-light");
        expect(html).toContain(translate(locale, "editor.saveAll"));
        expect(html).toContain(translate(locale, "editor.files"));
        expect(html).toContain(translate(locale, "editor.reviewChanges"));
        expect(html).toContain(translate(locale, "editor.allFiles"));
        expect(html).toContain(translate(locale, "editor.openVscode"));
        expect(router.state.location.search).toBe("?file=src%2Findex.ts");
        expect(html).not.toContain("repository table");
        expect(html).not.toContain("settings page");
        expect(getRpc).not.toHaveBeenCalled();
        expect(onOpenVscode).not.toHaveBeenCalled();
        router.dispose();
      });
    }
  }
});
