import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadCompulsiveConfig } from "../src/file-config.js";

describe("loadCompulsiveConfig", () => {
  let sandbox: string;
  let homeDir: string;

  beforeEach(async () => {
    sandbox = await mkdtemp(join(tmpdir(), "compulsive-config-"));
    homeDir = join(sandbox, "home");
    await mkdir(homeDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(sandbox, { recursive: true, force: true });
  });

  it("loads the nearest JSONC file and resolves its paths", async () => {
    const projectDir = join(sandbox, "workspace");
    const nestedDir = join(projectDir, "packages", "app");
    await mkdir(nestedDir, { recursive: true });
    await writeFile(
      join(projectDir, "compulsive.config.jsonc"),
      `{
        // Paths are resolved from this file.
        "rootDir": "./source",
        "scanRoots": ["~/Projects", "./legacy",],
        "ui": { "color": "always", "unicode": false, },
      }`,
    );

    await expect(loadCompulsiveConfig({ cwd: nestedDir, homeDir })).resolves.toEqual({
      path: join(projectDir, "compulsive.config.jsonc"),
      config: {
        rootDir: join(projectDir, "source"),
        scanRoots: [join(homeDir, "Projects"), join(projectDir, "legacy")],
        ui: { color: "always", unicode: false },
      },
    });
  });

  it("prefers an explicit config file and reports missing files", async () => {
    const configPath = join(sandbox, "custom.jsonc");
    await writeFile(configPath, `{ "ui": { "color": "never" } }`);

    await expect(
      loadCompulsiveConfig({ cwd: sandbox, homeDir, configPath }),
    ).resolves.toMatchObject({ path: configPath, config: { ui: { color: "never" } } });
    await expect(
      loadCompulsiveConfig({ cwd: sandbox, homeDir, configPath: join(sandbox, "missing.jsonc") }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("returns no source when no config file exists", async () => {
    await expect(loadCompulsiveConfig({ cwd: sandbox, homeDir })).resolves.toEqual({
      config: {},
    });
  });

  it("rejects unknown fields and invalid terminal settings", async () => {
    const configPath = join(sandbox, "compulsive.config.jsonc");
    await writeFile(configPath, `{ "root": "wrong", "ui": { "color": "rainbow" } }`);

    await expect(loadCompulsiveConfig({ cwd: sandbox, homeDir })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
