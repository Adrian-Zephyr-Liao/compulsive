import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorDocuments } from "../src/devtool-client/features/editor/hooks/useEditorDocuments.js";
import type { WorkspaceRpc } from "../src/devtool-client/features/workspaces/types.js";
import type { ProjectFile } from "../src/project/files.js";

vi.mock("react", () => ({
  useState: (value: unknown) => [value, vi.fn()],
  useRef: (current: unknown) => ({ current }),
  useEffect: vi.fn(),
  useCallback: (callback: unknown) => callback,
}));

const scope = { workspaceId: "workspace:test", repositoryId: "local:test" };
const file: ProjectFile = { path: "a.ts", content: "original", bytes: 8, version: "v1" };
beforeEach(() => vi.clearAllMocks());

async function setup() {
  let finish!: (value: ProjectFile) => void;
  const response = new Promise<ProjectFile>((resolve) => {
    finish = resolve;
  });
  const call = vi.fn(async (name: string) => (name === "save-project-file" ? response : file));
  const editor = useEditorDocuments(async () => ({ call }) as unknown as WorkspaceRpc, scope);
  await editor.loadDocument(file.path);
  editor.editDocument(file.path, "submitted edit");
  return { editor, call, finish };
}

describe("editor save responses", () => {
  it("does not resurrect a document closed while its save is pending", async () => {
    const { editor, call, finish } = await setup();
    const pending = editor.save(file.path);
    await vi.waitFor(() =>
      expect(call).toHaveBeenCalledWith("save-project-file", expect.anything()),
    );
    editor.updateDocuments((current) => {
      const next = { ...current };
      delete next[file.path];
      return next;
    });
    finish({ ...file, content: "submitted edit", bytes: 14, version: "v2" });
    await pending;
    expect(editor.docsRef.current).toEqual({});
    await editor.saveAll();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    "retains newer typing after a save response (reopened=%s)",
    async (reopen) => {
      const { editor, call, finish } = await setup();
      const pending = editor.save(file.path);
      await vi.waitFor(() =>
        expect(call).toHaveBeenCalledWith("save-project-file", expect.anything()),
      );
      if (reopen) {
        editor.updateDocuments(() => ({}));
        await editor.loadDocument(file.path);
      }
      editor.editDocument(file.path, "newer typing");
      finish({ ...file, content: "submitted edit", bytes: 14, version: "v2" });
      await pending;
      expect(call).toHaveBeenCalledWith("save-project-file", {
        ...scope,
        path: file.path,
        content: "submitted edit",
        expectedVersion: "v1",
      });
      expect(editor.docsRef.current[file.path]).toEqual({
        ...file,
        content: "newer typing",
        saved: "submitted edit",
        bytes: 14,
        version: "v2",
        conflict: false,
      });
    },
  );
});
