import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const notesDirectory = ".agents/notes";
const scripts = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts;
const load = (file) => {
  const path = join(root, file);
  return existsSync(path) ? (extname(path) === ".md" ? readFileSync(path, "utf8") : "") : undefined;
};

function prose(text) {
  return text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
}

function headingIds(text) {
  const counts = new Map();
  return [...prose(text).matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => {
    const slug = match[1]
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_\s-]/gu, "")
      .trim()
      .replace(/\s/g, "-");
    const count = counts.get(slug) ?? 0;
    counts.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  });
}

function inspect(file, text, read, packageScripts) {
  const errors = [];
  for (const match of prose(text).matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    const url = match[1];
    if (/^(?:[a-z][\w+.-]*:|\/)/i.test(url)) continue;
    try {
      const [path, fragment] = url.split("#");
      const target = path
        ? relative(root, resolve(root, dirname(file), decodeURIComponent(path.split("?")[0])))
        : file;
      const content = read(target);
      if (content === undefined) errors.push(`${file}: missing link target ${url}`);
      else if (
        fragment &&
        extname(target) === ".md" &&
        !headingIds(content).includes(decodeURIComponent(fragment))
      ) {
        errors.push(`${file}: missing heading ${url}`);
      }
    } catch {
      errors.push(`${file}: invalid link ${url}`);
    }
  }
  for (const [, name] of text.matchAll(/\bpnpm run ([\w:-]+)/g)) {
    if (!Object.hasOwn(packageScripts, name))
      errors.push(`${file}: unknown package script ${name}`);
  }
  if (file.startsWith(`${notesDirectory}/`) && file !== `${notesDirectory}/README.md`) {
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$/.test(file.slice(notesDirectory.length + 1))) {
      errors.push(`${file}: use YYYY-MM-DD-short-topic.md`);
    }
    if (
      !/^# Agent Note: \S[^\n]*\n\nStatus: (proposed|implemented|rejected|superseded)\n\n/.test(
        text,
      )
    ) {
      errors.push(`${file}: invalid Agent Note header/status`);
    }
    const body = prose(text);
    if ([...body.matchAll(/^Status:/gm)].length !== 1) errors.push(`${file}: expected one status`);
    for (const title of [
      "Problem",
      "Decision",
      "Alternatives considered",
      "Consequences",
      "Verification",
    ]) {
      if (!body.split("\n").includes(`## ${title}`))
        errors.push(`${file}: missing section ${title}`);
    }
  }
  return errors;
}

function selfTest() {
  const file = `${notesDirectory}/2026-10-21-example.md`;
  const valid =
    "# Agent Note: Example\n\nStatus: proposed\n\n" +
    ["Problem", "Decision", "Alternatives considered", "Consequences", "Verification"]
      .map((title) => `## ${title}\n\nExample.\n`)
      .join("\n");
  const read = (path) =>
    path === "docs/valid.md" ? "# Valid\n\n## Existing heading\n" : undefined;
  assert.deepEqual(inspect(file, valid, read, scripts), []);
  assert.deepEqual(
    inspect("AGENTS.md", "[valid](docs/valid.md#existing-heading)", read, scripts),
    [],
  );
  assert.deepEqual(
    inspect(
      ".agents/skills/cpl-verify/SKILL.md",
      "[workflow](../../../docs/valid.md#existing-heading)",
      read,
      scripts,
    ),
    [],
  );
  for (const [label, source, content, expected] of [
    ["missing file", "AGENTS.md", "[broken](docs/missing.md)", "missing link target"],
    ["missing anchor", "AGENTS.md", "[broken](docs/valid.md#missing)", "missing heading"],
    [
      "broken Skill link",
      ".agents/skills/cpl-verify/SKILL.md",
      "[workflow](../../../docs/missing.md)",
      "missing link target",
    ],
    ["unknown command", "AGENTS.md", "pnpm run missing-script", "unknown package script"],
    [
      "bad note status",
      file,
      valid.replace("Status: proposed", "Status: finished"),
      "header/status",
    ],
    [
      "missing note section",
      file,
      valid.replace("## Verification", "## Other"),
      "missing section Verification",
    ],
    [
      "example is not a section",
      file,
      valid.replace("## Verification", "```md\n## Verification\n```"),
      "missing section Verification",
    ],
  ]) {
    assert.ok(
      inspect(source, content, read, scripts).some((error) => error.includes(expected)),
      label,
    );
    console.log(`self-test: rejected ${label}`);
  }
}

if (process.argv.includes("--self-test")) {
  selfTest();
} else {
  const files = [
    ...new Set([
      "AGENTS.md",
      "README.md",
      "README.zh-CN.md",
      "docs/AGENTS.md",
      "docs/architecture.md",
      "docs/development.md",
      "docs/workspaces-spec.md",
      "docs/workspaces-plan.md",
      "src/devtool-client/AGENTS.md",
      "src/devtool-client/README.md",
      ".agents/skills/antd/SKILL.md",
      ".agents/skills/cpl-code-review/SKILL.md",
      ".agents/skills/cpl-verify/SKILL.md",
      ...readdirSync(join(root, "docs"), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".md"))
        .map((file) => `docs/${file}`),
      ...readdirSync(join(root, notesDirectory))
        .filter((file) => file.endsWith(".md"))
        .map((file) => `${notesDirectory}/${file}`),
    ]),
  ];
  const errors = files.flatMap((file) => {
    const text = load(file);
    return text === undefined
      ? [`${file}: required document missing`]
      : inspect(file, text, load, scripts);
  });
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log(`Agent docs: ${files.length} documents checked`);
}
