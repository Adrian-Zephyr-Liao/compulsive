import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConfigProvider, theme } from "antd";
import { createThemeConfig } from "../src/devtool-client/app/theme.js";
import { LanguageProvider } from "../src/devtool-client/app/i18n.js";
import { WorkspaceHeader } from "../src/devtool-client/features/workspaces/components/WorkspaceHeader.js";

describe("application theme", () => {
  const luminance = (hex: string) => {
    const rgb = hex
      .replace("#", "")
      .match(/../g)!
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  };
  const contrast = (a: string, b: string) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  it.each([false, true])(
    "uses one semantic palette for page chrome and controls (dark=%s)",
    (dark) => {
      const config = createThemeConfig(dark);
      const tokens = theme.getDesignToken(config);
      expect(config.algorithm).toBe(dark ? theme.darkAlgorithm : theme.defaultAlgorithm);
      expect(config.components?.Layout?.headerBg).toBe(config.token?.colorBgContainer);
      expect(config.components?.Layout?.footerBg).toBe(config.token?.colorBgContainer);
      expect(config.components?.Layout?.bodyBg).toBe(config.token?.colorBgLayout);
      expect(config.components?.Layout?.headerColor).toBe(config.token?.colorText);
      expect(config.token?.colorBgElevated).not.toBe(dark ? "#ffffff" : "#17171c");
      expect(contrast(tokens.colorPrimary, "#ffffff")).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.colorLink, tokens.colorBgContainer)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(tokens.colorPrimaryText, tokens.colorPrimaryBg)).toBeGreaterThanOrEqual(4.5);
      vi.stubGlobal("window", {
        localStorage: { getItem: () => "en-US" },
        navigator: { language: "en-US" },
      });
      try {
        const html = renderToStaticMarkup(
          <LanguageProvider>
            <ConfigProvider theme={config}>
              <WorkspaceHeader
                dark={dark}
                themeBusy={false}
                onThemeChange={() => {}}
                connectionLabel="Connected"
                connectionStatus="success"
                contextLabel="Demo"
                sectionLabel="Requirements"
              />
            </ConfigProvider>
          </LanguageProvider>,
        );
        expect(html).toContain(dark ? "Switch to light mode" : "Switch to dark mode");
        expect(html).not.toContain("bg-white");
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );
});
