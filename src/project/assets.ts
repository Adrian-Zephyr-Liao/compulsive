import { constants } from "node:fs";
import { open, lstat, realpath } from "node:fs/promises";
import { CompulsiveError } from "../errors.js";
import { resolveProjectPath, type ProjectFileInput } from "./paths.js";
import { projectTextLimit } from "./files.js";
import type { RepositoryManager } from "../types.js";
export function projectImageUrl(buffer: Buffer): string | undefined {
  const header = buffer.subarray(0, 12);
  const mime = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ? "image/png"
    : header[0] === 255 && header[1] === 216 && header[2] === 255
      ? "image/jpeg"
      : /^GIF8[79]a/.test(header.toString("ascii"))
        ? "image/gif"
        : header.subarray(0, 4).toString() === "RIFF" &&
            header.subarray(8, 12).toString() === "WEBP"
          ? "image/webp"
          : header.subarray(0, 2).toString() === "BM"
            ? "image/bmp"
            : "";
  return mime ? `data:${mime};base64,${buffer.toString("base64")}` : undefined;
}
export async function readProjectBytes(manager: RepositoryManager, input: ProjectFileInput) {
  const { target } = await resolveProjectPath(manager, input);
  const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > projectTextLimit)
      throw new CompulsiveError(
        "INVALID_INPUT",
        "Image previews accept regular files up to 4 MiB.",
      );
    const data = Buffer.alloc(before.size + 1);
    let bytes = 0;
    while (bytes < data.length) {
      const result = await file.read(data, bytes, data.length - bytes, bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    const after = await lstat(target);
    if (
      bytes > before.size ||
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      (await realpath(target)) !== target
    )
      throw new CompulsiveError("CONFLICT", "Image changed while loading.");
    return { data: data.subarray(0, bytes), bytes };
  } finally {
    await file.close();
  }
}
export async function readProjectAsset(manager: RepositoryManager, input: ProjectFileInput) {
  const { data, bytes } = await readProjectBytes(manager, input);
  const url = projectImageUrl(data);
  if (!url)
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Unsupported image format. SVG uses the sandboxed text preview.",
    );
  return { path: input.path, url, bytes };
}
