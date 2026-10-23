// Isolated manual editor acceptance fixture. Never points at registered user repositories.
import { execFile, spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import { createRepositoryManager } from "../dist/index.mjs";
function previewPng(color) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    const payload = Buffer.concat([Buffer.from(type), data]);
    length.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(payload));
    return Buffer.concat([length, payload, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(160);
  header.writeUInt32BE(96, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: 160 }, () => color).flat()),
  ]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 96 }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const directory = await mkdtemp(join(tmpdir(), "cpl-editor-browser-"));
await mkdir(join(directory, "home"));
const env = {
  ...process.env,
  HOME: join(directory, "home"),
  SHELL: "/bin/sh",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_AUTHOR_NAME: "CPL Test",
  GIT_AUTHOR_EMAIL: "test@example.invalid",
  GIT_COMMITTER_NAME: "CPL Test",
  GIT_COMMITTER_EMAIL: "test@example.invalid",
};
const execute = promisify(execFile);
const git = (cwd, ...args) => execute("git", ["-C", cwd, ...args], { env, timeout: 10000 });
const remote = join(directory, "demo.git"),
  source = join(directory, "Code/demo");
await execute("git", ["init", "--bare", "-b", "main", remote], { env });
await execute("git", ["clone", `file://${remote}`, source], { env });
await mkdir(join(source, "src"));
await writeFile(
  join(source, "src/workspace.ts"),
  `/** Repository members keep their own development context. */\nexport interface Repository {\n  id: string;\n  name: string;\n  branch: string;\n}\n\nexport class Workspace {\n  private members = new Map<string, Repository>();\n\n  add(repository: Repository) {\n    this.members.set(repository.id, repository);\n  }\n\n  find(query: string): Repository[] {\n    return [...this.members.values()].filter(member =>\n      member.name.toLowerCase().includes(query.toLowerCase()),\n    );\n  }\n\n  get size() {\n    return this.members.size;\n  }\n}\n`,
);
await writeFile(
  join(source, "README.md"),
  "# Editor demo\n\nA local requirement with **independent repositories**.\n\n## Quick start\n\n- Open a file with ⌘P\n- Save with ⌘S\n- Split the editor with ⌘\\\n\n```ts\nconst workspace = new Workspace();\n```\n",
);
await writeFile(
  join(source, "package.json"),
  JSON.stringify({ name: "editor-demo", version: "1.0.0", private: true }, null, 2) + "\n",
);
await writeFile(
  join(source, "mark.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="30" fill="#8f79de"/><text x="70" y="128" font-size="88" fill="white">C</text></svg>',
);
await writeFile(join(source, "preview.png"), previewPng([69, 104, 220]));
await writeFile(join(source, "deleted.png"), previewPng([69, 104, 220]));
await git(source, "add", ".");
await git(source, "commit", "-m", "Initialize editor demo");
// Real history, including a merge, for the history browser's isolated acceptance check.
for (const [index, message] of [
  "feat(editor): add repository search",
  "fix(editor): normalize search input",
  "refactor(editor): separate repository matching",
  "test(editor): cover empty search queries",
  "docs(editor): describe repository navigation",
].entries()) {
  await writeFile(join(source, "src/search.ts"), `export const searchVersion = ${index + 1};\n`);
  await git(source, "add", "src/search.ts");
  await git(source, "commit", "-m", message);
}
await git(source, "switch", "-c", "feat/search");
await writeFile(
  join(source, "src/search.ts"),
  "export const searchVersion = 6;\nexport const searchLimit = 100;\n",
);
await git(source, "commit", "-am", "feat(search): bound repository results");
await git(source, "switch", "main");
await git(source, "commit", "--allow-empty", "-m", "chore(editor): prepare search review");
await git(source, "merge", "--no-ff", "feat/search", "-m", "Merge repository search improvements");
await writeFile(
  join(source, "src/search.ts"),
  "export const searchVersion = 7;\nexport const searchLimit = 200;\n\nexport function matchesRepository(name: string, query: string) {\n  const normalized = query.trim().toLowerCase();\n  return name.toLowerCase().includes(normalized);\n}\n",
);
await git(source, "commit", "-am", "feat(editor): improve repository search matching");
await git(source, "push", "-u", "origin", "main");
const manager = createRepositoryManager({
  dataDir: join(directory, "data"),
  defaultRootDir: join(directory, "Code"),
});
await manager.initialize();
const repository = await manager.register({ path: source });
const workspace = await manager.createWorkspace({ name: "editor-demo" });
const updated = await manager.addWorkspaceMember({
  workspaceId: workspace.id,
  repositoryId: repository.id,
  mode: "worktree",
  branch: "feat/editor-demo",
  createBranch: true,
});
const editorRoot = updated.members[0].worktreePath;
const sampleCode = await readFile(join(editorRoot, "src/workspace.ts"), "utf8");
await writeFile(
  join(editorRoot, "src/workspace.ts"),
  sampleCode
    .replace("  branch: string;", "  branch: string;\n  archived?: boolean;")
    .replace(
      "    return [...this.members.values()].filter(member =>\n      member.name.toLowerCase().includes(query.toLowerCase()),",
      "    const normalized = query.trim().toLowerCase();\n    return [...this.members.values()].filter(member =>\n      !member.archived && member.name.toLowerCase().includes(normalized),",
    ),
);
await writeFile(join(editorRoot, "preview.png"), previewPng([119, 78, 220]));
await writeFile(join(editorRoot, "new.png"), previewPng([119, 78, 220]));
await rm(join(editorRoot, "deleted.png"));
await git(editorRoot, "add", "preview.png");
await git(editorRoot, "add", "src/workspace.ts");
await writeFile(
  join(editorRoot, "src/workspace.ts"),
  (await readFile(join(editorRoot, "src/workspace.ts"), "utf8")).replace(
    "return this.members.size;",
    "return [...this.members.values()].filter(member => !member.archived).length;",
  ),
);
const server = spawn(
  process.execPath,
  [fileURLToPath(new URL("../dist/bin.mjs", import.meta.url)), "ui", "--no-open"],
  { env: { ...env, CPL_HOME: join(directory, "data") }, stdio: ["ignore", "pipe", "inherit"] },
);
server.stdout.on("data", (chunk) => {
  const output = String(chunk);
  process.stdout.write(output);
  const origin = output.match(/http:\/\/localhost:\d+/)?.[0];
  if (origin)
    console.log(
      JSON.stringify({
        origin,
        url: `${origin}/#/requirements/${encodeURIComponent(workspace.id)}/code/${encodeURIComponent(repository.id)}?file=src%2Fworkspace.ts`,
        directory,
        root: updated.members[0].worktreePath,
      }),
    );
});
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
