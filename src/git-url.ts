import { CompulsiveError } from "./errors.js";
import type { RepositoryClassification } from "./types.js";

const scpRemotePattern = /^(?:[^@\s]+@)?([^:/\s]+):(.+)$/;
const unsafePathPattern = /(?:^|[\\/])\.{1,2}(?=[\\/]|$)/;

function decodeRemote(remote: string): string {
  try {
    return decodeURIComponent(remote);
  } catch {
    throw new CompulsiveError("INVALID_REMOTE", "Remote URL contains invalid encoding.");
  }
}

function validateSegment(segment: string): string {
  const value = segment.normalize("NFC").trim();
  let hasControlCharacter = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) {
      hasControlCharacter = true;
      break;
    }
  }
  if (
    value.length === 0 ||
    value === "." ||
    value === ".." ||
    value.includes("\\") ||
    hasControlCharacter
  ) {
    throw new CompulsiveError("INVALID_REMOTE", `Unsafe remote path segment: ${segment}`);
  }
  return value;
}

function parseUrlRemote(remote: string): { host: string; path: string } | undefined {
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(remote)) {
    return undefined;
  }

  let url: URL;
  try {
    url = new URL(remote);
  } catch {
    throw new CompulsiveError("INVALID_REMOTE", "Remote URL is invalid.");
  }

  if (!["https:", "http:", "ssh:", "git:", "file:"].includes(url.protocol)) {
    throw new CompulsiveError("INVALID_REMOTE", `Unsupported remote protocol: ${url.protocol}`);
  }

  const baseHost = url.hostname.toLowerCase() || "local-file";
  const host = url.port ? `${baseHost}-${url.port}` : baseHost;
  return { host, path: url.pathname };
}

export function parseGitRemote(input: string): RepositoryClassification {
  const remote = input.trim();
  if (remote.length === 0) {
    throw new CompulsiveError("INVALID_REMOTE", "Remote URL is required.");
  }

  const decodedRemote = decodeRemote(remote);
  if (unsafePathPattern.test(decodedRemote)) {
    throw new CompulsiveError("INVALID_REMOTE", "Remote URL contains an unsafe path.");
  }

  const urlRemote = parseUrlRemote(remote);
  const scpMatch = urlRemote ? undefined : scpRemotePattern.exec(remote);
  if (!urlRemote && !scpMatch) {
    throw new CompulsiveError(
      "INVALID_REMOTE",
      "Remote must be an HTTP, SSH, Git, file, or scp-style URL.",
    );
  }

  const host = validateSegment(urlRemote?.host ?? scpMatch![1]!.toLowerCase());
  const rawPath = decodeRemote(urlRemote?.path ?? scpMatch![2]!);
  const segments = rawPath.split("/").filter(Boolean).map(validateSegment);

  if (segments.length < 2) {
    throw new CompulsiveError(
      "INVALID_REMOTE",
      "Remote URL must include an owner and repository name.",
    );
  }

  const rawName = segments.at(-1)!;
  const name = validateSegment(rawName.endsWith(".git") ? rawName.slice(0, -4) : rawName);
  const ownerPath = segments.slice(0, -1);
  const pathSegments = [host, ...ownerPath, name];

  return {
    kind: "remote",
    host,
    ownerPath,
    name,
    relativePath: pathSegments.join("/"),
    canonicalRemote: pathSegments.join("/"),
  };
}
