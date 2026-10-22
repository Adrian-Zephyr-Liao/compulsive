import { relative, isAbsolute, basename } from "node:path";
import { readOrigin } from "./git.js";
import { parseGitRemote } from "./git-url.js";

export function pathIsInside(parent: string, child: string): boolean {
  const difference = relative(parent, child);
  return difference === "" || (!difference.startsWith("..") && !isAbsolute(difference));
}

type RepositoryMetadata =
  | {
      kind: "remote";
      name: string;
      classificationPath: string;
      canonicalRemote: string;
      remoteUrl: string;
      host: string;
      ownerPath: string[];
    }
  | {
      kind: "local";
      name: string;
      classificationPath: string;
    };

export async function readRepositoryMetadata(repositoryRoot: string): Promise<RepositoryMetadata> {
  const remoteUrl = await readOrigin(repositoryRoot);
  if (!remoteUrl) {
    const name = basename(repositoryRoot);
    return { kind: "local", name, classificationPath: `local/${name}` };
  }

  const classification = parseGitRemote(remoteUrl);
  return {
    kind: "remote",
    name: classification.name,
    classificationPath: classification.relativePath,
    canonicalRemote: classification.canonicalRemote,
    remoteUrl: classification.canonicalRemote,
    host: classification.host,
    ownerPath: classification.ownerPath,
  };
}
