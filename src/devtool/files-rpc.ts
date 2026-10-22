import { defineRpcFunction } from "devframe";
import { s } from "devframe/utils/simple-schema";
import {
  listProjectDirectory,
  readProjectFile,
  type ProjectDirectory,
  type ProjectFile,
} from "../project/files.js";
import type { RepositoryManager } from "../types.js";
import { objectResult } from "./rpc-schema.js";
import { readProjectAsset } from "../project/assets.js";

export function createFileFunctions(manager: RepositoryManager) {
  const args = [
    s.object({ workspaceId: s.string(), repositoryId: s.string(), path: s.string() }),
  ] as const;
  return [
    defineRpcFunction({
      name: "list-project-directory",
      type: "query",
      jsonSerializable: true,
      args,
      returns: objectResult<ProjectDirectory>(),
      handler: (input) => listProjectDirectory(manager, input),
    }),
    defineRpcFunction({
      name: "read-project-file",
      type: "query",
      jsonSerializable: true,
      args,
      returns: objectResult<ProjectFile>(),
      handler: (input) => readProjectFile(manager, input),
    }),
    defineRpcFunction({
      name: "read-project-asset",
      type: "query",
      jsonSerializable: true,
      args,
      returns: objectResult<Awaited<ReturnType<typeof readProjectAsset>>>(),
      handler: (input) => readProjectAsset(manager, input),
    }),
  ] as const;
}
