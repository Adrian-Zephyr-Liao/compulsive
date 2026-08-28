import { describe, expect, it } from "vitest";

import { formatCdCommand, quoteZsh } from "../src/shell.js";

describe("quoteZsh", () => {
  it("quotes spaces, Chinese characters, and single quotes", () => {
    expect(quoteZsh("/tmp/源码/it's here")).toBe("'/tmp/源码/it'\\''s here'");
  });

  it("formats a safe cd command", () => {
    expect(formatCdCommand("/tmp/My Repo")).toBe("cd -- '/tmp/My Repo'");
  });
});
