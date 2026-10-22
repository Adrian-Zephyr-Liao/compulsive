import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { createProjectFixture } from "./helpers/project-fixture.js";
import { readProjectFile } from "../src/project/files.js";
import {
  createProjectItem,
  inspectProjectItem,
  renameProjectItem,
  saveProjectFile,
  trashProjectItem,
} from "../src/project/mutations.js";
import type { ProjectFileInput } from "../src/project/paths.js";

describe("editor file mutations", () => {
  let fixture: Awaited<ReturnType<typeof createProjectFixture>>;
  let input: (path: string) => ProjectFileInput;
  let root: string;
  beforeEach(async () => {
    fixture = await createProjectFixture();
    root = fixture.root;
    input = fixture.input;
  }, 30000);
  afterEach(async () => {
    await fixture.dispose();
  }, 20000);

  it("atomically saves the expected content version and preserves permissions and line endings", async () => {
    await writeFile(join(root, "source.ts"), "const one = 1;\r\n");
    await chmod(join(root, "source.ts"), 0o640);
    const before = await readProjectFile(fixture.manager, input("source.ts"));
    const after = await saveProjectFile(fixture.manager, {
      ...input("source.ts"),
      content: "const one = 2;\r\n",
      expectedVersion: before.version,
    });
    expect(after.content).toBe("const one = 2;\r\n");
    expect(after.version).not.toBe(before.version);
    expect((await lstat(join(root, "source.ts"))).mode & 0o777).toBe(0o640);
    expect((await readdir(root)).filter((name) => name.startsWith(".cpl-save-"))).toEqual([]);
  });

  it("rejects stale or competing saves without overwriting the winner", async () => {
    const before = await readProjectFile(fixture.manager, input("origin.txt"));
    const save = (content: string) =>
      saveProjectFile(fixture.manager, {
        ...input("origin.txt"),
        content,
        expectedVersion: before.version,
      });
    const results = await Promise.allSettled([save("first\n"), save("second\n")]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(["first\n", "second\n"]).toContain(await readFile(join(root, "origin.txt"), "utf8"));
    await writeFile(join(root, "origin.txt"), "external\n");
    await expect(save("stale\n")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(join(root, "origin.txt"), "utf8")).toBe("external\n");
  });

  it("creates files and folders exclusively and refuses overwrite or protected paths", async () => {
    await createProjectItem(fixture.manager, { ...input("src"), directory: true });
    await createProjectItem(fixture.manager, { ...input("src/new.ts"), directory: false });
    expect(await readFile(join(root, "src/new.ts"), "utf8")).toBe("");
    await expect(
      createProjectItem(fixture.manager, { ...input("origin.txt"), directory: false }),
    ).rejects.toThrow();
    for (const path of ["", "../outside", ".git/config", ".env.local"])
      await expect(
        createProjectItem(fixture.manager, { ...input(path), directory: false }),
      ).rejects.toThrow();
    expect(await readFile(join(root, "origin.txt"), "utf8")).toContain("remote");
  });

  it("renames the checked identity but does not overwrite a destination or move nested Git repositories", async () => {
    const inspected = await inspectProjectItem(fixture.manager, input("origin.txt"));
    await expect(
      renameProjectItem(fixture.manager, {
        ...input("origin.txt"),
        destination: "other.txt",
        expectedIdentity: "stale",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await renameProjectItem(fixture.manager, {
      ...input("origin.txt"),
      destination: "renamed.txt",
      expectedIdentity: inspected.identity,
    });
    expect(await readFile(join(root, "renamed.txt"), "utf8")).toContain("remote");
    await writeFile(join(root, "occupied.txt"), "keep");
    const current = await inspectProjectItem(fixture.manager, input("renamed.txt"));
    await expect(
      renameProjectItem(fixture.manager, {
        ...input("renamed.txt"),
        destination: "occupied.txt",
        expectedIdentity: current.identity,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await mkdir(join(root, "nested/.git"), { recursive: true });
    const nested = await inspectProjectItem(fixture.manager, input("nested"));
    await expect(
      renameProjectItem(fixture.manager, {
        ...input("nested"),
        destination: "moved",
        expectedIdentity: nested.identity,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await readFile(join(root, "occupied.txt"), "utf8")).toBe("keep");
  });

  it("moves only the confirmed item through recoverable Trash and rejects swapped symlinks", async () => {
    const item = await inspectProjectItem(fixture.manager, input("origin.txt"));
    const trashedPath = join(fixture.sandbox, "test-trash.txt");
    const move = (path: string) => rename(path, trashedPath);
    await expect(
      trashProjectItem(
        fixture.manager,
        { ...input("origin.txt"), expectedIdentity: item.identity, confirmedPath: "other.txt" },
        move,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await trashProjectItem(
      fixture.manager,
      { ...input("origin.txt"), expectedIdentity: item.identity, confirmedPath: "origin.txt" },
      move,
    );
    expect(await readFile(trashedPath, "utf8")).toContain("remote");
    await symlink(trashedPath, join(root, "origin.txt"));
    await expect(
      trashProjectItem(
        fixture.manager,
        { ...input("origin.txt"), expectedIdentity: item.identity, confirmedPath: "origin.txt" },
        move,
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await readFile(trashedPath, "utf8")).toContain("remote");
  });
});
