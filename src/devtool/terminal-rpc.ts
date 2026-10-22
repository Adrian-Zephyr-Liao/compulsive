import { defineRpcFunction } from "devframe";
import { s } from "devframe/utils/simple-schema";
import type { RepositoryManager } from "../types.js";
import { createProjectTerminals } from "../project/terminals.js";
import { objectResult } from "./rpc-schema.js";

export type ProjectTerminals = ReturnType<typeof createProjectTerminals>;

export function createTerminalFunctions(
  manager: RepositoryManager,
  terminals: ProjectTerminals = createProjectTerminals(manager),
) {
  const project = { workspaceId: s.string(), repositoryId: s.string() };
  const session = { ...project, terminalId: s.string() };
  return [
    defineRpcFunction({
      name: "create-project-terminal",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...project, cols: s.number(), rows: s.number(), confirmed: s.boolean() })],
      returns: objectResult<Awaited<ReturnType<ProjectTerminals["create"]>>>(),
      handler: (input) => terminals.create(input),
    }),
    defineRpcFunction({
      name: "list-project-terminals",
      type: "query",
      jsonSerializable: true,
      args: [s.object(project)],
      returns: objectResult<Awaited<ReturnType<ProjectTerminals["list"]>>>(),
      handler: (input) => terminals.list(input),
    }),
    defineRpcFunction({
      name: "write-project-terminal",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...session, data: s.string() })],
      returns: objectResult<{ accepted: boolean }>(),
      handler: (input) => terminals.write(input),
    }),
    defineRpcFunction({
      name: "resize-project-terminal",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...session, cols: s.number(), rows: s.number() })],
      returns: objectResult<{ resized: boolean }>(),
      handler: (input) => terminals.resize(input),
    }),
    defineRpcFunction({
      name: "close-project-terminal",
      type: "action",
      jsonSerializable: true,
      args: [s.object(session)],
      returns: objectResult<{ closed: boolean }>(),
      handler: (input) => terminals.close(input),
    }),
    defineRpcFunction({
      name: "wait-project-terminal",
      type: "query",
      jsonSerializable: true,
      args: [s.object({ ...session, cursor: s.number() })],
      returns: objectResult<Awaited<ReturnType<ProjectTerminals["wait"]>>>(),
      handler: (input) => terminals.wait(input),
    }),
  ] as const;
}
