import { generateCodexCommitMessage } from "../codex-message.js";
import { CompulsiveError } from "../errors.js";
import type { RepositoryManager } from "../types.js";
import { runProjectGit } from "./git-command.js";
import { gitRoot, readGitStatus } from "./git.js";
import { assertProjectRelativePath, type ProjectFileInput } from "./paths.js";

export async function projectGitMessage(
  manager: RepositoryManager,
  input: Omit<ProjectFileInput, "path"> & { fingerprint: string },
): Promise<{ message: string; fingerprint: string }> {
  const { root } = await gitRoot(manager, input);
  const status = await readGitStatus(root);
  if (status.fingerprint !== input.fingerprint)
    throw new CompulsiveError(
      "CONFLICT",
      "Git state changed. Refresh before generating a message.",
    );
  if (status.changes.some((change) => change.conflict))
    throw new CompulsiveError("CONFLICT", "Resolve conflicts before generating a commit message.");
  const names = (
    await runProjectGit(root, ["diff", "--cached", "--no-renames", "--name-only", "-z"])
  ).stdout
    .split("\0")
    .filter(Boolean);
  if (!names.length)
    throw new CompulsiveError("CONFLICT", "Stage changes before generating a commit message.");
  if (names.length > 1000)
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Stage at most 1000 files when generating a message.",
    );
  for (const path of names) {
    try {
      assertProjectRelativePath(path, false);
    } catch {
      throw new CompulsiveError(
        "CONFLICT",
        "The index contains files excluded from the editor. Review them externally before generating a message.",
      );
    }
  }
  const patch = (
    await runProjectGit(root, [
      "diff",
      "--cached",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--no-renames",
      "--unified=3",
      "--",
      ...names,
    ])
  ).stdout;
  if (!patch.trim() || Buffer.byteLength(patch, "utf8") > 128 * 1024)
    throw new CompulsiveError(
      "INVALID_INPUT",
      "The staged patch exceeds the 128 KiB message-generation limit. Stage a smaller change or write the message manually.",
    );
  if ((await readGitStatus(root)).fingerprint !== input.fingerprint)
    throw new CompulsiveError(
      "CONFLICT",
      "Git state changed. Refresh before generating a message.",
    );
  const message = await generateCodexCommitMessage(patch);
  const current = await gitRoot(manager, input);
  const next = await readGitStatus(current.root);
  if (current.root !== root || next.fingerprint !== input.fingerprint)
    throw new CompulsiveError(
      "CONFLICT",
      "Git state changed while Codex generated the message. Refresh and generate it again.",
    );
  return { message, fingerprint: next.fingerprint };
}
