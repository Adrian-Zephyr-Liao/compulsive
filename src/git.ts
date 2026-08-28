import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";

import { CompulsiveError } from "./errors.js";

const execFileAsync = promisify(execFile);

export async function runGit(
  arguments_: string[],
  options: { cwd?: string; allowFailure?: boolean } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("git", arguments_, {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return { stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: 0 };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    if (options.allowFailure) {
      return {
        stdout: failure.stdout?.trim() ?? "",
        stderr: failure.stderr?.trim() ?? failure.message,
        exitCode: typeof failure.code === "number" ? failure.code : 1,
      };
    }
    throw new CompulsiveError("GIT_FAILED", failure.stderr?.trim() || failure.message, {
      arguments: arguments_,
    });
  }
}

export async function findRepositoryRoot(inputPath: string): Promise<string> {
  const cwd = inputPath.endsWith("/.git") ? dirname(inputPath) : inputPath;
  const result = await runGit(["rev-parse", "--show-toplevel"], { cwd });
  return result.stdout;
}

export async function readOrigin(repositoryPath: string): Promise<string | undefined> {
  const result = await runGit(["config", "--get", "remote.origin.url"], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
}
