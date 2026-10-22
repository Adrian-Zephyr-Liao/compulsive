import { defineRpcFunction } from "devframe";
import { s } from "devframe/utils/simple-schema";
import { projectSession, type EditorSession } from "../project/session.js";
import { createProjectWatcher } from "../project/watch.js";
import {
  projectGitStatus,
  projectGitDiff,
  projectGitHistory,
  projectGitAction,
  projectGitHunk,
  type ProjectGitOperation,
} from "../project/git.js";
import type { RepositoryManager } from "../types.js";
import { objectResult } from "./rpc-schema.js";
import { projectGitDiscardAll } from "../project/git-discard.js";
import { projectGitMessage } from "../project/git-message.js";
export function createEditorFunctions(
  manager: RepositoryManager,
  watcher = createProjectWatcher(manager),
) {
  const scope = { workspaceId: s.string(), repositoryId: s.string() };
  return [
    defineRpcFunction({
      name: "discard-project-git-changes",
      type: "action",
      jsonSerializable: true,
      args: [
        s.object({
          ...scope,
          fingerprint: s.string(),
          confirmed: s.boolean(),
          backup: s.boolean(),
        }),
      ],
      returns: objectResult<Awaited<ReturnType<typeof projectGitDiscardAll>>>(),
      handler: (input) => projectGitDiscardAll(manager, input),
    }),
    defineRpcFunction({
      name: "generate-project-commit-message",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...scope, fingerprint: s.string() })],
      returns: objectResult<Awaited<ReturnType<typeof projectGitMessage>>>(),
      handler: (input) => projectGitMessage(manager, input),
    }),
    defineRpcFunction({
      name: "stage-project-git-hunk",
      type: "action",
      jsonSerializable: true,
      args: [
        s.object({
          ...scope,
          path: s.string(),
          staged: s.boolean(),
          hunk: s.number(),
          fingerprint: s.string(),
        }),
      ],
      returns: objectResult<Awaited<ReturnType<typeof projectGitHunk>>>(),
      handler: (input) => projectGitHunk(manager, input),
    }),
    defineRpcFunction({
      name: "get-editor-session",
      type: "query",
      jsonSerializable: true,
      args: [s.object(scope)],
      returns: objectResult<{ session: EditorSession | null }>(),
      handler: async (input) => ({ session: await projectSession(manager, input) }),
    }),
    defineRpcFunction({
      name: "save-editor-session",
      type: "action",
      jsonSerializable: true,
      args: [s.object({ ...scope, session: objectResult<EditorSession>() })],
      returns: objectResult<{ saved: boolean }>(),
      handler: async (input) => {
        await projectSession(manager, input, input.session);
        return { saved: true };
      },
    }),
    defineRpcFunction({
      name: "wait-project-files",
      type: "query",
      jsonSerializable: true,
      args: [s.object({ ...scope, cursor: s.number() })],
      returns: objectResult<Awaited<ReturnType<typeof watcher.wait>>>(),
      handler: (input) => watcher.wait(input),
    }),
    defineRpcFunction({
      name: "get-project-git-status",
      type: "query",
      jsonSerializable: true,
      args: [s.object(scope)],
      returns: objectResult<Awaited<ReturnType<typeof projectGitStatus>>>(),
      handler: (input) => projectGitStatus(manager, input),
    }),
    defineRpcFunction({
      name: "get-project-git-diff",
      type: "query",
      jsonSerializable: true,
      args: [
        s.object({
          ...scope,
          path: s.string(),
          staged: s.boolean(),
          revision: s.optional(s.string()),
        }),
      ],
      returns: objectResult<Awaited<ReturnType<typeof projectGitDiff>>>(),
      handler: (input) => projectGitDiff(manager, input),
    }),
    defineRpcFunction({
      name: "get-project-git-history",
      type: "query",
      jsonSerializable: true,
      args: [
        s.object({
          ...scope,
          offset: s.number(),
          revision: s.optional(s.string()),
          path: s.optional(s.string()),
        }),
      ],
      returns: objectResult<Awaited<ReturnType<typeof projectGitHistory>>>(),
      handler: (input) => projectGitHistory(manager, input),
    }),
    defineRpcFunction({
      name: "run-project-git-action",
      type: "action",
      jsonSerializable: true,
      args: [
        s.object({
          ...scope,
          operation: s.string(),
          paths: s.array(s.string()),
          fingerprint: s.string(),
          message: s.string(),
          confirmed: s.boolean(),
          expectedVersion: s.string(),
          force: s.optional(s.boolean()),
        }),
      ],
      returns: objectResult<Awaited<ReturnType<typeof projectGitAction>>>(),
      handler: (input) =>
        projectGitAction(manager, { ...input, operation: input.operation as ProjectGitOperation }),
    }),
  ] as const;
}
