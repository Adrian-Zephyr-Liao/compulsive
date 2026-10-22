import { fileURLToPath } from "node:url";
import { defineDevframe } from "devframe";
import { createDevServer } from "devframe/adapters/dev";
import type { RpcDefinitionsToFunctionsWithNamespace } from "devframe/rpc";
import pkg from "../package.json" with { type: "json" };
import type { RepositoryManager } from "./types.js";
import { createStateFunctions } from "./devtool/state-rpc.js";
import { createAuditFunctions } from "./devtool/audit-rpc.js";
import { createWorkspaceFunctions } from "./devtool/workspace-rpc.js";
import { createIntegrationFunctions } from "./devtool/integration-rpc.js";
export type { DevtoolState, DevtoolWorkspace } from "./devtool/types.js";

export function createServerFunctions(manager: RepositoryManager) {
  return [
    ...createStateFunctions(manager),
    ...createAuditFunctions(manager),
    ...createWorkspaceFunctions(manager),
    ...createIntegrationFunctions(manager),
  ] as const;
}

export function createCompulsiveDevframe(manager: RepositoryManager) {
  return defineDevframe({
    id: "compulsive",
    name: "Compulsive",
    version: pkg.version,
    packageName: pkg.name,
    importMetaUrl: import.meta.url,
    homepage: pkg.homepage,
    description: "Manage Compulsive workspaces and their Git worktrees.",
    icon: "ph:git-branch-duotone",
    clientAssets: fileURLToPath(new URL("../dist/devtool-client", import.meta.url)),
    cli: {
      command: "cpl ui",
      port: 7392,
      portRange: [7392, 7492],
      open: true,
    },
    setup(ctx) {
      const rpc = ctx.scope("compulsive").rpc;
      for (const fn of createServerFunctions(manager)) rpc.register(fn);
    },
  });
}

export interface CompulsiveDevtoolServer {
  origin: string;
  close(): Promise<void>;
}

export interface StartCompulsiveDevtoolOptions {
  openBrowser?: boolean;
}

export async function startCompulsiveDevtool(
  manager: RepositoryManager,
  options: StartCompulsiveDevtoolOptions = {},
): Promise<CompulsiveDevtoolServer> {
  return createDevServer(createCompulsiveDevframe(manager), {
    host: "localhost",
    openBrowser: options.openBrowser ?? true,
    auth: true,
    mcp: false,
  });
}

declare module "devframe" {
  interface DevframeRpcServerFunctions extends RpcDefinitionsToFunctionsWithNamespace<
    "compulsive",
    ReturnType<typeof createServerFunctions>
  > {}
}
