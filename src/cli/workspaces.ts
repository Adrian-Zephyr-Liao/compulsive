import { type ParsedArguments, requireValue } from "./arguments.js";
import { type CliContext, CliCancelled } from "./context.js";
import { openWorkspacePicker } from "./navigation.js";
import { CompulsiveError } from "../errors.js";
import { printValue, describeWorkspace, outputWorkspaceCd } from "./output.js";
import { renderWorkspaceCollection, formatCount } from "../terminal.js";
import { selectOneWorkspace, selectOne, selectWorkspaceRepository } from "./selection.js";

export async function handleWorkspace(
  parsed: ParsedArguments,
  context: CliContext,
  json: boolean,
  allowPrompt: boolean,
): Promise<void> {
  const [action, ...arguments_] = parsed.positionals;
  if (!action) {
    if (allowPrompt) {
      await openWorkspacePicker(context);
      return;
    }
    throw new CompulsiveError("INVALID_INPUT", "Workspace action is required.");
  }

  if (action === "create") {
    const workspace = await context.manager.createWorkspace({
      name: requireValue(arguments_[0], "Workspace name"),
      ...(parsed.values.has("path") ? { path: parsed.values.get("path")! } : {}),
    });
    printValue(context, json ? workspace : describeWorkspace(workspace, context), json);
    return;
  }

  if (action === "list") {
    const workspaces = await context.manager.searchWorkspaces({ query: arguments_.join(" ") });
    if (json) printValue(context, workspaces, true);
    else
      context.stdout(
        renderWorkspaceCollection(
          context.theme,
          workspaces,
          arguments_.length > 0 ? `workspaces matching "${arguments_.join(" ")}"` : "workspaces",
        ),
      );
    return;
  }

  if (action === "show" || action === "go") {
    const query = requireValue(arguments_.join(" "), "Workspace query");
    const workspace = await selectOneWorkspace(context.manager, query, context, allowPrompt);
    if (action === "go") await outputWorkspaceCd(workspace, context, json);
    else printValue(context, json ? workspace : describeWorkspace(workspace, context), json);
    return;
  }

  if (action === "add") {
    const workspaceQuery = requireValue(arguments_[0], "Workspace query");
    const repositoryQuery = requireValue(arguments_[1], "Repository query");
    const workspace = await selectOneWorkspace(
      context.manager,
      workspaceQuery,
      context,
      allowPrompt,
    );
    const repository = await selectOne(context.manager, repositoryQuery, context, allowPrompt);
    const alias = parsed.values.get("alias") ?? repository.name;
    const explicitBranch = parsed.values.get("branch");
    const updated = await context.manager.addWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
      mode: "worktree",
      ...(explicitBranch === undefined ? {} : { branch: explicitBranch }),
      createBranch: parsed.flags.has("create-branch"),
      alias,
    });
    printValue(context, json ? updated : describeWorkspace(updated, context), json);
    return;
  }

  if (action === "remove") {
    const workspace = await selectOneWorkspace(
      context.manager,
      requireValue(arguments_[0], "Workspace query"),
      context,
      allowPrompt,
    );
    const repository = await selectWorkspaceRepository(
      context.manager,
      workspace,
      requireValue(arguments_[1], "Repository query"),
      context,
      allowPrompt,
    );
    if (!parsed.flags.has("yes")) {
      if (!allowPrompt) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Use --yes to remove a workspace member non-interactively.",
        );
      }
      const confirmed = await context.confirm(
        `Remove ${repository.name} from workspace ${workspace.name}?`,
      );
      if (!confirmed) throw new CliCancelled();
    }
    const updated = await context.manager.removeWorkspaceMember({
      workspaceId: workspace.id,
      repositoryId: repository.id,
    });
    printValue(context, json ? updated : describeWorkspace(updated, context), json);
    return;
  }

  if (action === "sync") {
    const query = arguments_.join(" ").trim();
    const workspaces = query
      ? [await selectOneWorkspace(context.manager, query, context, allowPrompt)]
      : await context.manager.searchWorkspaces();
    const results = [];
    for (const workspace of workspaces) {
      results.push(await context.manager.syncWorkspace(workspace.id));
    }
    if (json) printValue(context, query ? results[0] : results, true);
    else {
      for (const result of results) {
        context.stdout(describeWorkspace(result.workspace, context));
        for (const issue of result.issues) context.stderr(context.theme.warning(issue.message));
      }
    }
    if (results.some((result) => result.issues.length > 0)) {
      throw new CompulsiveError("CONFLICT", "One or more workspace members could not be synced.");
    }
    return;
  }

  if (action === "migrate") {
    const query = arguments_.join(" ").trim();
    const workspaces = query
      ? [await selectOneWorkspace(context.manager, query, context, allowPrompt)]
      : await context.manager.searchWorkspaces();
    if (!parsed.flags.has("yes")) {
      if (!allowPrompt) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Use --yes to migrate workspaces non-interactively.",
        );
      }
      const confirmed = await context.confirm(
        query
          ? `Migrate legacy worktrees in workspace ${workspaces[0]!.name}?`
          : `Migrate legacy worktrees in ${String(workspaces.length)} workspaces?`,
      );
      if (!confirmed) throw new CliCancelled();
    }
    const result = await context.manager.migrateWorkspaces(
      query ? workspaces.map((workspace) => workspace.id) : undefined,
    );
    printValue(
      context,
      json ? result : context.theme.success(`Migrated ${formatCount(result.migrated, "worktree")}`),
      json,
    );
    return;
  }

  if (action === "delete") {
    const workspace = await selectOneWorkspace(
      context.manager,
      requireValue(arguments_.join(" "), "Workspace query"),
      context,
      allowPrompt,
    );
    if (!parsed.flags.has("yes")) {
      if (!allowPrompt) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Use --yes to delete a workspace non-interactively.",
        );
      }
      const confirmed = await context.confirm(
        `Permanently delete workspace ${workspace.name} and its entire directory?`,
      );
      if (!confirmed) throw new CliCancelled();
    }
    await context.manager.deleteWorkspace(workspace.id);
    printValue(
      context,
      json ? { deleted: workspace.id } : context.theme.success(`Deleted ${workspace.name}`),
      json,
    );
    return;
  }

  throw new CompulsiveError("INVALID_INPUT", `Unknown workspace action: ${action}`);
}
