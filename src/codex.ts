import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import pkg from "../package.json" with { type: "json" };
import { CompulsiveError } from "./errors.js";

export interface CodexTurn {
  threadId: string;
  turnId: string;
}

interface AppServerMessage {
  id?: number;
  method?: string;
  error?: { code?: number; message?: string };
  params?: {
    error?: { message?: string };
    turn?: { status?: string };
  };
  result?: {
    thread?: { id?: string };
    turn?: { id?: string };
  };
}

export async function startCodexTurn(cwd: string, prompt: string): Promise<CodexTurn> {
  if (!prompt.trim()) throw new CompulsiveError("INVALID_INPUT", "Codex prompt is required.");

  const child = spawn("codex", ["app-server"], { stdio: ["pipe", "pipe", "pipe"] });
  const lines = createInterface({ input: child.stdout });
  let stderr = "";
  let settled = false;
  let currentThreadId = "";
  let currentTurnId = "";
  let turnError = "";
  let lifetimeTimer: NodeJS.Timeout | undefined;

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-4_000);
  });

  return await new Promise<CodexTurn>((resolve, reject) => {
    const startTimer = setTimeout(
      () => fail(new Error("Timed out while starting the Codex session.")),
      20_000,
    );

    function stop(): void {
      clearTimeout(startTimer);
      if (lifetimeTimer) clearTimeout(lifetimeTimer);
      lines.close();
      if (!child.killed) child.kill();
    }

    function fail(error: unknown): void {
      if (settled) return;
      settled = true;
      stop();
      const message = error instanceof Error ? error.message : String(error);
      reject(
        new CompulsiveError("FILESYSTEM_FAILED", `Codex 临时任务失败：${message}`, {
          cause: message,
          stderr: stderr.trim(),
        }),
      );
    }

    function send(message: object): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    child.once("error", fail);
    child.stdin.once("error", fail);
    child.once("close", (code) => {
      if (!settled) fail(new Error(`Codex app-server exited with code ${String(code)}.`));
    });
    lines.on("line", (line) => {
      let message: AppServerMessage;
      try {
        message = JSON.parse(line) as AppServerMessage;
      } catch {
        return;
      }

      if (message.method === "error") {
        turnError = message.params?.error?.message ?? "Codex turn failed.";
        return;
      }
      if (message.method === "turn/completed") {
        const status = message.params?.turn?.status;
        if (status !== "completed") {
          fail(new Error(turnError || `Codex turn ended with status ${status ?? "unknown"}.`));
          return;
        }
        if (!currentThreadId || !currentTurnId) {
          fail(new Error("Codex turn identifiers are missing."));
          return;
        }
        settled = true;
        stop();
        resolve({ threadId: currentThreadId, turnId: currentTurnId });
        return;
      }
      if (message.id === 0) {
        if (message.error) {
          fail(new Error(message.error.message ?? "Codex initialization failed."));
          return;
        }
        send({ method: "initialized", params: {} });
        send({
          method: "thread/start",
          id: 1,
          params: {
            cwd,
            approvalPolicy: "never",
            ephemeral: true,
            model: "gpt-6-astra",
            sandbox: "workspace-write",
            serviceName: "compulsive",
          },
        });
        return;
      }
      if (message.id === 1) {
        const threadId = message.result?.thread?.id;
        if (message.error || !threadId) {
          fail(new Error(message.error?.message ?? "Codex did not create a thread."));
          return;
        }
        currentThreadId = threadId;
        send({
          method: "turn/start",
          id: 2,
          params: {
            threadId,
            input: [{ type: "text", text: prompt }],
            cwd,
            approvalPolicy: "never",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: [cwd],
              networkAccess: false,
            },
          },
        });
        return;
      }
      if (message.id === 2) {
        const turnId = message.result?.turn?.id;
        if (message.error || !turnId) {
          fail(new Error(message.error?.message ?? "Codex did not start the turn."));
          return;
        }
        if (!currentThreadId) {
          fail(new Error("Codex thread id is missing."));
          return;
        }
        currentTurnId = turnId;
        clearTimeout(startTimer);
        lifetimeTimer = setTimeout(
          () => fail(new Error("Timed out while waiting for the Codex turn to complete.")),
          60 * 60 * 1_000,
        );
        lifetimeTimer.unref();
      }
    });

    send({
      method: "initialize",
      id: 0,
      params: {
        clientInfo: { name: "compulsive", title: "Compulsive", version: pkg.version },
      },
    });
  });
}
