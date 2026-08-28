import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defineConfig, loadCompulsiveConfig } from "../src/file-config.js";

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

  it("loads a JSONC file and resolves its paths", async () => {
    const projectDir = join(sandbox, "workspace");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, "compulsive.config.jsonc"),
      `{
        // Paths are resolved from this file.
        "rootDir": "./source",
        "workspaceRoot": "./groups",
        "scanRoots": ["~/Projects", "./legacy",],
        "ui": { "color": "always", "unicode": false, },
      }`,
    );

    const canonicalProjectDir = await realpath(projectDir);
    await expect(loadCompulsiveConfig({ cwd: projectDir, homeDir })).resolves.toEqual({
      path: join(canonicalProjectDir, "compulsive.config.jsonc"),
      config: {
        rootDir: join(canonicalProjectDir, "source"),
        workspaceRoot: join(canonicalProjectDir, "groups"),
        scanRoots: [join(homeDir, "Projects"), join(canonicalProjectDir, "legacy")],
        ui: { color: "always", unicode: false },
      },
    });
  });

  it("loads an unbuild-style TypeScript configuration", async () => {
    await writeFile(
      join(sandbox, "compulsive.config.ts"),
      `export default {
        rootDir: "./source",
        ui: { color: "auto", unicode: true },
      }`,
    );

    const canonicalSandbox = await realpath(sandbox);
    await expect(loadCompulsiveConfig({ cwd: sandbox, homeDir })).resolves.toMatchObject({
      path: join(canonicalSandbox, "compulsive.config.ts"),
      config: {
        rootDir: join(canonicalSandbox, "source"),
        ui: { color: "auto", unicode: true },
      },
    });
  });

  it("exports a typed defineConfig helper", () => {
    expect(defineConfig({ workspaceRoot: "./groups", ui: { color: "never" } })).toEqual({
      workspaceRoot: "./groups",
      ui: { color: "never" },
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
