import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryManager } from "../src/manager.js";
import { createFileFunctions } from "../src/devtool/files-rpc.js";
import { listProjectDirectory, readProjectFile } from "../src/project/files.js";
import { readProjectAsset } from "../src/project/assets.js";
import { projectContains } from "../src/project/paths.js";
import type { RepositoryRecord, WorkspaceRecord } from "../src/types.js";

describe("local project preview", () => {
  let temporary: string;
  let root: string;
  let canonical: string;
  const workspaceId = "workspace:preview" as WorkspaceRecord["id"];
  const repositoryId = "local:preview" as RepositoryRecord["id"];
  let manager: ReturnType<typeof createRepositoryManager>;
  let workspace: WorkspaceRecord;
  const input = (path: string) => ({ workspaceId, repositoryId, path });
  it("serves only bounded, signature-checked image data through the same member boundary", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFOwAAAAASUVORK5CYII=",
      "base64",
    );
    await writeFile(join(root, "image.png"), png);
    expect(await readProjectAsset(manager, input("image.png"))).toMatchObject({
      path: "image.png",
      bytes: png.length,
      url: `data:image/png;base64,${png.toString("base64")}`,
    });
    await writeFile(join(root, "pretend.png"), "<script>not an image</script>");
    await expect(readProjectAsset(manager, input("pretend.png"))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(readProjectAsset(manager, input("../outside.png"))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  beforeEach(async () => {
    temporary = await mkdtemp(join(tmpdir(), "cpl-preview-"));
    root = join(temporary, "worktree");
    canonical = join(temporary, "canonical");
    await Promise.all([mkdir(root), mkdir(canonical)]);
    await writeFile(join(root, "README.md"), "# Working copy\n你好\n");
    await writeFile(join(canonical, "README.md"), "# Canonical\n");
    workspace = {
      id: workspaceId,
      name: "Preview",
      absolutePath: join(temporary, "requirement"),
      createdAt: "2026-10-22",
      updatedAt: "2026-10-22",
      members: [
        {
          repositoryId,
          alias: "preview",
          mode: "worktree",
          branch: "feat/preview",
          worktreePath: root,
        },
      ],
    };
    manager = createRepositoryManager({ dataDir: join(temporary, "data") });
    vi.spyOn(manager, "searchWorkspaces").mockImplementation(async () => [workspace]);
    vi.spyOn(manager, "search").mockResolvedValue([
      {
        id: repositoryId,
        kind: "local",
        name: "preview",
        classificationPath: "local/preview",
        absolutePath: canonical,
        isManaged: true,
        registeredAt: "2026-10-22",
        lastSeenAt: "2026-10-22",
      },
    ]);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(temporary, { recursive: true, force: true });
  });

  it("reads the selected member's working files through both RPC queries without writing", async () => {
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export const answer = 42;\n");
    const [list, read] = createFileFunctions(manager);
    expect(list.name).toBe("list-project-directory");
    expect(read.name).toBe("read-project-file");
    const listing = await list.handler!(input(""));
    expect(listing.entries.map((entry) => entry.name)).toEqual(["src", "README.md"]);
    expect((await list.handler!(input("src"))).entries[0]?.path).toBe("src/index.ts");
    expect((await read.handler!(input("README.md"))).content).toContain("Working copy");
    expect((await read.handler!(input("src/index.ts"))).bytes).toBe(26);
    expect(await readFile(join(root, "README.md"), "utf8")).toBe("# Working copy\n你好\n");
    expect(await readFile(join(canonical, "README.md"), "utf8")).toBe("# Canonical\n");
  });

  it("resolves legacy linked members from their registered repository", async () => {
    workspace.members = [{ repositoryId, alias: "reference", mode: "link" }];
    expect((await readProjectFile(manager, input("README.md"))).content).toBe("# Canonical\n");
  });

  it("rejects unknown requirements, removed members and unregistered repositories", async () => {
    await expect(
      readProjectFile(manager, { ...input("README.md"), workspaceId: "missing" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    workspace.members = [];
    await expect(readProjectFile(manager, input("README.md"))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    workspace.members = [{ repositoryId, alias: "reference", mode: "link" }];
    vi.spyOn(manager, "search").mockResolvedValue([]);
    await expect(listProjectDirectory(manager, input(""))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("rejects traversal, absolute paths, Git internals and common secret paths", async () => {
    for (const path of [
      ".",
      "..",
      "../canonical/README.md",
      "/etc/passwd",
      "src/../../README.md",
      "src\\secret",
      "x\0y",
      ".git/config",
      ".GIT/config",
      "NODE_MODULES/pkg/index.js",
      "node_modules/pkg/index.js",
      ".worktrees/other/index.ts",
      ".env",
      ".env.local",
      ".npmrc",
      "tls.key",
      "private.pem",
      ".ssh/config",
      "a//b",
      "./README.md",
    ]) {
      await expect(readProjectFile(manager, input(path))).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
      await expect(listProjectDirectory(manager, input(path))).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
  });

  it("keeps the immediate parent and sibling directories outside the project boundary", () => {
    expect(projectContains(root, root)).toBe(true);
    expect(projectContains(root, join(root, "src"))).toBe(true);
    expect(projectContains(root, temporary)).toBe(false);
    expect(projectContains(root, canonical)).toBe(false);
    expect(projectContains(root, `${root}-other`)).toBe(false);
  });

  it("does not list or follow internal and external symlinks or common secrets", async () => {
    await Promise.all([
      mkdir(join(root, ".git")),
      mkdir(join(root, "node_modules")),
      writeFile(join(root, ".env"), "SECRET=1"),
      writeFile(join(root, "tls.key"), "secret"),
      symlink(canonical, join(root, "outside")),
      symlink(join(root, "README.md"), join(root, "inside")),
    ]);
    expect(
      (await listProjectDirectory(manager, input(""))).entries.map((entry) => entry.name),
    ).toEqual(["README.md"]);
    for (const path of ["outside/README.md", "inside"]) {
      await expect(readProjectFile(manager, input(path))).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
  });

  it("handles empty text and rejects binary, invalid UTF-8, directories and large files", async () => {
    await Promise.all([
      writeFile(join(root, "empty.txt"), ""),
      writeFile(join(root, "binary.dat"), Buffer.from([1, 0, 2])),
      writeFile(join(root, "invalid.txt"), Buffer.from([0xff, 0xfe])),
      writeFile(join(root, "large.txt"), Buffer.alloc(4 * 1024 * 1024 + 1, 65)),
    ]);
    expect(await readProjectFile(manager, input("empty.txt"))).toMatchObject({
      content: "",
      bytes: 0,
    });
    for (const path of ["binary.dat", "invalid.txt", "large.txt", ""]) {
      await expect(readProjectFile(manager, input(path))).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    }
    await expect(readProjectFile(manager, input("missing.txt"))).rejects.toThrow();
  });

  it("rejects a registered root replaced by a symlink", async () => {
    const replacement = join(temporary, "replacement");
    await symlink(canonical, replacement);
    workspace.members = [
      {
        repositoryId,
        alias: "preview",
        mode: "worktree",
        branch: "feat/preview",
        worktreePath: replacement,
      },
    ];
    await expect(readProjectFile(manager, input("README.md"))).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("bounds directory responses without pretending the listing is complete", async () => {
    await mkdir(join(root, "many"));
    await Promise.all(
      Array.from({ length: 1001 }, (_, index) => writeFile(join(root, "many", `${index}.txt`), "")),
    );
    const result = await listProjectDirectory(manager, input("many"));
    expect(result.entries).toHaveLength(1000);
    expect(result.truncated).toBe(true);
  });
});
