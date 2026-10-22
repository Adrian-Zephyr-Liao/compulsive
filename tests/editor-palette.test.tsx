import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import EditorPalette from "../src/devtool-client/features/editor/components/EditorPalette.js";

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
  useRef: vi.fn(),
  useMemo: (factory: () => unknown) => factory(),
  useState: (initial: unknown) => [initial, vi.fn()],
}));
vi.mock("../src/devtool-client/app/i18n.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

beforeEach(() => vi.clearAllMocks());

describe("editor palette scrolling effect", () => {
  it.each([
    { browser: "legacy", result: undefined },
    { browser: "promise-returning", result: Promise.resolve({ interrupted: false }) },
    { browser: "no selected item", result: undefined },
  ])("does not register scrolling as cleanup ($browser)", ({ browser, result }) => {
    const scrollIntoView = vi.fn(() => result);
    vi.mocked(useRef).mockReturnValue({
      current: browser === "no selected item" ? null : { scrollIntoView },
    });
    EditorPalette({
      open: false,
      initial: "",
      close: vi.fn(),
      commands: [],
      recent: [],
      record: vi.fn(),
      getRpc: vi.fn(),
      scope: { workspaceId: "workspace:test", repositoryId: "local:test" },
      content: "",
      path: "",
      onFile: vi.fn(),
      report: vi.fn(),
    });
    const scrolling = vi
      .mocked(useEffect)
      .mock.calls.find(([, deps]) => deps?.length === 1 && deps[0] === 0)?.[0];
    expect(scrolling).toBeTypeOf("function");
    expect(scrolling!()).toBeUndefined();
    if (browser !== "no selected item")
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });
});
