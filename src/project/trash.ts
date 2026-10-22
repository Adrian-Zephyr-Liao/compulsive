import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isAbsolute } from "node:path";
import { access, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { CompulsiveError } from "../errors.js";

export async function moveProjectItemToTrash(path: string): Promise<void> {
  if (!isAbsolute(path) || path.includes("\0"))
    throw new CompulsiveError("INVALID_INPUT", "Trash requires an absolute, validated item path.");
  if (process.platform !== "darwin")
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      "Recoverable deletion currently requires the macOS system trash command. Use your file manager; nothing was deleted.",
    );
  try {
    await access("/usr/bin/trash", constants.X_OK);
  } catch {
    throw new CompulsiveError(
      "FILESYSTEM_FAILED",
      "The macOS system trash command is unavailable. Use Finder; nothing was deleted.",
    );
  }
  await promisify(execFile)("/usr/bin/trash", ["-s", path], {
    timeout: 30000,
    maxBuffer: 64 * 1024,
  });
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  throw new CompulsiveError(
    "FILESYSTEM_FAILED",
    "The item is still present. Check Finder and refresh before retrying.",
  );
}
