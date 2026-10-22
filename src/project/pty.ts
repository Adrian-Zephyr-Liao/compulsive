import { chmod, lstat, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { CompulsiveError } from "../errors.js";

export async function loadProjectPty() {
  const pty = await import("node-pty");
  if (process.platform === "darwin") {
    const packageRoot = await realpath(
      dirname(createRequire(import.meta.url).resolve("node-pty/package.json")),
    );
    for (const location of [
      `prebuilds/darwin-${process.arch}/spawn-helper`,
      "build/Release/spawn-helper",
    ]) {
      const helper = join(packageRoot, location);
      const info = await lstat(helper).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!info) continue;
      if (!info.isFile() || (await realpath(helper)) !== helper)
        throw new CompulsiveError(
          "FILESYSTEM_FAILED",
          "node-pty's helper is not a regular installed file.",
        );
      // node-pty 1.1.0 publishes its macOS helper as 0644 (upstream #919).
      if (!(info.mode & 0o100)) {
        if (info.uid !== process.getuid?.())
          throw new CompulsiveError(
            "FILESYSTEM_FAILED",
            "Reinstall node-pty with an executable spawn-helper; CPL will not modify another user's installation.",
          );
        await chmod(helper, info.mode | 0o100);
      }
      break;
    }
  }
  return pty;
}
