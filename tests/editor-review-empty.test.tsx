import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageProvider, translate } from "../src/devtool-client/app/i18n.js";
import EditorReview from "../src/devtool-client/features/editor/components/EditorReview.js";
import type { ProjectGitStatus } from "../src/project/git.js";

afterEach(() => vi.unstubAllGlobals());
describe("review empty states", () => {
  for (const locale of ["en-US", "zh-CN"] as const)
    for (const excludedChanges of [false, true])
      it(`does not describe excluded changes as a clean checkout (${locale}, excluded=${excludedChanges})`, () => {
        vi.stubGlobal("window", {
          localStorage: { getItem: () => locale },
          navigator: { language: locale },
        });
        const status: ProjectGitStatus = {
          branch: "feat/task",
          head: "",
          upstream: "",
          ahead: 0,
          behind: 0,
          forcePushRequired: false,
          fingerprint: "snapshot",
          changes: [],
          excludedChanges,
        };
        const getRpc = vi.fn();
        const html = renderToStaticMarkup(
          <LanguageProvider>
            <EditorReview
              active
              dirtyPaths={[]}
              getRpc={getRpc}
              scope={{ workspaceId: "workspace:test", repositoryId: "local:test" }}
              git={{
                status,
                refresh: vi.fn(async () => status),
                busy: false,
                discardAll: vi.fn(async () => {}),
                hunk: vi.fn(async () => {}),
                run: vi.fn(async () => {}),
              }}
              dark={false}
              onOpen={vi.fn()}
              onAllFiles={vi.fn()}
              onOpenVscode={vi.fn()}
              report={vi.fn()}
              onCommit={vi.fn()}
            />
          </LanguageProvider>,
        );
        expect(html).toContain(
          translate(locale, excludedChanges ? "editor.excludedChanges" : "editor.reviewEmpty"),
        );
        if (excludedChanges) expect(html).not.toContain(translate(locale, "editor.reviewEmpty"));
        expect(html).toContain(
          translate(locale, excludedChanges ? "editor.openVscode" : "editor.allFiles"),
        );
        expect(getRpc).not.toHaveBeenCalled();
      });
});
