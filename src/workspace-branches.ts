import { CompulsiveError } from "./errors.js";
import { runGit } from "./git.js";

export async function localBranchExists(repositoryPath: string, branch: string): Promise<boolean> {
  const result = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  return result.exitCode === 0;
}

export async function currentUpstream(repositoryPath: string): Promise<string | undefined> {
  const result = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd: repositoryPath, allowFailure: true },
  );
  return result.exitCode === 0 && result.stdout ? result.stdout : undefined;
}

export async function cachedOriginDefaultBranch(
  repositoryPath: string,
): Promise<string | undefined> {
  const symbolic = await runGit(
    ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"],
    { cwd: repositoryPath, allowFailure: true },
  );
  if (symbolic.exitCode === 0 && symbolic.stdout) return symbolic.stdout;
  for (const candidate of ["origin/main", "origin/master"]) {
    const result = await runGit(["rev-parse", "--verify", `${candidate}^{commit}`], {
      cwd: repositoryPath,
      allowFailure: true,
    });
    if (result.exitCode === 0) return candidate;
  }
  return undefined;
}

export async function fetchOriginDefaultBranch(repositoryPath: string): Promise<string> {
  const remoteHead = await runGit(["ls-remote", "--symref", "origin", "HEAD"], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  const defaultRef = remoteHead.stdout
    .split("\n")
    .find((line) => line.startsWith("ref: refs/heads/") && line.endsWith("\tHEAD"))
    ?.slice("ref: ".length, -"\tHEAD".length);
  if (remoteHead.exitCode !== 0 || !defaultRef) {
    throw new CompulsiveError("CONFLICT", "Unable to resolve the default branch for origin.");
  }
  const remoteBranch = `origin/${defaultRef.slice("refs/heads/".length)}`;
  await runGit(["fetch", "origin", `+${defaultRef}:refs/remotes/${remoteBranch}`], {
    cwd: repositoryPath,
  });
  return remoteBranch;
}

export async function originBranch(
  repositoryPath: string,
  branch: string,
  fetchRemote: boolean,
): Promise<string | undefined> {
  const remoteBranch = `origin/${branch}`;
  if (!fetchRemote) {
    const cached = await runGit(["rev-parse", "--verify", `${remoteBranch}^{commit}`], {
      cwd: repositoryPath,
      allowFailure: true,
    });
    return cached.exitCode === 0 ? remoteBranch : undefined;
  }
  const remoteRef = `refs/heads/${branch}`;
  const remote = await runGit(["ls-remote", "--heads", "origin", remoteRef], {
    cwd: repositoryPath,
  });
  if (!remote.stdout) return undefined;
  await runGit(["fetch", "origin", `+${remoteRef}:refs/remotes/${remoteBranch}`], {
    cwd: repositoryPath,
  });
  return remoteBranch;
}

export async function fetchConfiguredOriginBranch(
  repositoryPath: string,
  branch: string,
): Promise<string | undefined> {
  const origin = await runGit(["config", "--get", "remote.origin.url"], {
    cwd: repositoryPath,
    allowFailure: true,
  });
  return origin.exitCode === 0 && origin.stdout
    ? originBranch(repositoryPath, branch, true)
    : undefined;
}
