import { CompulsiveError } from "../errors.js";
import { listProjectDirectory } from "./files.js";
import { assertProjectRelativePath, resolveProjectPath, type ProjectFileInput } from "./paths.js";
import { runProjectGit } from "./git-command.js";
import type { RepositoryManager } from "../types.js";

export interface ProjectIndex {
  files: string[];
  truncated: boolean;
}

export async function indexProjectFiles(
  manager: RepositoryManager,
  input: Omit<ProjectFileInput, "path">,
): Promise<ProjectIndex> {
  const { root } = await resolveProjectPath(manager, { ...input, path: "" });
  const git = await runProjectGit(
    root,
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { allowFailure: true },
  );
  if (git.exitCode === 0) {
    const files = [
      ...new Set(
        git.stdout.split("\0").filter((path) => {
          if (!path) return false;
          try {
            assertProjectRelativePath(path, false);
            return true;
          } catch {
            return false;
          }
        }),
      ),
    ].sort();
    return { files: files.slice(0, 20000), truncated: files.length > 20000 };
  }
  const files: string[] = [];
  const pending = [""];
  let examined = 0;
  let truncated = false;
  while (pending.length) {
    if (++examined > 5000 || files.length >= 20000) {
      truncated = true;
      break;
    }
    const directory = await listProjectDirectory(manager, { ...input, path: pending.pop()! });
    truncated ||= directory.truncated;
    for (const entry of directory.entries) {
      if (entry.directory) pending.push(entry.path);
      else files.push(entry.path);
    }
  }
  return { files: files.slice(0, 20000).sort(), truncated };
}

export function assertProjectSearchSize(query: string) {
  if (query.length > 2000)
    throw new CompulsiveError("INVALID_INPUT", "Search patterns are limited to 2,000 characters.");
}
