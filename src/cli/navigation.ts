import { type CliContext } from "./context.js";
import { outputCd, outputWorkspaceCd } from "./output.js";
import { type NavigationTarget } from "../terminal.js";

export async function openRepositoryPicker(context: CliContext): Promise<void> {
  const records = await context.manager.search();
  if (records.length === 0) {
    context.stdout("No repositories are registered.");
    return;
  }
  const selected = await context.chooseRepository("Search repositories", records);
  if (selected) await outputCd(selected, context, false);
}

export async function openWorkspacePicker(context: CliContext): Promise<void> {
  const workspaces = await context.manager.searchWorkspaces();
  if (workspaces.length === 0) {
    context.stdout("No workspaces are registered.");
    return;
  }
  const selected = await context.chooseWorkspace("Search workspaces", workspaces);
  if (selected) await outputWorkspaceCd(selected, context, false);
}

export async function openDestinationPicker(context: CliContext): Promise<void> {
  const [repositories, workspaces] = await Promise.all([
    context.manager.search(),
    context.manager.searchWorkspaces(),
  ]);
  const aliasesByRepository = new Map<string, string[]>();
  for (const workspace of workspaces) {
    for (const member of workspace.members) {
      const aliases = aliasesByRepository.get(member.repositoryId) ?? [];
      aliases.push(`${workspace.name}/${member.alias}`);
      aliasesByRepository.set(member.repositoryId, aliases);
    }
  }
  const targets: NavigationTarget[] = [
    ...workspaces.map((workspace) => ({ kind: "workspace" as const, workspace })),
    ...repositories.map((repository) => ({
      kind: "repository" as const,
      repository,
      aliases: aliasesByRepository.get(repository.id) ?? [],
    })),
  ];
  if (targets.length === 0) {
    context.stdout("No repositories or workspaces are registered.");
    return;
  }
  const selected = await context.chooseDestination("Search repositories and workspaces", targets);
  if (!selected) return;
  if (selected.kind === "repository") await outputCd(selected.repository, context, false);
  else await outputWorkspaceCd(selected.workspace, context, false);
}
