import { readFile } from "node:fs/promises";

import { CompulsiveError } from "./errors.js";
import { writeJsonAtomic, type StoragePaths } from "./storage.js";
import type { WorktreeAuditItem, WorktreeAuditReport } from "./worktree-audit-types.js";

async function read(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CompulsiveError("FILESYSTEM_FAILED", `Unable to read ${path}.`, { cause: error });
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((v) => typeof v === "string");
const nullableString = (value: unknown) => value === null || typeof value === "string";
const nullableCount = (value: unknown) =>
  value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

function validItem(value: unknown): value is WorktreeAuditItem {
  if (!object(value)) return false;
  return (
    [
      "id",
      "repositoryId",
      "repositoryName",
      "repositoryPath",
      "commonDirectory",
      "path",
      "fingerprint",
    ].every((key) => typeof value[key] === "string") &&
    ["head", "branch", "locked", "prunable", "upstream", "error"].every((key) =>
      nullableString(value[key]),
    ) &&
    ["referenced", "unreferenced", "external", "missing", "unregistered"].includes(
      String(value.category),
    ) &&
    (value.exists === null || typeof value.exists === "boolean") &&
    typeof value.ignored === "boolean" &&
    nullableCount(value.ahead) &&
    nullableCount(value.unpublished) &&
    strings(value.references) &&
    strings(value.operations) &&
    strings(value.risks) &&
    Array.isArray(value.changes) &&
    value.changes.every(
      (change) =>
        object(change) &&
        typeof change.path === "string" &&
        typeof change.status === "string" &&
        (change.from === undefined || typeof change.from === "string"),
    )
  );
}

export function createWorktreeAuditStore(paths: StoragePaths) {
  // Serialize report and ignore mutations so overlapping UI actions cannot lose a choice.
  let pending = Promise.resolve();
  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = pending.then(operation);
    pending = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  async function ignores(): Promise<Record<string, string>> {
    const value = await read(paths.worktreeAuditIgnores);
    if (value === null) return {};
    if (!object(value) || !Object.values(value).every((v) => typeof v === "string")) {
      throw new CompulsiveError("FILESYSTEM_FAILED", "Invalid worktree audit ignore state.");
    }
    return value as Record<string, string>;
  }
  async function get(): Promise<WorktreeAuditReport | null> {
    const value = await read(paths.worktreeAudit);
    if (value === null) return null;
    if (
      !object(value) ||
      value.schemaVersion !== 1 ||
      typeof value.startedAt !== "string" ||
      typeof value.checkedAt !== "string" ||
      typeof value.complete !== "boolean" ||
      typeof value.cancelled !== "boolean" ||
      !nullableCount(value.repositoryTotal) ||
      value.repositoryTotal === null ||
      !nullableCount(value.repositoriesScanned) ||
      value.repositoriesScanned === null ||
      !Array.isArray(value.items) ||
      !value.items.every(validItem) ||
      !Array.isArray(value.errors) ||
      !value.errors.every(
        (error) =>
          object(error) &&
          typeof error.repository === "string" &&
          typeof error.message === "string",
      )
    ) {
      throw new CompulsiveError(
        "FILESYSTEM_FAILED",
        "Invalid worktree audit report. Run the audit again.",
      );
    }
    const report = value as unknown as WorktreeAuditReport;
    const ignored = await ignores();
    for (const item of report.items) item.ignored = ignored[item.id] === item.fingerprint;
    return report;
  }
  return {
    get,
    removeItem: (id: string) =>
      serial(async () => {
        const report = await get();
        if (report) {
          report.items = report.items.filter((item) => item.id !== id);
          await writeJsonAtomic(paths.worktreeAudit, report);
        }
        const values = await ignores();
        delete values[id];
        await writeJsonAtomic(paths.worktreeAuditIgnores, values);
        return report;
      }),
    save: (report: WorktreeAuditReport) =>
      serial(async () => {
        await writeJsonAtomic(paths.worktreeAudit, report);
        return (await get())!;
      }),
    setIgnored: (id: string, fingerprint: string, ignored: boolean) =>
      serial(async () => {
        const report = await get();
        const item = report?.items.find(
          (entry) => entry.id === id && entry.fingerprint === fingerprint,
        );
        if (!item)
          throw new CompulsiveError("CONFLICT", "The audit finding changed. Run the audit again.");
        const values = await ignores();
        if (ignored) values[id] = fingerprint;
        else delete values[id];
        await writeJsonAtomic(paths.worktreeAuditIgnores, values);
        return (await get())!;
      }),
  };
}
