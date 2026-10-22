import { defineRpcFunction } from "devframe";
import { s } from "devframe/utils/simple-schema";
import { indexProjectFiles } from "../project/file-index.js";
import { createProjectSearch } from "../project/search.js";
import type { RepositoryManager } from "../types.js";
import { objectResult } from "./rpc-schema.js";

export function createSearchFunctions(manager: RepositoryManager) {
  const search = createProjectSearch(manager);
  const scope = { workspaceId: s.string(), repositoryId: s.string() };
  return [
    defineRpcFunction({
      name: "index-project-files",
      type: "query",
      jsonSerializable: true,
      args: [s.object(scope)],
      returns: objectResult<Awaited<ReturnType<typeof indexProjectFiles>>>(),
      handler: (input) => indexProjectFiles(manager, input),
    }),
    defineRpcFunction({
      name: "search-project-files",
      type: "query",
      jsonSerializable: true,
      args: [
        s.object({
          ...scope,
          requestId: s.string(),
          query: s.string(),
          regex: s.boolean(),
          matchCase: s.boolean(),
          wholeWord: s.boolean(),
          include: s.string(),
          exclude: s.string(),
          offset: s.number(),
          replacement: s.optional(s.string()),
        }),
      ],
      returns: objectResult<Awaited<ReturnType<typeof search.search>>>(),
      handler: (input) => search.search(input),
    }),
    defineRpcFunction({
      name: "cancel-project-search",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...scope, requestId: s.string() })],
      returns: objectResult<ReturnType<typeof search.cancel>>(),
      handler: (input) => search.cancel(input),
    }),
  ] as const;
}
