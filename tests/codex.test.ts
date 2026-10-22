import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startCodexTurn } from "../src/codex.js";

describe.sequential("Codex app-server", () => {
  let binDir = "";
  let originalPath = "";
  let pendingTurn: ReturnType<typeof startCodexTurn> | undefined;

  beforeEach(async () => {
    pendingTurn = undefined;
    originalPath = process.env.PATH ?? "";
    binDir = await mkdtemp(join(tmpdir(), "compulsive-codex-"));
    const executable = join(binDir, "codex");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const { watchFile, unwatchFile } = require("node:fs");
const readline = require("node:readline");
const completionPath = ${JSON.stringify(join(binDir, "complete-turn"))};
const lines = readline.createInterface({ input: process.stdin });
let initialized = false;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    if (message.params.capabilities !== null) process.exit(6);
    setTimeout(() => {
      initialized = true;
      process.stdout.write(JSON.stringify({ id: 0, result: {} }) + "\\n");
    }, 10);
  }
  if (message.method === "initialized" && !initialized) process.exit(4);
  if (message.id === 1) {
    if (!initialized || message.params.ephemeral !== false || message.params.model !== "gpt-6-astra" || message.params.sandbox !== "danger-full-access" || message.params.approvalPolicy !== "never") process.exit(2);
    if (message.params.cwd === "/broken") {
      process.stdout.write(JSON.stringify({ id: 1, error: { code: -32600, message: "invalid sandbox" } }) + "\\n");
      return;
    }
    if (message.params.cwd !== "/workspace" && message.params.cwd !== "/turn-fails" && message.params.cwd !== "/async-fails") process.exit(5);
    process.stdout.write(JSON.stringify({ id: 1, result: { thread: { id: "thread-1" } } }) + "\\n");
  }
  if (message.id === 2) {
    const params = message.params;
    if (params.input[0].text !== "resolve conflicts" || !Array.isArray(params.input[0].text_elements) || params.sandboxPolicy.type !== "dangerFullAccess" || params.approvalPolicy !== "never") process.exit(3);
    if (params.cwd === "/turn-fails") {
      process.stdout.write(JSON.stringify({ id: 2, error: { code: -32600, message: "model unavailable" } }) + "\\n");
      return;
    }
    process.stdout.write(JSON.stringify({ id: 2, result: { turn: { id: "turn-1" } } }) + "\\n");
    if (params.cwd === "/async-fails") {
      process.stdout.write(JSON.stringify({ method: "error", params: { error: { message: "model unavailable" } } }) + "\\n");
      process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { status: "failed" } } }) + "\\n");
      return;
    }
    watchFile(completionPath, { interval: 10 }, (stat) => {
      if (!stat.nlink) return;
      unwatchFile(completionPath);
      process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { status: "completed" } } }) + "\\n");
    });
  }
});
`,
      "utf8",
    );
    await chmod(executable, 0o755);
    process.env.PATH = `${binDir}:${originalPath}`;
  });

  afterEach(async () => {
    process.env.PATH = originalPath;
    try {
      if (pendingTurn) {
        await writeFile(join(binDir, "complete-turn"), "");
        await pendingTurn.then(
          (turn) => turn.completion,
          () => undefined,
        );
      }
    } finally {
      await rm(binDir, { force: true, recursive: true });
    }
  });

  it("returns when a persistent workspace-scoped turn starts", async () => {
    pendingTurn = startCodexTurn("/workspace", "resolve conflicts");
    const result = await pendingTurn;
    expect(result).toMatchObject({
      threadId: "thread-1",
      turnId: "turn-1",
    });
    await writeFile(join(binDir, "complete-turn"), "");
    await expect(result.completion).resolves.toEqual({ status: "completed" });
  });

  it("rejects an empty prompt before starting Codex", async () => {
    await expect(startCodexTurn("/workspace", "  ")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("surfaces the app-server error", async () => {
    await expect(startCodexTurn("/broken", "resolve conflicts")).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
      message: "Codex 任务失败：invalid sandbox",
    });
  });

  it("surfaces a turn startup failure", async () => {
    await expect(startCodexTurn("/turn-fails", "resolve conflicts")).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
      message: "Codex 任务失败：model unavailable",
    });
  });

  it("reports a failure after the turn starts", async () => {
    const turn = await startCodexTurn("/async-fails", "resolve conflicts");

    await expect(turn.completion).resolves.toEqual({
      status: "failed",
      message: "model unavailable",
    });
  });
});
