import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";

import { CompulsiveError } from "./errors.js";

const execFileAsync = promisify(execFile);

export function redactGitError(message: string): string {
  return message.replace(/([a-z][a-z\d+.-]*:\/\/)[^@\s/]+@/gi, "$1[redacted]@");
}

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
        stderr: redactGitError(failure.stderr?.trim() ?? failure.message),
        exitCode: typeof failure.code === "number" ? failure.code : 1,
      };
    }
    throw new CompulsiveError(
      "GIT_FAILED",
      redactGitError(failure.stderr?.trim() || failure.message),
    );
  }
}

export async function readWorktreeBranch(
  worktreePath: string,
): Promise<{ branch: string; rebasing: boolean }> {
  const current = await runGit(["branch", "--show-current"], { cwd: worktreePath });
  if (current.stdout) return { branch: current.stdout, rebasing: false };

  for (const rebaseDirectory of ["rebase-merge", "rebase-apply"]) {
    const gitPath = await runGit(["rev-parse", "--git-path", `${rebaseDirectory}/head-name`], {
      cwd: worktreePath,
    });
    const headName = await readFile(
      isAbsolute(gitPath.stdout) ? gitPath.stdout : resolve(worktreePath, gitPath.stdout),
      "utf8",
    ).catch(() => "");
    if (headName.startsWith("refs/heads/")) {
      return { branch: headName.trim().slice("refs/heads/".length), rebasing: true };
    }
  }

  return { branch: "", rebasing: false };
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
