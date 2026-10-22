import { EventEmitter } from "node:events";
import { lstat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateCodexCommitMessage } from "../src/codex-message.js";

const execFile = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ execFile }));

afterEach(() => vi.resetAllMocks());

function answer(content: string, failure?: Error & { code?: string }) {
  const input = vi.fn();
  execFile.mockImplementation((_command, args, options, done) => {
    input.mockImplementation(async () => {
      if (!failure) await writeFile(args[args.indexOf("--output-last-message") + 1], content);
      done(failure ?? null, "ignored progress", "secret that must not escape");
    });
    return { stdin: Object.assign(new EventEmitter(), { end: input }) };
  });
  return input;
}

describe("Codex commit-message subprocess", () => {
  it("uses an ephemeral read-only process outside the repository and cleans its output", async () => {
    const input = answer("fix(editor): preserve staged changes\n");
    await expect(generateCodexCommitMessage("+ staged only\n")).resolves.toBe(
      "fix(editor): preserve staged changes",
    );
    const [command, args, options] = execFile.mock.calls[0]!;
    expect(command).toBe("codex");
    expect(args).toEqual([
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable",
      "shell_tool",
      "--disable",
      "apps",
      "--disable",
      "plugins",
      "--disable",
      "hooks",
      "--disable",
      "multi_agent",
      "-c",
      'approval_policy="never"',
      "-c",
      'web_search="disabled"',
      "--output-last-message",
      join(options.cwd, "message.txt"),
      "-",
    ]);
    expect(options).toMatchObject({ timeout: 120_000, maxBuffer: 1024 * 1024 });
    expect(input).toHaveBeenCalledWith(expect.stringContaining(JSON.stringify("+ staged only\n")));
    expect(input).toHaveBeenCalledWith(expect.stringContaining("untrusted source data"));
    await expect(lstat(options.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not include subprocess diagnostics in a returned error and cleans up on failure", async () => {
    answer("", Object.assign(new Error("secret from model or auth"), { code: "ENOENT" }));
    await expect(generateCodexCommitMessage("staged")).rejects.toMatchObject({
      code: "FILESYSTEM_FAILED",
      message:
        "Codex CLI was not found. Install it and sign in before generating a commit message.",
    });
    await expect(lstat(execFile.mock.calls[0]![2].cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["", "  \n", "bad\0message", "x".repeat(10_001)])(
    "rejects an empty, malformed or oversized answer",
    async (content) => {
      answer(content);
      await expect(generateCodexCommitMessage("staged")).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    },
  );
});
