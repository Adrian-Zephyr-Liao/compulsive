import {
  type ParsedArguments,
  requireValue,
  parseArguments,
  exitCodeFor,
} from "./cli/arguments.js";
import { type CliContext, createDefaultContext, CliCancelled } from "./cli/context.js";
import { openDestinationPicker, openRepositoryPicker } from "./cli/navigation.js";
import {
  helpText,
  formatCount,
  renderRepositoryCollection,
  createTerminalTheme,
} from "./terminal.js";
import { printValue, outputCd, describeRecord } from "./cli/output.js";
import { type RepositoryRecord } from "./types.js";
import { repositoriesInWorkspace, selectOneWorkspace, selectOne } from "./cli/selection.js";
import { handleOrganize } from "./cli/organize.js";
import { CompulsiveError } from "./errors.js";
import { handleWorkspace } from "./cli/workspaces.js";
import { handleConfig, handleDoctor } from "./cli/system.js";

export type { CliContext } from "./cli/context.js";

async function dispatch(parsed: ParsedArguments, context: CliContext): Promise<void> {
  const json = parsed.flags.has("json");
  const allowPrompt = context.isTTY && !json;
  switch (parsed.command) {
    case "": {
      if (allowPrompt) await openDestinationPicker(context);
      else context.stdout(helpText);
      return;
    }
    case "help":
    case "--help":
    case "-h": {
      context.stdout(helpText);
      return;
    }
    case "init": {
      const rootDir = parsed.values.get("root");
      const config = await context.manager.initialize(rootDir === undefined ? {} : { rootDir });
      await context.installAgentInstructions();
      printValue(
        context,
        json ? config : context.theme.success("Initialized", config.rootDir),
        json,
      );
      return;
    }
    case "ui": {
      await context.manager.getConfig();
      const server = await context.startDevtool(context.manager, {
        openBrowser: !parsed.flags.has("no-open"),
      });
      context.stdout(context.theme.success("DevTool ready", server.origin));
      return;
    }
    case "clone": {
      const remote = requireValue(parsed.positionals[0], "Git remote");
      const depthValue = parsed.values.get("depth");
      const task = () =>
        context.manager.clone({
          remote,
          ...(depthValue === undefined ? {} : { depth: Number(depthValue) }),
        });
      const record = allowPrompt ? await context.runTask("Cloning repository", task) : await task();
      await outputCd(record, context, json);
      return;
    }
    case "add": {
      const record = await context.manager.register({
        path: requireValue(parsed.positionals[0], "Repository path"),
      });
      printValue(context, json ? record : describeRecord(record, context), json);
      return;
    }
    case "scan": {
      const task = () =>
        context.manager.discover(
          parsed.positionals.length > 0 ? { paths: parsed.positionals } : {},
        );
      const result = allowPrompt
        ? await context.runTask("Scanning repositories", task)
        : await task();
      let output: Array<RepositoryRecord | (typeof result.repositories)[number]> =
        result.repositories.filter((repository) => !repository.isRegistered);
      if (parsed.flags.has("register")) {
        const registered: RepositoryRecord[] = [];
        for (const repository of output) {
          registered.push(await context.manager.register({ path: repository.absolutePath }));
        }
        output = registered;
      }
      if (json) printValue(context, output, true);
      else {
        const body =
          output.length === 0
            ? context.theme.empty("No new repositories found.")
            : output
                .map((item) =>
                  "id" in item
                    ? describeRecord(item, context)
                    : context.theme.repository(item.classificationPath, item.absolutePath),
                )
                .join("\n\n");
        context.stdout(
          [
            context.theme.header("scan"),
            "",
            body,
            "",
            context.theme.summary([
              formatCount(
                output.length,
                parsed.flags.has("register") ? "repository registered" : "repository found",
                parsed.flags.has("register") ? "repositories registered" : "repositories found",
              ),
              ...(parsed.flags.has("register") ? [] : ["preview only"]),
            ]),
          ].join("\n"),
        );
      }
      return;
    }
    case "list": {
      const query = parsed.positionals.join(" ");
      const records = await context.manager.search({ query });
      if (json) printValue(context, records, true);
      else
        context.stdout(
          renderRepositoryCollection(
            context.theme,
            records,
            query ? `repositories matching "${query}"` : "repositories",
            query ? `No repositories match "${query}".` : "No repositories are registered.",
          ),
        );
      return;
    }
    case "search": {
      const query = parsed.positionals.join(" ").trim();
      if (!query && allowPrompt) {
        await openRepositoryPicker(context);
        return;
      }
      requireValue(query, "Repository query");
      const workspaceQuery = parsed.values.get("workspace");
      const records = workspaceQuery
        ? await repositoriesInWorkspace(
            context.manager,
            await selectOneWorkspace(context.manager, workspaceQuery, context, allowPrompt),
            query,
          )
        : await context.manager.search({ query });
      if (json) printValue(context, records, true);
      else
        context.stdout(
          renderRepositoryCollection(
            context.theme,
            records,
            `search "${query}"`,
            `No repositories match "${query}".`,
          ),
        );
      return;
    }
    case "go": {
      const query = requireValue(parsed.positionals.join(" "), "Repository query");
      await outputCd(await selectOne(context.manager, query, context, allowPrompt), context, json);
      return;
    }
    case "organize": {
      await handleOrganize(parsed, context, json, allowPrompt);
      return;
    }
    case "forget": {
      const query = requireValue(parsed.positionals.join(" "), "Repository query");
      const record = await selectOne(context.manager, query, context, allowPrompt);
      if (!parsed.flags.has("yes")) {
        if (!allowPrompt) {
          throw new CompulsiveError("INVALID_INPUT", "Use --yes to forget non-interactively.");
        }
        const confirmed = await context.confirm(`Forget ${record.name} without deleting files?`);
        if (!confirmed) {
          throw new CompulsiveError("INVALID_INPUT", "Forget cancelled.");
        }
      }
      await context.manager.forget(record.id);
      context.stdout(
        context.theme.success(`Forgot ${record.name}`, "Repository files were not deleted."),
      );
      return;
    }
    case "workspace":
    case "ws": {
      await handleWorkspace(parsed, context, json, allowPrompt);
      return;
    }
    case "config": {
      await handleConfig(parsed, context, json);
      return;
    }
    case "doctor": {
      if (parsed.positionals[0] === "worktrees") {
        const report = await context.manager.auditWorktrees();
        printValue(
          context,
          json
            ? report
            : [
                `Worktree audit: ${report.repositoriesScanned}/${report.repositoryTotal} repositories`,
                "Read only. Unreferenced does not mean safe to delete. Remote refs are cached; no fetch was performed.",
                ...report.items
                  .filter(
                    (item) =>
                      parsed.flags.has("all") || (item.category !== "referenced" && !item.ignored),
                  )
                  .map(
                    (item) =>
                      `[${item.category}] ${item.path}\n  ${item.branch ?? "detached"} | ${item.risks.join(", ") || "No detected changes (not deletion approval)"}${item.error ? `\n  ${item.error}` : ""}`,
                  ),
                ...report.errors.map((error) => `ERROR ${error.repository}: ${error.message}`),
              ].join("\n"),
          json,
        );
        if (!report.complete)
          throw new CompulsiveError(
            "FILESYSTEM_FAILED",
            "Worktree audit is incomplete. See report errors.",
          );
        return;
      }
      if (parsed.positionals.length)
        throw new CompulsiveError("INVALID_INPUT", "Unknown doctor action.");
      await handleDoctor(context, json);
      return;
    }
    default:
      throw new CompulsiveError("INVALID_INPUT", `Unknown command: ${parsed.command}`);
  }
}

export async function runCli(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const context = { ...createDefaultContext(), ...overrides };
  const json = argv.includes("--json");
  try {
    const parsed = parseArguments(argv);
    if (!("theme" in overrides)) {
      context.theme = createTerminalTheme({
        color: parsed.flags.has("no-color")
          ? "never"
          : parsed.flags.has("color")
            ? "always"
            : "auto",
        unicode: true,
        isTTY: context.isTTY,
      });
    }
    await dispatch(parsed, context);
    return 0;
  } catch (error) {
    if (error instanceof CliCancelled) return 0;
    const failure =
      error instanceof CompulsiveError
        ? error
        : new CompulsiveError(
            "FILESYSTEM_FAILED",
            error instanceof Error ? error.message : String(error),
          );
    context.stderr(
      json
        ? JSON.stringify({ error: { code: failure.code, message: failure.message } })
        : context.theme.error(failure.code, failure.message),
    );
    return exitCodeFor(failure);
  }
}
