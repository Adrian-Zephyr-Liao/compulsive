import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { createRepositoryManager } from "../../src/manager.js";

const execFileAsync = promisify(execFile);

export async function createWorkspaceFixture() {
  const sandbox = await mkdtemp(join(tmpdir(), "compulsive-workspace-scenario-"));
  const dataDir = join(sandbox, "app-data");
  const rootDir = join(sandbox, "Code");
  const manager = createRepositoryManager({ dataDir, defaultRootDir: rootDir });
  await manager.initialize();
  const git = (cwd: string, ...args: string[]) =>
    execFileAsync("git", ["-C", cwd, ...args], { timeout: 10_000 });
  async function commit(path: string, file: string, content = `${file}\n`) {
    await writeFile(join(path, file), content);
    await git(path, "add", "--", file);
    await git(path, "commit", "-q", "-m", file);
  }
  async function remote(name: string, branch = "main") {
    const remotePath = join(sandbox, `${name}.git`);
    const path = join(sandbox, "repositories", name);
    await execFileAsync("git", ["init", "-q", "--bare", "-b", branch, remotePath], {
      timeout: 10_000,
    });
    await execFileAsync("git", ["clone", "-q", `file://${remotePath}`, path], { timeout: 10_000 });
    await commit(path, "origin.txt", `${name} remote\n`);
    await git(path, "push", "-q", "-u", "origin", branch);
    return { path, remotePath, repository: await manager.register({ path }) };
  }
  return {
    sandbox,
    dataDir,
    rootDir,
    manager,
    git,
    commit,
    remote,
    dispose: () => rm(sandbox, { recursive: true, force: true }),
  };
}
