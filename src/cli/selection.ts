import { type RepositoryManager, type RepositoryRecord, type WorkspaceRecord } from "../types.js";
import { type CliContext, CliCancelled } from "./context.js";
import { CompulsiveError } from "../errors.js";

export async function selectOne(
  manager: RepositoryManager,
  query: string,
  context: CliContext,
  allowPrompt: boolean,
): Promise<RepositoryRecord> {
  const matches = await manager.search({ query });
  if (matches.length === 0) {
    throw new CompulsiveError("NOT_FOUND", `No repository matches: ${query}`);
  }
  const normalizedQuery = query.trim().toLowerCase();
  const exact = matches.find((record) =>
    [record.id, record.name, record.classificationPath, record.absolutePath].some(
      (value) => value.toLowerCase() === normalizedQuery,
    ),
  );
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  if (!allowPrompt) {
    throw new CompulsiveError(
      "AMBIGUOUS_MATCH",
      `Multiple repositories match "${query}": ${matches.map((item) => item.name).join(", ")}`,
    );
  }
  const selected = await context.chooseRepository("Choose a repository", matches);
  if (!selected) throw new CliCancelled();
  return selected;
}

export async function selectOneWorkspace(
  manager: RepositoryManager,
  query: string,
  context: CliContext,
  allowPrompt: boolean,
): Promise<WorkspaceRecord> {
  const matches = await manager.searchWorkspaces({ query });
  if (matches.length === 0) {
    throw new CompulsiveError("NOT_FOUND", `No workspace matches: ${query}`);
  }
  const normalizedQuery = query.trim().toLowerCase();
  const exact = matches.find((workspace) =>
    [workspace.id, workspace.name, workspace.absolutePath].some(
      (value) => value.toLowerCase() === normalizedQuery,
    ),
  );
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  if (!allowPrompt) {
    throw new CompulsiveError(
      "AMBIGUOUS_MATCH",
      `Multiple workspaces match "${query}": ${matches.map((item) => item.name).join(", ")}`,
    );
  }
  const selected = await context.chooseWorkspace("Choose a workspace", matches);
  if (!selected) throw new CliCancelled();
  return selected;
}

export async function repositoriesInWorkspace(
  manager: RepositoryManager,
  workspace: WorkspaceRecord,
  query = "",
): Promise<RepositoryRecord[]> {
  const records = await manager.search();
  const normalizedQuery = query.trim().toLowerCase();
  const memberByRepository = new Map(
    workspace.members.map((member) => [member.repositoryId, member] as const),
  );
  return records.filter((record) => {
    const member = memberByRepository.get(record.id);
    if (!member) return false;
    if (!normalizedQuery) return true;
    return [
      member.alias,
      record.id,
      record.name,
      record.classificationPath,
      record.absolutePath,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

export async function selectWorkspaceRepository(
  manager: RepositoryManager,
  workspace: WorkspaceRecord,
  query: string,
  context: CliContext,
  allowPrompt: boolean,
): Promise<RepositoryRecord> {
  const matches = await repositoriesInWorkspace(manager, workspace, query);
  if (matches.length === 0) {
    throw new CompulsiveError("NOT_FOUND", `No workspace repository matches: ${query}`);
  }
  const normalizedQuery = query.trim().toLowerCase();
  const exact = matches.find((record) => {
    const member = workspace.members.find((item) => item.repositoryId === record.id);
    return [
      member?.alias,
      record.id,
      record.name,
      record.classificationPath,
      record.absolutePath,
    ].some((value) => value?.toLowerCase() === normalizedQuery);
  });
  if (exact) return exact;
  if (matches.length === 1) return matches[0]!;
  if (!allowPrompt) {
    throw new CompulsiveError(
      "AMBIGUOUS_MATCH",
      `Multiple workspace repositories match "${query}": ${matches.map((item) => item.name).join(", ")}`,
    );
  }
  const selected = await context.chooseRepository("Choose a workspace repository", matches);
  if (!selected) throw new CliCancelled();
  return selected;
}
