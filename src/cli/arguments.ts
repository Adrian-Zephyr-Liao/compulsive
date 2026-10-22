import mri from "mri";
import { CompulsiveError, type CompulsiveErrorCode } from "../errors.js";

const booleanFlags = [
  "json",
  "register",
  "dry-run",
  "yes",
  "help",
  "color",
  "all",
  "open",
  "worktree",
  "create-branch",
];

const valueFlags = ["root", "depth", "path", "alias", "branch", "workspace"];

export interface ParsedArguments {
  command: string;
  positionals: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

export function parseArguments(argv: string[]): ParsedArguments {
  const separatorIndex = argv.indexOf("--");
  const options = separatorIndex === -1 ? argv : argv.slice(0, separatorIndex);
  const trailingPositionals = separatorIndex === -1 ? [] : argv.slice(separatorIndex + 1);
  const result = mri(options, {
    alias: {
      ...Object.fromEntries([...booleanFlags, ...valueFlags].map((name) => [name, []])),
      h: "help",
    },
    boolean: [...booleanFlags],
    string: [...valueFlags],
    unknown(flag) {
      throw new CompulsiveError("INVALID_INPUT", `Unknown flag: ${flag}`);
    },
  });

  const positionals = [...result._, ...trailingPositionals];
  const command = result.help ? "help" : (positionals.shift() ?? "");
  const flags = new Set(booleanFlags.filter((name) => result[name] === true && name !== "color"));
  if (result.color === true) flags.add("color");
  if (result.color === false) flags.add("no-color");
  if (result.open === false) flags.add("no-open");
  const values = new Map<string, string>();
  for (const name of valueFlags) {
    const value: unknown = result[name];
    if (value === "") {
      throw new CompulsiveError("INVALID_INPUT", `Flag --${name} requires a value.`);
    }
    if (typeof value === "string") values.set(name, value);
  }
  return { command, positionals, flags, values };
}

export function requireValue(value: string | undefined, label: string): string {
  if (!value) throw new CompulsiveError("INVALID_INPUT", `${label} is required.`);
  return value;
}

export function exitCodeFor(error: CompulsiveError): number {
  const mapping: Partial<Record<CompulsiveErrorCode, number>> = {
    INVALID_INPUT: 2,
    INVALID_REMOTE: 2,
    NOT_INITIALIZED: 2,
    NOT_FOUND: 3,
    AMBIGUOUS_MATCH: 4,
    CONFLICT: 4,
    GIT_FAILED: 5,
    FILESYSTEM_FAILED: 5,
  };
  return mapping[error.code] ?? 5;
}
