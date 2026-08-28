import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

import { createDefineConfig, loadConfig } from "c12";

import { CompulsiveError } from "./errors.js";

export type TerminalColorMode = "auto" | "always" | "never";

export interface CompulsiveFileConfig {
  rootDir?: string;
  workspaceRoot?: string;
  scanRoots?: string[];
  ui?: {
    color?: TerminalColorMode;
    unicode?: boolean;
  };
}

export interface LoadedCompulsiveConfig {
  path?: string;
  config: CompulsiveFileConfig;
}

export interface LoadCompulsiveConfigOptions {
  configPath?: string;
  cwd?: string;
  homeDir?: string;
}

export const defineConfig = createDefineConfig<CompulsiveFileConfig>();

function resolveConfiguredPath(
  value: string,
  baseDirectory: string,
  homeDirectory: string,
): string {
  if (value === "~") return resolve(homeDirectory);
  if (value.startsWith("~/")) return resolve(homeDirectory, value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(baseDirectory, value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validateConfig(value: unknown, path: string): CompulsiveFileConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CompulsiveError("INVALID_INPUT", `Configuration must be an object: ${path}`);
  }
  const config = value as Record<string, unknown>;
  if (!hasOnlyKeys(config, ["$schema", "rootDir", "workspaceRoot", "scanRoots", "ui"])) {
    throw new CompulsiveError("INVALID_INPUT", `Configuration contains unknown fields: ${path}`);
  }
  if (config.rootDir !== undefined && typeof config.rootDir !== "string") {
    throw new CompulsiveError("INVALID_INPUT", `rootDir must be a string: ${path}`);
  }
  if (config.workspaceRoot !== undefined && typeof config.workspaceRoot !== "string") {
    throw new CompulsiveError("INVALID_INPUT", `workspaceRoot must be a string: ${path}`);
  }
  if (
    config.scanRoots !== undefined &&
    (!Array.isArray(config.scanRoots) ||
      !config.scanRoots.every((item) => typeof item === "string"))
  ) {
    throw new CompulsiveError("INVALID_INPUT", `scanRoots must be an array of strings: ${path}`);
  }
  if (config.ui !== undefined) {
    if (typeof config.ui !== "object" || config.ui === null || Array.isArray(config.ui)) {
      throw new CompulsiveError("INVALID_INPUT", `ui must be an object: ${path}`);
    }
    const ui = config.ui as Record<string, unknown>;
    if (!hasOnlyKeys(ui, ["color", "unicode"])) {
      throw new CompulsiveError("INVALID_INPUT", `ui contains unknown fields: ${path}`);
    }
    if (
      ui.color !== undefined &&
      (typeof ui.color !== "string" || !["auto", "always", "never"].includes(ui.color))
    ) {
      throw new CompulsiveError(
        "INVALID_INPUT",
        `ui.color must be auto, always, or never: ${path}`,
      );
    }
    if (ui.unicode !== undefined && typeof ui.unicode !== "boolean") {
      throw new CompulsiveError("INVALID_INPUT", `ui.unicode must be a boolean: ${path}`);
    }
  }
  return config as CompulsiveFileConfig;
}

export async function loadCompulsiveConfig(
  options: LoadCompulsiveConfigOptions = {},
): Promise<LoadedCompulsiveConfig> {
  const currentDirectory = resolve(options.cwd ?? process.cwd());
  const homeDirectory = resolve(options.homeDir ?? homedir());
  const explicitPath = options.configPath
    ? resolveConfiguredPath(options.configPath, currentDirectory, homeDirectory)
    : undefined;

  try {
    const loaded = await loadConfig<CompulsiveFileConfig>({
      name: "compulsive",
      cwd: currentDirectory,
      ...(explicitPath === undefined ? {} : { configFile: explicitPath }),
      configFileRequired: explicitPath !== undefined,
      rcFile: false,
      globalRc: false,
      packageJson: false,
      dotenv: false,
      envName: false,
      extend: false,
      giget: false,
    });
    if (!loaded._configFile) return { config: {} };
    const path = loaded._configFile;
    const config = validateConfig(loaded.config, path);
    const baseDirectory = dirname(path);
    return {
      path,
      config: {
        ...(config.rootDir === undefined
          ? {}
          : { rootDir: resolveConfiguredPath(config.rootDir, baseDirectory, homeDirectory) }),
        ...(config.workspaceRoot === undefined
          ? {}
          : {
              workspaceRoot: resolveConfiguredPath(
                config.workspaceRoot,
                baseDirectory,
                homeDirectory,
              ),
            }),
        ...(config.scanRoots === undefined
          ? {}
          : {
              scanRoots: config.scanRoots.map((item) =>
                resolveConfiguredPath(item, baseDirectory, homeDirectory),
              ),
            }),
        ...(config.ui === undefined ? {} : { ui: config.ui }),
      },
    };
  } catch (error) {
    if (error instanceof CompulsiveError) throw error;
    const source = explicitPath ?? currentDirectory;
    throw new CompulsiveError(
      "INVALID_INPUT",
      explicitPath
        ? `Configuration file does not exist or cannot be loaded: ${source}`
        : `Unable to load configuration from: ${source}`,
      { cause: error },
    );
  }
}
