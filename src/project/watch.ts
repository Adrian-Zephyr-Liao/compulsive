import { watch, type FSWatcher } from "node:fs";
import { CompulsiveError } from "../errors.js";
import { assertProjectRelativePath, resolveProjectPath } from "./paths.js";
import type { RepositoryManager } from "../types.js";

export function createProjectWatcher(manager: RepositoryManager) {
  let disposed = false;
  const roots = new Map<
    string,
    {
      watcher: FSWatcher;
      seq: number;
      paths: Map<string, number>;
      listeners: Set<() => void>;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function close(root: string) {
    const current = roots.get(root);
    if (!current) return;
    current.watcher.close();
    clearTimeout(current.timer);
    roots.delete(root);
    for (const listener of current.listeners) listener();
  }
  return {
    async wait(input: { workspaceId: string; repositoryId: string; cursor: number }) {
      if (!Number.isSafeInteger(input.cursor) || input.cursor < 0)
        throw new CompulsiveError("INVALID_INPUT", "Invalid file event cursor.");
      const { root } = await resolveProjectPath(manager, { ...input, path: "" });
      if (disposed) throw new CompulsiveError("CONFLICT", "The file event service was closed.");
      let current = roots.get(root);
      if (!current) {
        if (roots.size >= 8)
          throw new CompulsiveError("CONFLICT", "Too many active project watchers.");
        const watcher = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
          const state = roots.get(root);
          if (!state) return;
          const path = filename?.toString().replaceAll("\\", "/") ?? "";
          try {
            assertProjectRelativePath(path);
          } catch {
            return;
          }
          state.paths.set(path, ++state.seq);
          if (state.paths.size > 1000) {
            state.paths.clear();
            state.paths.set("", ++state.seq);
          }
          for (const listener of state.listeners) listener();
        });
        watcher.on("error", () => close(root));
        current = {
          watcher,
          seq: 1,
          paths: new Map([["", 1]]),
          listeners: new Set(),
          timer: setTimeout(() => close(root), 60000),
        };
        current.timer.unref();
        roots.set(root, current);
      }
      clearTimeout(current.timer);
      current.timer = setTimeout(() => close(root), 60000);
      current.timer.unref();
      if (current.listeners.size >= 4)
        throw new CompulsiveError("CONFLICT", "Too many file event readers.");
      if (current.seq === input.cursor)
        await new Promise<void>((resolve) => {
          const state = current!;
          const done = () => {
            clearTimeout(timer);
            state.listeners.delete(done);
            resolve();
          };
          const timer = setTimeout(done, 25000);
          state.listeners.add(done);
        });
      await resolveProjectPath(manager, { ...input, path: "" });
      if (disposed || roots.get(root) !== current)
        throw new CompulsiveError("CONFLICT", "The file event service was closed.");
      return {
        cursor: current.seq,
        paths:
          input.cursor > current.seq
            ? [""]
            : [...current.paths].filter(([, seq]) => seq > input.cursor).map(([path]) => path),
      };
    },
    dispose() {
      disposed = true;
      for (const root of roots.keys()) close(root);
    },
  };
}
