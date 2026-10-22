import { execFile } from "node:child_process";
import { CompulsiveError } from "../errors.js";
import { redactGitError } from "../git.js";

interface GitOptions {
  allowFailure?: boolean;
  input?: string;
  maxBuffer?: number;
}
interface GitResult<T> {
  stdout: T;
  stderr: string;
  exitCode: number;
}
export function runProjectGit(
  root: string,
  args: string[],
  options: GitOptions & { encoding: "buffer" },
): Promise<GitResult<Buffer>>;
export function runProjectGit(
  root: string,
  args: string[],
  options?: GitOptions & { encoding?: "utf8" },
): Promise<GitResult<string>>;
export function runProjectGit(
  root: string,
  args: string[],
  options: GitOptions & { encoding?: "utf8" | "buffer" } = {},
): Promise<GitResult<string | Buffer>> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["-c", "core.quotepath=false", ...args],
      {
        cwd: root,
        encoding: options.encoding === "buffer" ? "buffer" : "utf8",
        maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
        timeout: 30000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_LITERAL_PATHSPECS: "1",
          GIT_SSH_COMMAND: "ssh -oBatchMode=yes -oConnectTimeout=10",
        },
      },
      (error, stdout, stderr) => {
        if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" && options.encoding === "buffer") {
          reject(new CompulsiveError("INVALID_INPUT", "Git output exceeds the preview limit."));
          return;
        }
        const diagnostic = redactGitError(
          stderr.toString().trim() || error?.message || "Git command failed.",
        );
        if (error && !options.allowFailure) {
          reject(new CompulsiveError("GIT_FAILED", diagnostic));
          return;
        }
        resolve({
          stdout,
          stderr: redactGitError(stderr.toString()),
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
        });
      },
    );
    child.stdin?.on("error", () => {
      /* execFile's completion reports command failure. */
    });
    child.stdin?.end(options.input);
  });
}
