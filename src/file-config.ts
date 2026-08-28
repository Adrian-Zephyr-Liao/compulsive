import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

import { parseJSONC, type JSONCParseError } from "confbox/jsonc";

import { CompulsiveError } from "./errors.js";

export type TerminalColorMode = "auto" | "always" | "never";

export interface CompulsiveFileConfig {
  rootDir?: string;
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

const configNames = [
  "compulsive.config.jsonc",
  "compulsive.config.json",
  ".compulsiverc.jsonc",
  ".compulsiverc.json",
];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function findConfig(startDirectory: string): Promise<string | undefined> {
  let directory = resolve(startDirectory);
  const root = parse(directory).root;
  for (;;) {
    for (const name of configNames) {
      const candidate = join(directory, name);
      if (await exists(candidate)) return candidate;
    }
    if (directory === root) return undefined;
    directory = dirname(directory);
  }
}

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
  if (!hasOnlyKeys(config, ["$schema", "rootDir", "scanRoots", "ui"])) {
    throw new CompulsiveError("INVALID_INPUT", `Configuration contains unknown fields: ${path}`);
  }
  if (config.rootDir !== undefined && typeof config.rootDir !== "string") {
    throw new CompulsiveError("INVALID_INPUT", `rootDir must be a string: ${path}`);
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
  const path = explicitPath ?? (await findConfig(currentDirectory));
  if (!path) return { config: {} };
  if (explicitPath && !(await exists(path))) {
    throw new CompulsiveError("INVALID_INPUT", `Configuration file does not exist: ${path}`);
  }

  try {
    const errors: JSONCParseError[] = [];
    const parsed = parseJSONC<unknown>(await readFile(path, "utf8"), {
      allowTrailingComma: true,
      errors,
    });
    if (errors.length > 0) {
      throw new CompulsiveError("INVALID_INPUT", `Configuration contains invalid JSONC: ${path}`);
    }
    const config = validateConfig(parsed, path);
    const baseDirectory = dirname(path);
    return {
      path,
      config: {
        ...(config.rootDir === undefined
          ? {}
          : { rootDir: resolveConfiguredPath(config.rootDir, baseDirectory, homeDirectory) }),
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
    throw new CompulsiveError("INVALID_INPUT", `Unable to load configuration: ${path}`, {
      cause: error,
    });
  }
}
