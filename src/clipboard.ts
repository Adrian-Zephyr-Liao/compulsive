import { spawn } from "node:child_process";

import { CompulsiveError } from "./errors.js";

export async function copyTextToClipboard(text: string): Promise<void> {
  if (process.platform !== "darwin") {
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      "Clipboard copy is currently supported on macOS.",
    );
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/pbcopy", [], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `pbcopy exited with code ${String(code)}`));
    });
    child.stdin.end(text);
  });
}
