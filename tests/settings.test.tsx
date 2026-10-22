import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LanguageProvider, translate } from "../src/devtool-client/app/i18n.js";
import type { AppLocale } from "../src/devtool-client/app/i18n.js";
import { DoctorPanel } from "../src/devtool-client/features/settings/DoctorPanel.js";
import { SystemSettingsPage } from "../src/devtool-client/features/settings/SystemSettingsPage.js";
import type { ManagerConfig } from "../src/types.js";

const config: ManagerConfig = {
  schemaVersion: 1,
  rootDir: "/example/Code",
  workspaceRoot: "/example/Workspaces",
  scanRoots: [],
};

function setLocale(locale: AppLocale) {
  vi.stubGlobal("window", {
    localStorage: { getItem: () => locale },
    navigator: { language: locale },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("settings presentation boundaries", () => {
  for (const locale of ["zh-CN", "en-US"] as const) {
    it(`keeps storage and diagnostic content on separate routes (${locale})`, () => {
      setLocale(locale);
      const getRpc = vi.fn();
      const runDoctor = vi.fn(async () => []);
      function render(path: string) {
        return renderToStaticMarkup(
          <LanguageProvider>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route
                  path="/settings/*"
                  element={
                    <SystemSettingsPage
                      config={config}
                      disabled={false}
                      saving={false}
                      getRpc={getRpc}
                      onRunDoctor={runDoctor}
                      onWorktreeRemoved={vi.fn()}
                      onSave={vi.fn()}
                    />
                  }
                />
              </Routes>
            </MemoryRouter>
          </LanguageProvider>,
        );
      }
      const storage = render("/settings/storage");
      expect(storage).toContain('id="settings-configuration-title"');
      expect(storage).toContain(translate(locale, "settings.repositoryRoot"));
      expect(storage).not.toContain('id="settings-doctor-title"');
      const doctor = render("/settings/doctor");
      expect(doctor).toContain('id="settings-doctor-title"');
      expect(doctor).toContain(translate(locale, "doctor.notRunTitle"));
      expect(doctor).not.toContain('id="settings-configuration-title"');
      expect(runDoctor).not.toHaveBeenCalled();
      expect(getRpc).not.toHaveBeenCalled();
    });

    it(`renders diagnostic failures and healthy-member counts (${locale})`, () => {
      setLocale(locale);
      const html = renderToStaticMarkup(
        <LanguageProvider>
          <DoctorPanel
            disabled={false}
            doctorRunning={false}
            doctorCheckedAt={new Date("2026-10-21T00:00:00Z")}
            doctorChecks={[
              { name: "git", ok: true, detail: "git version test" },
              { name: "workspace:example/broken", ok: false, detail: "Missing managed link" },
              { name: "workspace:example/healthy", ok: true, detail: "Linked worktree" },
            ]}
            runDoctor={vi.fn()}
          />
        </LanguageProvider>,
      );
      expect(html).toContain("git version test");
      expect(html).toContain("example/broken");
      expect(html).toContain("Missing managed link");
      expect(html).toContain(translate(locale, "doctor.failedSummary", { count: 1 }));
      expect(html).toContain(translate(locale, "doctor.healthyMembers", { count: 1 }));
    });
  }
});
