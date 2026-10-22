import type { ProjectGitStatus } from "../../../../project/git.js";
import type { EditorReviewEntry, EditorViewMode } from "../types.js";

export function editorViewMode(params: URLSearchParams): EditorViewMode {
  if (params.get("view") === "changes") return "changes";
  return params.get("view") === "files" || params.has("file") ? "files" : "changes";
}

export function groupGitChanges(status: Pick<ProjectGitStatus, "changes"> | undefined) {
  const changes = status?.changes.filter((change) => !change.ignored) ?? [];
  return [
    { key: "conflicts", items: changes.filter((c) => c.conflict), staged: false },
    {
      key: "staged",
      items: changes.filter((c) => !c.conflict && c.index !== "?" && c.index !== " "),
      staged: true,
    },
    {
      key: "changes",
      items: changes.filter((c) => !c.conflict && c.index !== "?" && c.worktree !== " "),
      staged: false,
    },
    { key: "untracked", items: changes.filter((c) => c.index === "?"), staged: false },
  ] as const;
}

export function reviewEntries(status: ProjectGitStatus | undefined): EditorReviewEntry[] {
  return groupGitChanges(status).flatMap((group) =>
    group.items.map((change) => ({
      id: JSON.stringify([group.key, change.path]),
      group: group.key,
      staged: group.staged,
      change,
    })),
  );
}
