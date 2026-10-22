import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "vite-plus";

const root = fileURLToPath(new URL("../", import.meta.url));
const browserRoot = "src/devtool-client/";
const adapters = new Set(
  ["bin", "cli", "terminal", "devtool", "codex", "clipboard"].map((name) => `src/${name}.ts`),
);
const isBrowser = (file) => file.startsWith(browserRoot);
const isAdapter = (file) =>
  adapters.has(file) || file.startsWith("src/cli/") || file.startsWith("src/devtool/");
const isPresentation = (name) =>
  /^(?:react(?:-[^/]+)?|antd|@ant-design\/[^/]+|@clack\/[^/]+|picocolors|devframe)(?:\/|$)/.test(
    name,
  );

function dependencies(file, source) {
  const parsed = parseSync(file, source);
  if (parsed.errors.length) throw new Error(`${file}: ${parsed.errors[0].message}`);
  const imports = [];
  function add(node, literal) {
    if (typeof literal?.value !== "string") {
      throw new Error(`${file}: imports must use literal module paths`);
    }
    const line = source.slice(0, node.start).split("\n").length;
    imports.push({ name: literal.value, line });
  }
  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (
      ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration"].includes(node.type)
    ) {
      if (node.importKind === "type" || node.exportKind === "type") return;
      if (node.source) {
        const onlyTypes =
          node.specifiers?.length > 0 &&
          node.specifiers.every(
            (specifier) => (specifier.importKind ?? specifier.exportKind) === "type",
          );
        if (!onlyTypes) add(node, node.source);
        return;
      }
    }
    if (node.type === "TSImportType") return;
    if (node.type === "ImportExpression") add(node, node.source);
    if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require"
    ) {
      add(node, node.arguments[0]);
    }
    if (node.type === "TSImportEqualsDeclaration" && node.importKind !== "type") {
      if (node.moduleReference.type === "TSExternalModuleReference")
        add(node, node.moduleReference.expression);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  }
  walk(parsed.program);
  return imports;
}

function inspect(files) {
  const errors = [];
  const graph = new Map();
  for (const [file, source] of files) {
    const edges = [];
    graph.set(file, edges);
    let imports;
    try {
      imports = dependencies(file, source);
    } catch (error) {
      errors.push(error.message);
      continue;
    }
    for (const { name, line } of imports) {
      const location = `${file}:${line}`;
      const local = name.startsWith(".");
      const target = local
        ? posix.normalize(posix.join(dirname(file), name)).replace(/\.js$/, ".ts")
        : undefined;
      const resolved =
        target && (files.has(target) ? target : files.has(`${target}x`) ? `${target}x` : undefined);
      if (local && /\.[cm]?[jt]sx?$/.test(name) && !resolved) {
        errors.push(`${location}: unresolved local source import ${name}`);
      }
      if (resolved && !name.endsWith(".js")) errors.push(`${location}: use .js source specifiers`);
      if (isBrowser(file)) {
        if (isBuiltin(name) || (local && !isBrowser(target))) {
          errors.push(
            `${location}: browser runtime cannot import server/Node code ${name}; use import type for contracts`,
          );
        }
      } else if (!isAdapter(file) && file !== "src/index.ts") {
        if (
          isPresentation(name) ||
          (resolved && (isAdapter(resolved) || isBrowser(resolved) || resolved === "src/index.ts"))
        ) {
          errors.push(
            `${location}: domain/storage code cannot depend on presentation adapters ${name}`,
          );
        }
      }
      if (resolved) edges.push(resolved);
    }
  }
  const visited = new Set();
  const visiting = new Set();
  const stack = [];
  function visit(file) {
    if (visiting.has(file)) {
      errors.push(
        `Runtime import cycle: ${[...stack.slice(stack.indexOf(file)), file].join(" -> ")}`,
      );
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    stack.push(file);
    for (const target of graph.get(file) ?? []) visit(target);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file);
  return errors;
}

function selfTest() {
  const browser = `${browserRoot}app/test.tsx`;
  const cases = [
    ["Node import", browser, 'import "node:fs";', "browser runtime"],
    ["bare Node import", browser, 'import "fs/promises";', "browser runtime"],
    ["server import", browser, 'import { manager } from "../../manager.js";', "browser runtime"],
    [
      "mixed import",
      browser,
      'import { type Config, manager } from "../../manager.js";',
      "browser runtime",
    ],
    ["re-export", browser, 'export * from "../../manager.js";', "browser runtime"],
    ["dynamic import", browser, 'const load = () => import("node:fs");', "browser runtime"],
    [
      "exported function import",
      browser,
      'export function load() { return import("node:fs"); }',
      "browser runtime",
    ],
    ["require", browser, 'const fs = require("node:fs");', "browser runtime"],
    ["computed import", browser, "const load = (p: string) => import(p);", "literal module"],
    [
      "domain UI import",
      "src/storage.ts",
      'import { Button } from "antd";',
      "presentation adapters",
    ],
    ["domain adapter import", "src/storage.ts", 'import "./devtool.js";', "presentation adapters"],
    [
      "domain CLI adapter import",
      "src/storage.ts",
      'import "./cli/context.js";',
      "presentation adapters",
    ],
    [
      "domain RPC adapter import",
      "src/storage.ts",
      'import "./devtool/state-rpc.js";',
      "presentation adapters",
    ],
    ["missing source", "src/storage.ts", 'import "./missing.js";', "unresolved local"],
    ["source extension", "src/storage.ts", 'import "./manager.ts";', ".js source"],
    ["syntax error", "src/storage.ts", "import {", "src/storage.ts"],
  ];
  for (const [label, file, source, expected] of cases) {
    const files = new Map([
      ["src/manager.ts", ""],
      ["src/devtool.ts", ""],
      ["src/cli/context.ts", ""],
      ["src/devtool/state-rpc.ts", ""],
      [file, source],
    ]);
    assert.ok(
      inspect(files).some((error) => error.includes(expected)),
      label,
    );
    console.log(`self-test: rejected ${label}`);
  }
  const valid = new Map([
    [
      browser,
      'import type { Config } from "../../manager.js"; import { type Config as C } from "../../manager.js"; export type { Config as D } from "../../manager.js"; export { type Config as E } from "../../manager.js"; import "react"; // import "node:fs";\nconst text = "require(\\\"node:fs\\\")";',
    ],
    ["src/manager.ts", 'import type { Config } from "./storage.js";'],
    ["src/storage.ts", 'import type { Config } from "./manager.js";'],
  ]);
  assert.deepEqual(inspect(valid), []);
  assert.ok(
    inspect(
      new Map([
        ["src/a.ts", 'export * from "./b.js";'],
        ["src/b.ts", 'import "./a.js";'],
      ]),
    ).some((error) => error.includes("Runtime import cycle")),
  );
  assert.ok(
    inspect(new Map([["src/a.ts", 'import "./a.js";']])).some((error) =>
      error.includes("Runtime import cycle"),
    ),
  );
  console.log("self-test: accepted type-only edges and rejected runtime cycles");
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = new Map(
    readdirSync(new URL("../src/", import.meta.url), { recursive: true, encoding: "utf8" })
      .filter((file) => /\.tsx?$/.test(file) && !file.endsWith(".d.ts"))
      .map((file) => [`src/${file}`, readFileSync(`${root}src/${file}`, "utf8")]),
  );
  const errors = inspect(files);
  errors.forEach((error) => console.error(error));
  if (errors.length) process.exitCode = 1;
  else console.log(`Architecture: ${files.size} source files checked`);
}
