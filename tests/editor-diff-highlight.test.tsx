import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EditorDiffCode from "../src/devtool-client/features/editor/components/EditorDiffCode.js";

const mocks = vi.hoisted(() => ({
  values: [] as unknown[],
  stateIndex: 0,
  setState: vi.fn(),
  theme: vi.fn((rules: unknown, options: unknown) => ({ rules, options })),
  basicSetup: vi.fn(() => "basic-setup"),
  syntaxHighlighting: vi.fn((style: unknown) => ({ style })),
  matchFilename: vi.fn(),
  merged: vi.fn(),
  editor: vi.fn(),
  destroy: vi.fn(),
  unified: vi.fn((configuration: unknown) => ({ configuration })),
  defaultStyle: {},
  darkStyle: {},
  languages: [],
  createState: vi.fn(),
  view: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  useEffect: vi.fn(),
  useState: () => [mocks.values[mocks.stateIndex++], mocks.setState],
  useRef: (current: unknown) => ({ current }),
}));
vi.mock("@uiw/react-codemirror", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uiw/react-codemirror")>();
  mocks.createState.mockImplementation(({ doc }: { doc: string }) =>
    actual.EditorState.create({ doc }),
  );
  return {
    ...actual,
    basicSetup: mocks.basicSetup,
    EditorState: {
      readOnly: { of: (value: boolean) => ({ readOnly: value }) },
      create: mocks.createState,
    },
    EditorView: class {
      static theme = mocks.theme;
      static editable = { of: (value: boolean) => ({ editable: value }) };
      static decorations = { of: (value: unknown) => ({ decorations: value }) };
      static updateListener = { of: (value: unknown) => ({ updateListener: value }) };
      static scrollIntoView = vi.fn();
      destroy = mocks.destroy;
      constructor(configuration: { state: unknown }) {
        Object.assign(this, mocks.view(configuration.state));
        mocks.editor(configuration);
      }
    },
  };
});
vi.mock("@codemirror/merge", () => ({
  MergeView: class {
    a;
    b;
    dom = { scrollTop: 0 };
    destroy = mocks.destroy;
    constructor(configuration: { a: { doc: string }; b: { doc: string } }) {
      this.a = mocks.view(mocks.createState(configuration.a));
      this.b = mocks.view(mocks.createState(configuration.b));
      mocks.merged(configuration);
    }
  },
  unifiedMergeView: mocks.unified,
  getChunks: () => ({ chunks: [] }),
}));
vi.mock("@codemirror/language", () => ({
  LanguageDescription: { matchFilename: mocks.matchFilename },
  defaultHighlightStyle: mocks.defaultStyle,
  syntaxHighlighting: mocks.syntaxHighlighting,
}));
vi.mock("@codemirror/language-data", () => ({ languages: mocks.languages }));
vi.mock("@codemirror/theme-one-dark", () => ({ oneDarkHighlightStyle: mocks.darkStyle }));
vi.mock("../src/devtool-client/app/i18n.js", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.matchFilename.mockReturnValue(undefined);
  mocks.view.mockImplementation((state: unknown) => ({
    state,
    dom: { querySelector: () => null },
    contentDOM: { style: { setProperty: vi.fn() } },
    scrollDOM: { scrollTop: 0, clientWidth: 600 },
    dispatch: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function render(
  props: Partial<Parameters<typeof EditorDiffCode>[0]> = {},
  language?: { path: string; support: unknown },
  mounted = true,
) {
  mocks.stateIndex = 0;
  mocks.values = [mounted ? {} : null, language];
  return EditorDiffCode({
    path: "src/example.ts",
    original: "const value = 1;",
    content: "const value = 2;",
    dark: false,
    side: true,
    identity: "working:src/example.ts",
    hunkLabel: "Stage hunk",
    onNavigation: vi.fn(),
    position: { current: undefined },
    ...props,
  });
}

const effect = (index: number) => vi.mocked(useEffect).mock.calls[index]![0]();

describe("diff highlight configuration", () => {
  it.each([
    [false, true],
    [true, true],
    [false, false],
    [true, false],
  ])("uses semantic line and character colors (dark=%s, side=%s)", (dark, sideBySide) => {
    render({ dark, side: sideBySide });
    const cleanup = effect(1);
    expect(mocks.basicSetup).toHaveBeenCalledWith({
      highlightActiveLine: false,
      highlightActiveLineGutter: false,
      highlightSelectionMatches: false,
    });
    expect(mocks.syntaxHighlighting).toHaveBeenCalledWith(
      dark ? mocks.darkStyle : mocks.defaultStyle,
    );
    expect(mocks.theme).toHaveBeenCalledWith(
      expect.objectContaining({
        "&.cm-merge-a .cm-changedLine, .cm-deletedChunk": {
          backgroundColor: "var(--ant-color-error-bg)",
        },
        "&.cm-merge-b .cm-changedLine, .cm-inlineChangedLine": {
          backgroundColor: "var(--ant-color-success-bg)",
        },
        "&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText": {
          background: "var(--ant-color-error-border)",
          borderRadius: "2px",
        },
        "&.cm-merge-b .cm-changedText": {
          background: "var(--ant-color-success-border)",
          borderRadius: "2px",
        },
        "&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter": {
          background: "var(--ant-color-error-text)",
        },
        "&.cm-merge-b .cm-changedLineGutter, .cm-inlineChangedLineGutter": {
          background: "var(--ant-color-success-text)",
        },
      }),
      { dark },
    );
    if (sideBySide) {
      expect(mocks.merged).toHaveBeenCalledWith(
        expect.objectContaining({ highlightChanges: true, gutter: true }),
      );
      expect(mocks.editor).not.toHaveBeenCalled();
    } else {
      expect(mocks.unified).toHaveBeenCalledWith(
        expect.objectContaining({ highlightChanges: true, mergeControls: false }),
      );
      expect(mocks.editor).toHaveBeenCalledOnce();
      expect(mocks.merged).not.toHaveBeenCalled();
    }
    if (typeof cleanup === "function") cleanup();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("loads syntax by filename and applies support only to its matching file", async () => {
    const support = { language: "typescript" };
    const load = vi.fn().mockResolvedValue(support);
    mocks.matchFilename.mockReturnValue({ load });
    render();
    effect(0);
    await Promise.resolve();
    expect(mocks.matchFilename).toHaveBeenCalledWith(mocks.languages, "src/example.ts");
    expect(load).toHaveBeenCalledOnce();
    expect(mocks.setState).toHaveBeenCalledWith({ path: "src/example.ts", support });

    render({}, { path: "src/example.ts", support });
    effect(3);
    expect(mocks.merged.mock.calls.at(-1)![0].a.extensions).toContain(support);
    render({ path: "src/other.json" }, { path: "src/example.ts", support });
    effect(5);
    expect(mocks.merged.mock.calls.at(-1)![0].a.extensions).not.toContain(support);
  });

  it("ignores syntax loading after unmount or switching files", async () => {
    let resolve!: (support: unknown) => void;
    const pending = new Promise((done) => {
      resolve = done;
    });
    mocks.matchFilename.mockReturnValue({ load: () => pending });
    render();
    const cleanup = effect(0);
    if (typeof cleanup === "function") cleanup();
    resolve({ language: "typescript" });
    await pending;
    await Promise.resolve();
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("keeps missing or failed language support readable", async () => {
    render({ path: "notes.unknown" });
    expect(effect(0)).toBeTypeOf("function");
    expect(mocks.setState).not.toHaveBeenCalled();
    mocks.matchFilename.mockReturnValue({ load: () => Promise.reject(new Error("offline")) });
    render();
    effect(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.setState).not.toHaveBeenCalled();
  });

  it("does not initialize CodeMirror before the code surface is mounted", () => {
    render({}, undefined, false);
    expect(effect(1)).toBeUndefined();
    expect(mocks.matchFilename).not.toHaveBeenCalled();
    expect(mocks.basicSetup).not.toHaveBeenCalled();
    expect(mocks.theme).not.toHaveBeenCalled();
    expect(mocks.merged).not.toHaveBeenCalled();
    expect(mocks.editor).not.toHaveBeenCalled();
  });
});
