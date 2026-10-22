import { type CliContext } from "./context.js";
import { type RepositoryRecord, type WorkspaceRecord } from "../types.js";
import { formatCdCommand } from "../shell.js";

export function printValue(context: CliContext, value: unknown, json: boolean): void {
  context.stdout(json ? JSON.stringify(value) : String(value));
}

export function describeRecord(record: RepositoryRecord, context: CliContext): string {
  return context.theme.repository(record.classificationPath, record.absolutePath);
}

export function describeWorkspace(workspace: WorkspaceRecord, context: CliContext): string {
  return context.theme.workspace(workspace.name, workspace.absolutePath, workspace.members.length);
}

export async function outputCd(
  record: RepositoryRecord,
  context: CliContext,
  json: boolean,
): Promise<void> {
  const command = formatCdCommand(record.absolutePath);
  let copied = true;
  try {
    await context.copyText(command);
  } catch {
    copied = false;
    context.stderr(context.theme.warning("Unable to copy the cd command; it is printed below."));
  }
  if (json) printValue(context, { repository: record, cdCommand: command, copied }, true);
  else context.stdout(command);
}

export async function outputWorkspaceCd(
  workspace: WorkspaceRecord,
  context: CliContext,
  json: boolean,
): Promise<void> {
  const command = formatCdCommand(workspace.absolutePath);
  let copied = true;
  try {
    await context.copyText(command);
  } catch {
    copied = false;
    context.stderr(context.theme.warning("Unable to copy the cd command; it is printed below."));
  }
  if (json) printValue(context, { workspace, cdCommand: command, copied }, true);
  else context.stdout(command);
}
