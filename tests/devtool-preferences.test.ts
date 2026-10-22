import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepositoryManager } from "../src/manager.js";
import { devtoolPreferences } from "../src/devtool-preferences.js";
import { createStateFunctions } from "../src/devtool/state-rpc.js";

describe("global DevTool appearance", () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "cpl-appearance-"));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const manager = () => createRepositoryManager({ dataDir: directory });
  it("stores one global theme beside CPL config and returns it from a new manager", async () => {
    const instance = manager();
    expect(await devtoolPreferences(instance)).toEqual({ dark: false });
    const action = createStateFunctions(instance).find(
      (fn) => fn.name === "update-devtool-preferences",
    )!;
    expect(await action.handler!({ dark: true })).toEqual({ dark: true });
    expect(await devtoolPreferences(manager())).toEqual({ dark: true });
    expect(JSON.parse(await readFile(join(directory, "devtool-preferences.json"), "utf8"))).toEqual(
      { dark: true },
    );
    expect((await stat(join(directory, "devtool-preferences.json"))).mode & 0o777).toBe(0o600);
  });
  it("rejects invalid inputs without changing saved data and strips unrelated fields", async () => {
    const instance = manager();
    await devtoolPreferences(instance, { dark: true, content: "never-persist" });
    for (const input of [null, [], {}, { dark: "true" }, { dark: 1 }])
      await expect(devtoolPreferences(instance, input)).rejects.toMatchObject({
        code: "INVALID_INPUT",
      });
    const data = await readFile(join(directory, "devtool-preferences.json"), "utf8");
    expect(JSON.parse(data)).toEqual({ dark: true });
    expect(data).not.toContain("never-persist");
    await writeFile(join(directory, "devtool-preferences.json"), '{"dark":"invalid"}');
    await expect(devtoolPreferences(instance)).rejects.toMatchObject({ code: "FILESYSTEM_FAILED" });
  });
  it("serializes rapid changes without letting an earlier write win", async () => {
    const instance = manager();
    await Promise.all(
      [false, true, false, true].map((dark) => devtoolPreferences(instance, { dark })),
    );
    expect(await devtoolPreferences(manager())).toEqual({ dark: true });
  });
});
