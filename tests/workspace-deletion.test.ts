import { access, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as storage from "../src/storage.js";
import { createWorkspaceFixture } from "./helpers/workspace-fixture.js";

describe("workspace deletion transaction", () => {
  let f: Awaited<ReturnType<typeof createWorkspaceFixture>>;
  beforeEach(async () => {
    f = await createWorkspaceFixture();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await f.dispose();
  }, 20000);

  it("restores the workspace directory before restoring its managed links", async () => {
    const remote = await f.remote("restore");
    const workspace = await f.manager.cloneWorkspace({
      name: "restore",
      repositoryIds: [remote.repository.id],
      branchName: "feat/restore",
    });
    vi.spyOn(storage, "writeJsonAtomic").mockRejectedValueOnce(new Error("injected write failure"));
    await expect(f.manager.deleteWorkspace(workspace.id)).rejects.toThrow("injected write failure");
    await expect(
      readFile(join(workspace.absolutePath, remote.repository.name, "origin.txt"), "utf8"),
    ).resolves.toBe("restore remote\n");
    await expect(f.manager.searchWorkspaces()).resolves.toEqual([workspace]);
  });

  it.each(["workspace", "member"] as const)(
    "restores a detached reference at its exact original commit after %s removal fails",
    async (operation) => {
      const remote = await f.remote("reference");
      const workspace = await f.manager.cloneWorkspace({
        name: "reference",
        repositoryIds: [remote.repository.id],
        referenceRepositoryIds: [remote.repository.id],
      });
      const memberPath = join(workspace.absolutePath, remote.repository.name);
      const head = (await f.git(memberPath, "rev-parse", "HEAD")).stdout;
      await f.commit(remote.path, "later.txt");
      await f.git(remote.path, "push", "-q", "origin", "main");
      vi.spyOn(storage, "writeJsonAtomic").mockRejectedValueOnce(
        new Error("injected write failure"),
      );
      const remove =
        operation === "workspace"
          ? f.manager.deleteWorkspace(workspace.id)
          : f.manager.removeWorkspaceMember({
              workspaceId: workspace.id,
              repositoryId: remote.repository.id,
            });
      await expect(remove).rejects.toThrow("injected write failure");
      expect((await f.git(memberPath, "rev-parse", "HEAD")).stdout).toBe(head);
      await expect(access(join(memberPath, "later.txt"))).rejects.toThrow();
      await expect(f.manager.searchWorkspaces()).resolves.toEqual([workspace]);
    },
  );

  it("protects canonical repositories registered inside a workspace", async () => {
    const remote = await f.remote("canonical");
    const workspace = await f.manager.createWorkspace({ name: "nested" });
    const nested = join(workspace.absolutePath, "canonical");
    await f.git(f.sandbox, "clone", "-q", remote.remotePath, nested);
    // Register this checkout independently rather than deduplicating by its source remote.
    await f.git(nested, "remote", "remove", "origin");
    await f.manager.register({ path: nested });
    await expect(f.manager.deleteWorkspace(workspace.id)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(readFile(join(nested, "origin.txt"), "utf8")).resolves.toBe("canonical remote\n");
    await expect(f.manager.searchWorkspaces()).resolves.toEqual([workspace]);
  });
  it.each(["rootDir", "workspaceRoot"] as const)(
    "protects the physical %s when configured through a symlink",
    async (setting) => {
      const physicalRoot = await realpath(f.rootDir);
      const alias = join(f.sandbox, "configured-root-link");
      await symlink(physicalRoot, alias);
      await f.manager.updateConfig({ [setting]: alias });
      await writeFile(join(physicalRoot, "keep.txt"), "storage marker\n");
      const workspace = await f.manager.createWorkspace({
        name: "protected-root",
        path: physicalRoot,
      });
      await expect(f.manager.deleteWorkspace(workspace.id)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await readFile(join(physicalRoot, "keep.txt"), "utf8")).toBe("storage marker\n");
    },
  );
});
