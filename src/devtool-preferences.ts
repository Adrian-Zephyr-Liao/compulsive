import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { CompulsiveError } from "./errors.js";
import { writeJsonAtomic } from "./storage.js";
import type { RepositoryManager } from "./types.js";

export interface DevtoolPreferences {
  dark: boolean;
}
const locations = new WeakMap<RepositoryManager, string>();
const queues = new WeakMap<RepositoryManager, Promise<DevtoolPreferences>>();
export function registerDevtoolPreferences(manager: RepositoryManager, dataDir: string) {
  locations.set(manager, join(dataDir, "devtool-preferences.json"));
}
function isPreferences(value: unknown): value is DevtoolPreferences {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "dark" in value &&
    typeof value.dark === "boolean",
  );
}
export function devtoolPreferences(
  manager: RepositoryManager,
  value?: unknown,
): Promise<DevtoolPreferences> {
  const path = locations.get(manager);
  if (!path)
    return Promise.reject(
      new CompulsiveError("FILESYSTEM_FAILED", "DevTool preferences storage is unavailable."),
    );
  if (value !== undefined && !isPreferences(value))
    return Promise.reject(
      new CompulsiveError("INVALID_INPUT", "Invalid DevTool appearance preferences."),
    );
  const operation = (queues.get(manager) ?? Promise.resolve({ dark: false }))
    .catch(() => ({ dark: false }))
    .then(async () => {
      if (value !== undefined) {
        const preferences = { dark: (value as DevtoolPreferences).dark };
        await writeJsonAtomic(path, preferences);
        return preferences;
      }
      try {
        const data: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!isPreferences(data)) throw new Error("Unsupported preferences format.");
        return { dark: data.dark };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return { dark: false };
        throw new CompulsiveError(
          "FILESYSTEM_FAILED",
          "Unable to read DevTool appearance preferences.",
          { cause: error },
        );
      }
    });
  queues.set(manager, operation);
  return operation;
}
