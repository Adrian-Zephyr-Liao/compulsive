import { type RepositoryManager, type RepositoryRecord, type WorkspaceRecord } from "../types.js";
import {
  type TerminalTheme,
  type NavigationTarget,
  createTerminalTheme,
  selectRepository,
  selectWorkspace,
  selectNavigationTarget,
  confirmAction,
  withSpinner,
} from "../terminal.js";
import {
  type AgentInstructionsAction,
  installGlobalAgentInstructions,
} from "../agent-instructions.js";
import { createRepositoryManager } from "../manager.js";
import { copyTextToClipboard } from "../clipboard.js";
import { startCompulsiveDevtool } from "../devtool.js";

export class CliCancelled extends Error {}

export interface CliContext {
  manager: RepositoryManager;
  stdout(value: string): void;
  stderr(value: string): void;
  copyText(value: string): Promise<void>;
  isTTY: boolean;
  theme: TerminalTheme;
  chooseRepository(
    message: string,
    repositories: RepositoryRecord[],
  ): Promise<RepositoryRecord | undefined>;
  chooseWorkspace(
    message: string,
    workspaces: WorkspaceRecord[],
  ): Promise<WorkspaceRecord | undefined>;
  chooseDestination(
    message: string,
    targets: NavigationTarget[],
  ): Promise<NavigationTarget | undefined>;
  confirm(message: string): Promise<boolean | undefined>;
  runTask<T>(message: string, task: () => Promise<T>): Promise<T>;
  installAgentInstructions(): Promise<AgentInstructionsAction>;
  startDevtool(
    manager: RepositoryManager,
    options?: { openBrowser?: boolean },
  ): Promise<{ origin: string }>;
}

export function createDefaultContext(): CliContext {
  const isTTY = Boolean(process.stdin.isTTY && process.stderr.isTTY);
  return {
    manager: createRepositoryManager(),
    stdout: (value) => process.stdout.write(`${value}\n`),
    stderr: (value) => process.stderr.write(`${value}\n`),
    copyText: copyTextToClipboard,
    isTTY,
    theme: createTerminalTheme({
      color: "auto",
      unicode: true,
      isTTY,
    }),
    chooseRepository: selectRepository,
    chooseWorkspace: selectWorkspace,
    chooseDestination: selectNavigationTarget,
    confirm: confirmAction,
    runTask: withSpinner,
    installAgentInstructions: installGlobalAgentInstructions,
    startDevtool: async (manager, options) => {
      const server = await startCompulsiveDevtool(manager, options);
      const close = () => {
        void server.close().finally(() => process.exit(0));
      };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
      return server;
    },
  };
}
