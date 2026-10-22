import { createHash } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { projectTextLimit } from "./files.js";
import type { ProjectGitChange } from "./git.js";

export async function changeSnapshot(root: string, changes: ProjectGitChange[]) {
  const hash = createHash("sha256");
  const identity = (info: BigIntStats) =>
    `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
  let complete = true;
  let bytes = 0;
  let examined = 0;
  for (const change of changes) {
    if (change.ignored) continue;
    hash.update(change.path);
    if (++examined > 1000) {
      complete = false;
      continue;
    }
    let target = root;
    try {
      for (const part of change.path.split("/")) {
        target = join(target, part);
        const info = await lstat(target, { bigint: true });
        hash.update(identity(info));
        if (info.isSymbolicLink()) throw new Error("Symbolic link");
      }
      const file = await open(
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const before = await file.stat({ bigint: true });
        if (
          !before.isFile() ||
          before.size > BigInt(projectTextLimit) ||
          bytes + Number(before.size) > 64 * 1024 * 1024 ||
          (await realpath(target)) !== target
        )
          throw new Error("Snapshot limit");
        const buffer = Buffer.alloc(64 * 1024);
        let position = 0;
        while (position <= Number(before.size)) {
          const read = await file.read(
            buffer,
            0,
            Math.min(buffer.length, Number(before.size) + 1 - position),
            position,
          );
          if (!read.bytesRead) break;
          hash.update(buffer.subarray(0, read.bytesRead));
          position += read.bytesRead;
          bytes += read.bytesRead;
        }
        if (
          position !== Number(before.size) ||
          identity(before) !== identity(await file.stat({ bigint: true })) ||
          identity(before) !== identity(await lstat(target, { bigint: true })) ||
          (await realpath(target)) !== target
        )
          throw new Error("File changed while taking a snapshot");
      } finally {
        await file.close();
      }
    } catch (error) {
      hash.update((error as NodeJS.ErrnoException).code ?? "incomplete");
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") complete = false;
    }
  }
  return { hash: hash.digest("hex"), complete };
}
