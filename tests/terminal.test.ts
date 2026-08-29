import { describe, expect, it } from "vitest";

import { createTerminalTheme } from "../src/terminal.js";

describe("terminal theme", () => {
  it("uses readable ASCII output without ANSI codes when styling is disabled", () => {
    const theme = createTerminalTheme({ color: "never", unicode: false, isTTY: true });

    expect(theme.success("Initialized", "/tmp/source")).toBe("OK Initialized\n   /tmp/source");
    expect(theme.warning("Clipboard unavailable")).toBe("! Clipboard unavailable");
    expect(theme.error("INVALID_INPUT", "Bad flag")).toBe("x INVALID_INPUT\n\n  Bad flag");
    expect(theme.header("organize plan")).toBe("cpl  organize plan");
    expect(theme.move("compulsive", "local/compulsive", "github.com/acme/compulsive")).toBe(
      "MOVE  compulsive\n      local/compulsive\n   -> github.com/acme/compulsive",
    );
    expect(theme.summary(["2 moves", "1 warning", "no files changed"])).toBe(
      "2 moves · 1 warning · no files changed",
    );
  });

  it("honors forced colors outside a TTY", () => {
    const theme = createTerminalTheme({ color: "always", unicode: true, isTTY: false });

    expect(theme.success("Ready")).toContain(`${String.fromCharCode(27)}[`);
    expect(theme.success("Ready")).toContain("◆");
  });

  it("formats repository records as compact two-line cards", () => {
    const theme = createTerminalTheme({ color: "never", unicode: true, isTTY: false });

    expect(
      theme.repository("github.com/vuejs/core", "/Users/me/Desktop/源码/github.com/vuejs/core"),
    ).toBe("◇ github.com/vuejs/core\n  /Users/me/Desktop/源码/github.com/vuejs/core");
  });

  it("formats warnings with an optional subject", () => {
    const theme = createTerminalTheme({ color: "never", unicode: true, isTTY: false });

    expect(theme.warning("Repository has uncommitted changes.", "compulsive")).toBe(
      "▲ compulsive\n  Repository has uncommitted changes.",
    );
    expect(theme.empty("No new repositories found.")).toBe("No new repositories found.");
  });
});
