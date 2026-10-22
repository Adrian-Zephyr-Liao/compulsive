import { type RepositoryRecord, type OrganizePlan, type RepositoryManager } from "../types.js";
import { CompulsiveError } from "../errors.js";
import { type ParsedArguments, requireValue } from "./arguments.js";
import { type CliContext } from "./context.js";
import { printValue, outputCd } from "./output.js";
import { renderOrganizePlan } from "../terminal.js";
import { realpath } from "node:fs/promises";
import { selectOne } from "./selection.js";

interface BatchOrganizeItem {
  record: RepositoryRecord;
  plan: OrganizePlan;
}

async function planAllRepositories(manager: RepositoryManager): Promise<BatchOrganizeItem[]> {
  const records = await manager.search();
  const items: BatchOrganizeItem[] = [];
  const targets = new Map<string, RepositoryRecord>();
  for (const record of records) {
    const plan = await manager.planOrganize(record.id);
    const existing = targets.get(plan.target);
    if (existing) {
      throw new CompulsiveError(
        "CONFLICT",
        `Repositories ${existing.classificationPath} and ${record.classificationPath} share the same organize target: ${plan.target}`,
      );
    }
    targets.set(plan.target, record);
    items.push({ record, plan });
  }
  return items.filter((item) => !item.plan.isNoop);
}

export async function handleOrganize(
  parsed: ParsedArguments,
  context: CliContext,
  json: boolean,
  allowPrompt: boolean,
): Promise<void> {
  if (parsed.flags.has("dry-run") && parsed.flags.has("yes")) {
    throw new CompulsiveError("INVALID_INPUT", "Use either --dry-run or --yes, not both.");
  }
  if (parsed.flags.has("all")) {
    if (parsed.positionals.length > 0) {
      throw new CompulsiveError(
        "INVALID_INPUT",
        "A repository query cannot be combined with --all.",
      );
    }
    const items = await planAllRepositories(context.manager);
    if (json && parsed.flags.has("dry-run")) {
      printValue(
        context,
        items.map((item) => item.plan),
        true,
      );
      return;
    }
    if (!json) {
      const config = await context.manager.getConfig();
      const rendered = renderOrganizePlan(
        context.theme,
        items,
        await realpath(config.rootDir),
        parsed.flags.has("dry-run"),
      );
      context.stdout(rendered.output);
      for (const warning of rendered.warnings) {
        context.stderr(context.theme.warning(warning.message, warning.name));
      }
    }
    if (parsed.flags.has("dry-run")) return;
    if (items.length === 0) {
      if (json) printValue(context, [], true);
      return;
    }
    if (!parsed.flags.has("yes")) {
      if (!allowPrompt) {
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Use --yes to organize all repositories non-interactively.",
        );
      }
      const moveCount = items.filter((item) => !item.plan.isNoop).length;
      const confirmed = await context.confirm(
        `Organize ${String(moveCount)} repositories into the managed root?`,
      );
      if (!confirmed) {
        throw new CompulsiveError("INVALID_INPUT", "Organization cancelled.");
      }
    }
    const organizeAll = async () => {
      const organized: RepositoryRecord[] = [];
      for (const item of items) {
        organized.push(await context.manager.organize(item.plan));
      }
      return organized;
    };
    const organized = allowPrompt
      ? await context.runTask("Organizing repositories", organizeAll)
      : await organizeAll();
    if (json) printValue(context, organized, true);
    else {
      context.stdout(context.theme.success(`Organized ${String(items.length)} repositories`));
    }
    return;
  }
  const query = requireValue(parsed.positionals.join(" "), "Repository query");
  const record = await selectOne(context.manager, query, context, allowPrompt);
  const plan = await context.manager.planOrganize(record.id);
  if (!json) {
    plan.warnings.forEach((warning) => context.stderr(context.theme.warning(warning)));
  }
  if (parsed.flags.has("dry-run")) {
    if (json) printValue(context, plan, true);
    else {
      const config = await context.manager.getConfig();
      const rootDir = await realpath(config.rootDir);
      context.stdout(
        renderOrganizePlan(context.theme, plan.isNoop ? [] : [{ record, plan }], rootDir, true)
          .output,
      );
    }
    return;
  }
  if (!parsed.flags.has("yes")) {
    if (!allowPrompt) {
      throw new CompulsiveError("INVALID_INPUT", "Use --yes to organize non-interactively.");
    }
    const confirmed = await context.confirm(`Move ${plan.source} to ${plan.target}?`);
    if (!confirmed) {
      throw new CompulsiveError("INVALID_INPUT", "Organization cancelled.");
    }
  }
  const organizeTask = () => context.manager.organize(plan);
  const organized = allowPrompt
    ? await context.runTask("Organizing repository", organizeTask)
    : await organizeTask();
  await outputCd(organized, context, json);
  return;
}
