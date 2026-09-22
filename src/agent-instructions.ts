import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { CompulsiveError } from "./errors.js";
import { writeTextAtomic } from "./storage.js";

const sectionStart = "<!-- COMPULSIVE_START -->";
const sectionEnd = "<!-- COMPULSIVE_END -->";

export const agentInstructions = `${sectionStart}
## Compulsive (CPL)

When a task involves locating, cloning, grouping, or choosing among local Git repositories or worktrees, use CPL as the source of truth:

- Before searching common folders or cloning, query \`cpl list --json\`, \`cpl workspace list --json\`, and \`cpl config show --json\`.
- A user-named Workspace is binding. Resolve it with \`cpl workspace show <workspace> --json\` and work from \`<workspace.absolutePath>/<member.alias>\` from the start. Add a missing member with \`cpl workspace add\`; do not create a competing copy.
- Use \`cpl clone\` for a new remote and \`cpl add\` for an existing local repository. Keep canonical repositories under CPL's configured root and grouped work in Workspaces.
- Before changing repository layout or worktrees, inspect Git status and preserve dirty work. Finish by verifying the selected path, branch, status, and \`cpl doctor --json\`; unrelated dirty findings are informational.
${sectionEnd}`;

export type AgentInstructionsAction = "created" | "updated" | "unchanged";

export async function installGlobalAgentInstructions(
  file = join(homedir(), ".codex", "AGENTS.md"),
): Promise<AgentInstructionsAction> {
  let content: string;
  try {
    content = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to read ${file}.`, { cause: error });
    }
    await writeTextAtomic(file, `${agentInstructions}\n`);
    return "created";
  }

  const start = content.indexOf(sectionStart);
  const end = content.indexOf(sectionEnd);
  if (start !== -1 && end > start) {
    const existing = content.slice(start, end + sectionEnd.length);
    if (existing === agentInstructions) return "unchanged";
    await writeTextAtomic(
      file,
      content.slice(0, start) + agentInstructions + content.slice(end + sectionEnd.length),
    );
    return "updated";
  }

  const trimmed = content.trimEnd();
  await writeTextAtomic(file, `${trimmed}${trimmed ? "\n\n" : ""}${agentInstructions}\n`);
  return "updated";
}
