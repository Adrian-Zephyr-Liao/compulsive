import { createWorktreeAuditJobs } from "../worktree-audit-jobs.js";
import { defineRpcFunction } from "devframe";
import { objectResult } from "./rpc-schema.js";
import {
  type WorktreeAuditReport,
  type WorktreeAuditJob,
  type WorktreeRemovalPlan,
  type WorktreeRemovalResult,
} from "../worktree-audit-types.js";
import { s } from "devframe/utils/simple-schema";
import { CompulsiveError } from "../errors.js";
import { validateAuditPath } from "../worktree-audit.js";
import { type RepositoryManager } from "../types.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function createAuditFunctions(manager: RepositoryManager) {
  const auditJobs = createWorktreeAuditJobs(manager);

  const getWorktreeAudit = defineRpcFunction({
    name: "get-worktree-audit",
    type: "query",
    jsonSerializable: true,
    args: [],
    returns: objectResult<{ report: WorktreeAuditReport | null }>(),
    handler: async () => ({ report: await manager.getWorktreeAudit() }),
  });

  const startWorktreeAudit = defineRpcFunction({
    name: "start-worktree-audit",
    type: "action",
    jsonSerializable: true,
    args: [],
    returns: objectResult<WorktreeAuditJob>(),
    handler: () => auditJobs.start(),
  });

  const waitWorktreeAudit = defineRpcFunction({
    name: "wait-worktree-audit",
    type: "query",
    jsonSerializable: true,
    args: [s.object({ id: s.string(), revision: s.number() })],
    returns: objectResult<WorktreeAuditJob>(),
    handler: ({ id, revision }) => auditJobs.wait(id, revision),
  });

  const cancelWorktreeAudit = defineRpcFunction({
    name: "cancel-worktree-audit",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ id: s.string() })],
    returns: objectResult<WorktreeAuditJob>(),
    handler: ({ id }) => auditJobs.cancel(id),
  });

  const ignoreWorktreeAudit = defineRpcFunction({
    name: "ignore-worktree-audit",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ id: s.string(), fingerprint: s.string(), ignored: s.boolean() })],
    returns: objectResult<WorktreeAuditReport>(),
    handler: ({ id, fingerprint, ignored }) =>
      manager.setWorktreeAuditIgnored(id, fingerprint, ignored),
  });

  const previewAuditRemoval = defineRpcFunction({
    name: "preview-audit-removal",
    type: "query",
    jsonSerializable: true,
    args: [s.object({ id: s.string() })],
    returns: objectResult<WorktreeRemovalPlan>(),
    handler: ({ id }) => manager.previewWorktreeRemoval(id),
  });

  const removeAuditWorktree = defineRpcFunction({
    name: "remove-audit-worktree",
    type: "action",
    jsonSerializable: true,
    args: [
      s.object({
        id: s.string(),
        fingerprint: s.string(),
        confirmedPath: s.string(),
        includeIgnored: s.boolean(),
        force: s.optional(s.boolean()),
      }),
    ],
    returns: objectResult<WorktreeRemovalResult>(),
    handler: (input) => manager.removeAuditedWorktree({ ...input, force: input.force === true }),
  });

  const openAuditWorktree = defineRpcFunction({
    name: "open-audit-worktree",
    type: "action",
    jsonSerializable: true,
    args: [s.object({ id: s.string(), fingerprint: s.string() })],
    returns: objectResult<{ opened: string }>(),
    handler: async ({ id, fingerprint }) => {
      const item = (await manager.getWorktreeAudit())?.items.find(
        (entry) => entry.id === id && entry.fingerprint === fingerprint,
      );
      if (!item)
        throw new CompulsiveError("CONFLICT", "The audit finding changed. Run the audit again.");
      const path = await validateAuditPath(item, await manager.search());
      if (process.platform !== "darwin")
        throw new CompulsiveError("FILESYSTEM_FAILED", "Opening VS Code currently requires macOS.");
      await execFileAsync("/usr/bin/open", ["-a", "Visual Studio Code", path]);
      return { opened: item.id };
    },
  });
  return [
    getWorktreeAudit,
    startWorktreeAudit,
    waitWorktreeAudit,
    cancelWorktreeAudit,
    ignoreWorktreeAudit,
    previewAuditRemoval,
    removeAuditWorktree,
    openAuditWorktree,
  ] as const;
}
