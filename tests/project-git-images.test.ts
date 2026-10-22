import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectFixture } from "./helpers/project-fixture.js";
import { projectGitDiff } from "../src/project/git.js";
import { projectTextLimit } from "../src/project/files.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFOwAAAAASUVORK5CYII=",
  "base64",
);
const nextPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const url = (data: Buffer) => `data:image/png;base64,${data.toString("base64")}`;

describe("image change review", () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  beforeEach(async () => {
    f = await createProjectFixture();
  }, 30000);
  afterEach(async () => {
    await f.dispose();
  }, 20000);
  const diff = (path: string, staged = false, revision?: string) =>
    projectGitDiff(f.manager, { ...f.input(path), staged, ...(revision && { revision }) });
  async function commitImage(path = "image.png", data = png) {
    await writeFile(join(f.root, path), data);
    await f.git(f.root, "add", "--", path);
    await f.git(f.root, "commit", "-q", "-m", "Add test image");
  }

  it("preserves both image blobs byte-for-byte for working and staged changes", async () => {
    const path = "docs/image[1].png";
    await mkdir(join(f.root, "docs"));
    await commitImage(path);
    await writeFile(join(f.root, path), nextPng);
    for (const staged of [false, true]) {
      if (staged) await f.git(f.root, "add", "--", path);
      const result = await diff(path, staged);
      expect(result).toMatchObject({
        original: "",
        content: "",
        images: { original: url(png), content: url(nextPng) },
        hunks: [],
      });
      expect(Buffer.from(result.images!.original!.split(",")[1]!, "base64")).toEqual(png);
      expect(Buffer.from(result.images!.content!.split(",")[1]!, "base64")).toEqual(nextPng);
    }
    expect(await readFile(join(f.root, path))).toEqual(nextPng);
  });

  it("recognizes an untracked image by its signature instead of its extension", async () => {
    await writeFile(join(f.root, "image.data"), png);
    const image = await diff("image.data");
    expect(image).toMatchObject({
      original: "",
      content: "",
      images: { content: url(png) },
    });
    expect(image.images).not.toHaveProperty("original");
    await writeFile(join(f.root, "pretend.png"), "\ufeffplain UTF-8 中文\n");
    const text = await diff("pretend.png");
    expect(text).toMatchObject({
      original: "",
      content: "\ufeffplain UTF-8 中文\n",
    });
    expect(text).not.toHaveProperty("images");
  });

  it("shows only the original side for unstaged and staged deletions", async () => {
    await commitImage();
    await rm(join(f.root, "image.png"));
    expect((await diff("image.png")).images).toEqual({ original: url(png) });
    await f.git(f.root, "add", "--", "image.png");
    expect((await diff("image.png", true)).images).toEqual({ original: url(png) });
  });

  it.each(["added", "changed", "deleted"])("reviews a historical %s image", async (operation) => {
    await commitImage();
    if (operation === "changed") await commitImage("image.png", nextPng);
    if (operation === "deleted") {
      await f.git(f.root, "rm", "--", "image.png");
      await f.git(f.root, "commit", "-q", "-m", "Delete test image");
    }
    const revision = (await f.git(f.root, "rev-parse", "HEAD")).stdout.trim();
    expect((await diff("image.png", false, revision)).images).toEqual({
      ...(operation !== "added" && { original: url(png) }),
      ...(operation !== "deleted" && { content: url(operation === "added" ? png : nextPng) }),
    });
  });

  it("keeps the text side when a file changes from an image to UTF-8 text", async () => {
    await commitImage();
    await writeFile(join(f.root, "image.png"), "now text 中文\n");
    expect(await diff("image.png")).toMatchObject({
      images: { original: url(png) },
      original: "",
      content: "now text 中文\n",
    });
  });

  it("keeps the text side when a file changes from UTF-8 text to an image", async () => {
    await writeFile(join(f.root, "origin.txt"), nextPng);
    expect(await diff("origin.txt")).toMatchObject({
      images: { content: url(nextPng) },
      original: "editor remote\n",
      content: "",
    });
  });

  it.each([Buffer.from([1, 0, 255]), Buffer.from([255, 254, 253])])(
    "rejects unsupported binary or invalid UTF-8 %j in working and staged files",
    async (data) => {
      await writeFile(join(f.root, "pretend.png"), data);
      await expect(diff("pretend.png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
      await f.git(f.root, "add", "--", "pretend.png");
      await expect(diff("pretend.png", true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    },
  );

  it("accepts the 4 MiB boundary for working and Git blob images", async () => {
    const boundary = Buffer.alloc(projectTextLimit);
    png.copy(boundary);
    await writeFile(join(f.root, "large.png"), boundary);
    expect((await diff("large.png")).images?.content).toBe(url(boundary));
    await f.git(f.root, "add", "--", "large.png");
    expect((await diff("large.png", true)).images?.content).toBe(url(boundary));
  });

  it("rejects working and Git blob images larger than the bounded output", async () => {
    const oversized = Buffer.alloc(projectTextLimit + 2);
    png.copy(oversized);
    await writeFile(join(f.root, "large.png"), oversized);
    await expect(diff("large.png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await f.git(f.root, "add", "--", "large.png");
    await expect(diff("large.png", true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("retains path, secret, membership and symlink boundaries", async () => {
    await writeFile(join(f.root, "image.png"), png);
    await writeFile(join(f.root, ".env.local"), png);
    await f.git(f.root, "add", "--", ".env.local");
    for (const path of ["../image.png", "/tmp/image.png", ".env.local", ".git/config"]) {
      await expect(diff(path, true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(
      projectGitDiff(f.manager, {
        ...f.input("image.png"),
        repositoryId: "missing",
        staged: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await symlink(join(f.root, "image.png"), join(f.root, "linked.png"));
    await expect(diff("linked.png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await f.git(f.root, "add", "--", "linked.png");
    await expect(diff("linked.png", true)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await mkdir(join(f.root, "directory"));
    await expect(diff("directory")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});
