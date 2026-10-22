import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectFixture } from "./helpers/project-fixture.js";
import { createProjectSearch, matchProjectDocuments } from "../src/project/search.js";
import { saveProjectFile } from "../src/project/mutations.js";
describe("project search", () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  beforeEach(async () => {
    f = await createProjectFixture();
  }, 30000);
  afterEach(async () => {
    await f.dispose();
  }, 20000);
  it("executes bounded worker search, brace filters and versioned replacement previews", async () => {
    await mkdir(join(f.root, "src"));
    await writeFile(join(f.root, "src/a.ts"), "one hello\nhello world\n");
    await writeFile(join(f.root, "src/b.tsx"), "HELLO\n");
    await writeFile(join(f.root, ".env"), "hello secret");
    const search = createProjectSearch(f.manager);
    const options = {
      ...f.input(),
      requestId: "search-1",
      query: "hello",
      regex: false,
      matchCase: false,
      wholeWord: true,
      include: "*.{ts,tsx}",
      exclude: "",
      offset: 0,
      replacement: "welcome",
    };
    const result = await search.search(options);
    expect(result.matches).toHaveLength(3);
    expect(result.matches[1]).toMatchObject({ path: "src/a.ts", line: 2, column: 1 });
    expect(result.replacements).toHaveLength(2);
    expect(result.matches.some((m) => m.path === ".env")).toBe(false);
    const preview = result.replacements[0]!;
    await writeFile(join(f.root, preview.path), "external\n");
    await expect(
      saveProjectFile(f.manager, { ...f.input(preview.path), ...preview }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      search.search({ ...options, requestId: "invalid", query: "(", regex: true }),
    ).rejects.toThrow();
    search.dispose();
  });
  it("rejects unsafe replacement truncation rather than miscounting changed text", () => {
    expect(() =>
      matchProjectDocuments({
        documents: [{ path: "a", content: "a".repeat(2100), version: "v" }],
        query: "a",
        regex: false,
        matchCase: true,
        wholeWord: false,
        replacement: "b",
      }),
    ).toThrow("Too many matches");
  });
  it("terminates catastrophic regular expressions without blocking the server", async () => {
    await writeFile(join(f.root, "slow.txt"), `${"a".repeat(20000)}!`);
    const search = createProjectSearch(f.manager);
    await expect(
      search.search({
        ...f.input(),
        requestId: "slow",
        query: "(a+)+$",
        regex: true,
        matchCase: true,
        wholeWord: false,
        include: "slow.txt",
        exclude: "",
        offset: 0,
      }),
    ).rejects.toThrow("timed out");
    search.dispose();
  });
  it("cancels an in-flight search and permits a subsequent search", async () => {
    const search = createProjectSearch(f.manager);
    const options = {
      ...f.input(),
      requestId: "cancel-me",
      query: "remote",
      regex: false,
      matchCase: false,
      wholeWord: false,
      include: "",
      exclude: "",
      offset: 0,
    };
    const pending = expect(search.search(options)).rejects.toThrow();
    // Cancellation may race initial authorization; wait until the operation has registered.
    for (let i = 0; i < 100; i++) {
      search.cancel(options);
      await new Promise((r) => setTimeout(r, 1));
    }
    await pending;
    expect((await search.search({ ...options, requestId: "next" })).matches).toHaveLength(1);
    search.dispose();
  });
});
