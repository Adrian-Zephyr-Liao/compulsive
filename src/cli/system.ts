import { type ParsedArguments, requireValue } from "./arguments.js";
import { type CliContext } from "./context.js";
import { type ManagerConfig } from "../types.js";
import { resolve } from "node:path";
import { CompulsiveError } from "../errors.js";
import { printValue } from "./output.js";
import { formatCount } from "../terminal.js";

export async function handleConfig(
  parsed: ParsedArguments,
  context: CliContext,
  json: boolean,
): Promise<void> {
  const [action = "show", value] = parsed.positionals;
  let config: ManagerConfig;
  if (action === "show") {
    config = await context.manager.getConfig();
  } else if (action === "set-root") {
    config = await context.manager.updateConfig({ rootDir: requireValue(value, "Root path") });
  } else if (action === "set-workspace-root") {
    config = await context.manager.updateConfig({
      workspaceRoot: requireValue(value, "Workspace root path"),
    });
  } else if (action === "add-scan-root" || action === "remove-scan-root") {
    const scanRoot = requireValue(value, "Scan root");
    const normalizedScanRoot = resolve(scanRoot);
    const current = await context.manager.getConfig();
    const roots =
      action === "add-scan-root"
        ? [...new Set([...current.scanRoots, normalizedScanRoot])]
        : current.scanRoots.filter((item) => item !== normalizedScanRoot);
    config = await context.manager.updateConfig({ scanRoots: roots });
  } else {
    throw new CompulsiveError("INVALID_INPUT", `Unknown config action: ${action}`);
  }
  printValue(context, json ? config : JSON.stringify(config, undefined, 2), json);
}

export async function handleDoctor(context: CliContext, json: boolean): Promise<void> {
  const checks = await context.manager.doctor();
  if (json) printValue(context, checks, true);
  else {
    const labels: Record<string, string> = {
      git: "Git",
      storage: "Managed root",
      "workspace-root": "Workspace root",
      workspaces: "Workspaces",
      clipboard: "Clipboard",
    };
    const passed = checks.filter((check) => check.ok).length;
    const failed = checks.length - passed;
    const body = checks
      .map((check) =>
        context.theme.check(
          check.ok,
          labels[check.name] ?? check.name.replace(/^workspace:/, "Workspace "),
          check.detail,
        ),
      )
      .join("\n\n");
    context.stdout(
      [
        context.theme.header("doctor"),
        "",
        body,
        "",
        context.theme.summary([
          formatCount(passed, "check passed", "checks passed"),
          ...(failed > 0 ? [formatCount(failed, "check failed", "checks failed")] : []),
        ]),
      ].join("\n"),
    );
  }
  if (checks.some((check) => !check.ok)) {
    throw new CompulsiveError("FILESYSTEM_FAILED", "One or more doctor checks failed.", checks);
  }
}
