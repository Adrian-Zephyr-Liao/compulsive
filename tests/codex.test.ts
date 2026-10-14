import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startCodexTurn } from "../src/codex.js";

describe.sequential("Codex app-server", () => {
  let binDir = "";
  let originalPath = "";

  beforeEach(async () => {
    originalPath = process.env.PATH ?? "";
    binDir = await mkdtemp(join(tmpdir(), "compulsive-codex-"));
    const executable = join(binDir, "codex");
    await writeFile(
      executable,
      `#!/usr/bin/env node
const readline = require("node:readline");
const lines = readline.createInterface({ input: process.stdin });
let initialized = false;
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === 0) {
    setTimeout(() => {
      initialized = true;
      process.stdout.write(JSON.stringify({ id: 0, result: {} }) + "\\n");
    }, 10);
  }
  if (message.method === "initialized" && !initialized) process.exit(4);
  if (message.id === 1) {
    if (!initialized || !message.params.ephemeral || message.params.model !== "gpt-6-astra" || message.params.sandbox !== "workspace-write") process.exit(2);
    if (message.params.cwd === "/broken") {
      process.stdout.write(JSON.stringify({ id: 1, error: { code: -32600, message: "invalid sandbox" } }) + "\\n");
      return;
    }
    if (message.params.cwd !== "/workspace" && message.params.cwd !== "/turn-fails") process.exit(5);
    process.stdout.write(JSON.stringify({ id: 1, result: { thread: { id: "thread-1" } } }) + "\\n");
  }
  if (message.id === 2) {
    const params = message.params;
    if (params.input[0].text !== "resolve conflicts" || params.sandboxPolicy.networkAccess !== false) process.exit(3);
    process.stdout.write(JSON.stringify({ id: 2, result: { turn: { id: "turn-1" } } }) + "\\n");
    if (params.cwd === "/turn-fails") {
      process.stdout.write(JSON.stringify({ method: "error", params: { error: { message: "model unavailable" }, willRetry: false } }) + "\\n");
      process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { status: "failed" } } }) + "\\n");
    } else {
      process.stdout.write(JSON.stringify({ method: "turn/completed", params: { turn: { status: "completed" } } }) + "\\n");
    }
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
    await rm(binDir, { force: true, recursive: true });
  });

  it("completes a workspace-scoped ephemeral turn", async () => {
    await expect(startCodexTurn("/workspace", "resolve conflicts")).resolves.toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
    });
  });

  it("rejects an empty prompt before starting Codex", async () => {
    await expect(startCodexTurn("/workspace", "  ")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("surfaces the app-server error", async () => {
    await expect(startCodexTurn("/broken", "resolve conflicts")).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
      message: "Codex 临时任务失败：invalid sandbox",
    });
  });

  it("surfaces an asynchronous turn failure", async () => {
    await expect(startCodexTurn("/turn-fails", "resolve conflicts")).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
      message: "Codex 临时任务失败：model unavailable",
    });
  });
});
