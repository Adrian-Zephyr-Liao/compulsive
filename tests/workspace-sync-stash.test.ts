import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withWorkspaceSyncLock } from "../src/workspace-sync-stash.js";

describe("workspace synchronization mutex", () => {
  let sandbox: string;
  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "compulsive-sync-lock-"));
  });
  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("rejects a duplicate path and releases the lock after a failed operation", async () => {
    const first = withWorkspaceSyncLock(sandbox, async () => {
      await expect(withWorkspaceSyncLock(sandbox, async () => "duplicate")).rejects.toMatchObject({
        code: "CONFLICT",
      });
      throw new Error("operation failed");
    });
    await expect(first).rejects.toThrow("operation failed");
    await expect(withWorkspaceSyncLock(sandbox, async () => "next operation")).resolves.toBe(
      "next operation",
    );
  });

  it("does not serialize independent worktrees", async () => {
    const other = join(sandbox, "other-worktree");
    await mkdir(other);
    await expect(
      withWorkspaceSyncLock(sandbox, () => withWorkspaceSyncLock(other, async () => "parallel")),
    ).resolves.toBe("parallel");
  });
});
