import { CompulsiveError } from "../errors.js";
import { projectImageUrl } from "./assets.js";
import { projectTextLimit } from "./files.js";
import { runProjectGit } from "./git-command.js";
import { assertProjectRelativePath } from "./paths.js";

export function decodeGitDiff(data: Buffer): { text: string; image?: string } {
  if (data.length > projectTextLimit)
    throw new CompulsiveError("INVALID_INPUT", "Diff previews accept files up to 4 MiB.");
  const image = projectImageUrl(data);
  if (image) return { text: "", image };
  if (data.includes(0))
    throw new CompulsiveError("INVALID_INPUT", "Binary changes require an external viewer.");
  try {
    return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data) };
  } catch {
    throw new CompulsiveError("INVALID_INPUT", "Only UTF-8 text files can be previewed.");
  }
}

export async function readGitDiffBlob(root: string, revision: string, path: string) {
  assertProjectRelativePath(path, false);
  const listing = await runProjectGit(
    root,
    revision ? ["ls-tree", "-z", revision, "--", path] : ["ls-files", "--stage", "-z", "--", path],
    { allowFailure: true },
  );
  const entry = listing.stdout
    .split("\0")
    .find((item) => item.slice(item.indexOf("\t") + 1) === path);
  if (listing.exitCode || !entry) return { text: "" };
  const match = (
    revision ? /^([0-7]{6}) blob ([a-f0-9]{40,64})\t/ : /^([0-7]{6}) ([a-f0-9]{40,64}) 0\t/
  ).exec(entry);
  if (!match || !["100644", "100755"].includes(match[1]!))
    throw new CompulsiveError("INVALID_INPUT", "Only regular files can be previewed.");
  const object = match[2]!;
  const result = await runProjectGit(root, ["cat-file", "blob", object], {
    encoding: "buffer",
    maxBuffer: projectTextLimit + 1,
  });
  return decodeGitDiff(result.stdout);
}
