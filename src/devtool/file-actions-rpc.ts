import { defineRpcFunction } from "devframe";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveProjectPath } from "../project/paths.js";
import { s } from "devframe/utils/simple-schema";
import type { RepositoryManager } from "../types.js";
import {
  createProjectItem,
  inspectProjectItem,
  renameProjectItem,
  saveProjectFile,
  trashProjectItem,
} from "../project/mutations.js";
import { objectResult } from "./rpc-schema.js";

export function createFileActionFunctions(manager: RepositoryManager) {
  const scope = { workspaceId: s.string(), repositoryId: s.string(), path: s.string() };
  return [
    defineRpcFunction({
      name: "reveal-project-item",
      type: "action",
      jsonSerializable: true,
      args: [s.object(scope)],
      returns: objectResult<{ revealed: boolean }>(),
      handler: async (input) => {
        const { target } = await resolveProjectPath(manager, input);
        await promisify(execFile)("open", ["-R", target], { timeout: 10000 });
        return { revealed: true };
      },
    }),
    defineRpcFunction({
      name: "inspect-project-item",
      type: "query",
      jsonSerializable: true,
      args: [s.object(scope)],
      returns: objectResult<Awaited<ReturnType<typeof inspectProjectItem>>>(),
      handler: (input) => inspectProjectItem(manager, input),
    }),
    defineRpcFunction({
      name: "save-project-file",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...scope, content: s.string(), expectedVersion: s.string() })],
      returns: objectResult<Awaited<ReturnType<typeof saveProjectFile>>>(),
      handler: (input) => saveProjectFile(manager, input),
    }),
    defineRpcFunction({
      name: "create-project-item",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...scope, directory: s.boolean() })],
      returns: objectResult<Awaited<ReturnType<typeof createProjectItem>>>(),
      handler: (input) => createProjectItem(manager, input),
    }),
    defineRpcFunction({
      name: "rename-project-item",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...scope, destination: s.string(), expectedIdentity: s.string() })],
      returns: objectResult<Awaited<ReturnType<typeof renameProjectItem>>>(),
      handler: (input) => renameProjectItem(manager, input),
    }),
    defineRpcFunction({
      name: "trash-project-item",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...scope, confirmedPath: s.string(), expectedIdentity: s.string() })],
      returns: objectResult<Awaited<ReturnType<typeof trashProjectItem>>>(),
      handler: (input) => trashProjectItem(manager, input),
    }),
  ] as const;
}
