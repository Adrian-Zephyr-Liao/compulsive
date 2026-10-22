import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type { EditorDocument, EditorScope } from "../types.js";
import { loadedEditorDocument, savedEditorDocument } from "../utils/editorState.js";

export function useEditorDocuments(getRpc: () => Promise<WorkspaceRpc>, scope: EditorScope) {
  const { workspaceId, repositoryId } = scope;
  const [documents, setDocuments] = useState<Record<string, EditorDocument>>({});
  const docsRef = useRef(documents);
  const updateDocuments = useCallback(
    (update: (current: Record<string, EditorDocument>) => Record<string, EditorDocument>) => {
      const next = update(docsRef.current);
      docsRef.current = next;
      setDocuments(next);
    },
    [],
  );
  const alive = useRef(true);
  const pending = useRef(new Map<string, Promise<void>>());
  const saves = useRef(new Map<string, Promise<void>>());
  const [comparison, setComparison] = useState<{
    path: string;
    original: string;
    content: string;
  }>();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const loadDocument = useCallback(
    async (path: string, mode: "cached" | "refresh" | "reload" = "cached") => {
      if (docsRef.current[path] && mode === "cached") return;
      if (pending.current.has(path)) return pending.current.get(path);
      const task = (async () => {
        const rpc = await getRpc();
        const image = /\.(png|jpe?g|gif|webp|bmp)$/i.test(path);
        const asset = image
          ? await rpc.call("read-project-asset", { workspaceId, repositoryId, path })
          : undefined;
        const file = asset
          ? { path, content: "", bytes: asset.bytes, version: "", asset: asset.url }
          : await rpc.call("read-project-file", { workspaceId, repositoryId, path });
        if (!alive.current) return;
        updateDocuments((current) => ({
          ...current,
          [path]: loadedEditorDocument(current[path], file, mode === "reload"),
        }));
      })().finally(() => pending.current.delete(path));
      pending.current.set(path, task);
      return task;
    },
    [getRpc, workspaceId, repositoryId, updateDocuments],
  );
  function save(path: string): Promise<void> {
    const previous = saves.current.get(path);
    if (previous) return previous.then(() => save(path));
    const operation = performSave(path).finally(() => {
      if (saves.current.get(path) === operation) saves.current.delete(path);
    });
    saves.current.set(path, operation);
    return operation;
  }
  async function performSave(path: string) {
    const document = docsRef.current[path];
    if (!document || document.content === document.saved) return;
    const content = document.content;
    const file = await (
      await getRpc()
    ).call("save-project-file", {
      workspaceId,
      repositoryId,
      path,
      content,
      expectedVersion: document.version,
    });
    if (alive.current)
      updateDocuments((current) =>
        current[path]
          ? { ...current, [path]: savedEditorDocument(current[path], file, content) }
          : current,
      );
  }
  async function saveAll() {
    for (const document of Object.values(docsRef.current))
      if (document.content !== document.saved) await save(document.path);
  }
  function editDocument(path: string, content: string) {
    updateDocuments((current) => {
      const doc = current[path];
      return !doc || doc.content === content
        ? current
        : { ...current, [path]: { ...doc, content } };
    });
  }
  async function compare(path: string) {
    const disk = await (await getRpc()).call("read-project-file", { ...scope, path });
    if (alive.current)
      setComparison({
        path,
        original: docsRef.current[path]?.content ?? "",
        content: disk.content,
      });
  }
  return {
    documents,
    docsRef,
    updateDocuments,
    alive,
    loadDocument,
    save,
    saveAll,
    editDocument,
    comparison,
    setComparison,
    compare,
    dirty: Object.values(documents).filter((doc) => doc.content !== doc.saved),
  };
}
