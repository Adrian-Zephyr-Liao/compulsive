import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectFixture } from "./helpers/project-fixture.js";
import { createProjectWatcher } from "../src/project/watch.js";
describe("editor file events", () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  let watcher: ReturnType<typeof createProjectWatcher>;
  beforeEach(async () => {
    f = await createProjectFixture();
    watcher = createProjectWatcher(f.manager);
  }, 30000);
  afterEach(async () => {
    watcher.dispose();
    await f.dispose();
  }, 20000);
  it("delivers filesystem events with cursors and releases waits on shutdown", async () => {
    const initial = await watcher.wait({ ...f.input(), cursor: 0 });
    expect(initial.paths).toEqual([""]);
    const waiting = watcher.wait({ ...f.input(), cursor: initial.cursor });
    await writeFile(join(f.root, "origin.txt"), "changed by another editor\n");
    const changed = await waiting;
    expect(changed.cursor).toBeGreaterThan(initial.cursor);
    expect(changed.paths).toContain("origin.txt");
    const remaining = expect(
      watcher.wait({ ...f.input(), cursor: changed.cursor }),
    ).rejects.toThrow("closed");
    watcher.dispose();
    await remaining;
  });
});
