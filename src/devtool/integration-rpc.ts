import { type CodexTurn, type CodexTurnCompletion, startCodexTurn } from "../codex.js";
import { CompulsiveError } from "../errors.js";
import { defineRpcFunction } from "devframe";
import { s } from "devframe/utils/simple-schema";
import { objectResult } from "./rpc-schema.js";
import { type RepositoryManager } from "../types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createIntegrationFunctions(manager: RepositoryManager) {
  const activeCodexTurns = new Map<string, Promise<CodexTurn>>();

  const codexCompletions = new Map<string, Promise<CodexTurnCompletion>>();

  async function getWorkspaceMemberPath(
    workspaceId: string,
    repositoryId: string,
  ): Promise<string> {
    const workspace = (await manager.searchWorkspaces()).find(({ id }) => id === workspaceId);
    const member = workspace?.members.find(({ repositoryId: id }) => id === repositoryId);
    if (!workspace || !member) {
      throw new CompulsiveError("NOT_FOUND", "Workspace member is not registered.");
    }
    const repository = (await manager.search()).find(({ id }) => id === repositoryId);
    if (!repository) throw new CompulsiveError("NOT_FOUND", "Repository is not registered.");
    return member.mode === "worktree" ? member.worktreePath : repository.absolutePath;
  }

  const openWorkspaceMemberInVscode = defineRpcFunction({
    name: "open-workspace-member-in-vscode",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string() })],
    returns: objectResult<{ opened: string }>(),
    handler: async ({ workspaceId, repositoryId }): Promise<{ opened: string }> => {
      const path = await getWorkspaceMemberPath(workspaceId, repositoryId);
      try {
        await execFileAsync("/usr/bin/open", ["-a", "Visual Studio Code", path]);
      } catch (error) {
        throw new CompulsiveError("FILESYSTEM_FAILED", "Unable to open Visual Studio Code.", {
          cause: error,
        });
      }
      return { opened: path };
    },
  });

  const openWorkspaceMemberInCodex = defineRpcFunction({
    name: "open-workspace-member-in-codex",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string(), repositoryId: s.string(), prompt: s.string() })],
    returns: objectResult<{ opened: string; threadId: string; turnId: string }>(),
    handler: async ({
      workspaceId,
      repositoryId,
      prompt,
    }): Promise<{
      opened: string;
      threadId: string;
      turnId: string;
    }> => {
      const path = await getWorkspaceMemberPath(workspaceId, repositoryId);
      const memberKey = `${workspaceId}:${repositoryId}`;
      let pendingTurn = activeCodexTurns.get(memberKey);
      if (!pendingTurn) {
        pendingTurn = startCodexTurn(path, prompt);
        activeCodexTurns.set(memberKey, pendingTurn);
      }
      try {
        const { threadId, turnId, completion } = await pendingTurn;
        codexCompletions.set(turnId, completion);
        void completion.then(() => {
          if (activeCodexTurns.get(memberKey) === pendingTurn) activeCodexTurns.delete(memberKey);
        });
        return { opened: path, threadId, turnId };
      } catch (error) {
        if (activeCodexTurns.get(memberKey) === pendingTurn) activeCodexTurns.delete(memberKey);
        throw error;
      }
    },
  });

  const waitForCodexTurn = defineRpcFunction({
    name: "wait-for-codex-turn",
    type: "query",
    jsonSerializable: true,
    args: [s.object({ turnId: s.string() })],
    returns: objectResult<CodexTurnCompletion>(),
    handler: ({ turnId }): Promise<CodexTurnCompletion> => {
      const completion = codexCompletions.get(turnId);
      if (!completion) throw new CompulsiveError("NOT_FOUND", "Codex turn is not registered.");
      return completion;
    },
  });

  const openWorkspaceInChatgpt = defineRpcFunction({
    name: "open-workspace-in-chatgpt",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ workspaceId: s.string() })],
    returns: objectResult<{ opened: string }>(),
    handler: async ({ workspaceId }): Promise<{ opened: string }> => {
      const workspace = (await manager.searchWorkspaces()).find(({ id }) => id === workspaceId);
      if (!workspace) throw new CompulsiveError("NOT_FOUND", "Workspace is not registered.");
      await execFileAsync("codex", ["app", workspace.absolutePath]);
      return { opened: workspace.absolutePath };
    },
  });
  return [
    openWorkspaceMemberInVscode,
    openWorkspaceMemberInCodex,
    waitForCodexTurn,
    openWorkspaceInChatgpt,
  ] as const;
}
