import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createProjectFixture } from "./helpers/project-fixture.js";
import { projectSession } from "../src/project/session.js";
import { defaultEditorPreferences } from "../src/devtool-client/features/editor/utils/editorState.js";
describe("editor local sessions", () => {
  let f: Awaited<ReturnType<typeof createProjectFixture>>;
  beforeEach(async () => {
    f = await createProjectFixture();
  }, 30000);
  afterEach(async () => {
    await f.dispose();
  }, 20000);
  const session = () => ({
    preferences: { ...defaultEditorPreferences },
    columns: [
      {
        id: "a",
        active: "origin.txt",
        tabs: [{ path: "origin.txt", pinned: true, preview: false, cursor: 2, scroll: 12 }],
      },
    ],
    recent: ["files.save"],
    columnSizes: [500],
  });
  it("persists accepted layout beside CPL config without source content or unknown fields", async () => {
    expect(await projectSession(f.manager, f.input())).toBeNull();
    const saved = await projectSession(f.manager, f.input(), {
      ...session(),
      content: "do-not-persist",
      preferences: { ...defaultEditorPreferences, dark: true, terminalOutput: "do-not-persist" },
    });
    expect(saved).toEqual(session());
    const data = await readFile(join(f.dataDir, "editor-sessions.json"), "utf8");
    expect(data).not.toContain("do-not-persist");
    expect(data).not.toContain('"dark"');
    expect(await projectSession(f.manager, f.input())).toEqual(saved);
  });
  it("rejects malformed preferences, protected files and removed membership without overwriting state", async () => {
    await projectSession(f.manager, f.input(), session());
    await expect(
      projectSession(f.manager, f.input(), {
        ...session(),
        preferences: { ...defaultEditorPreferences, fontSize: 1000 },
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const invalid = session();
    invalid.columns[0]!.tabs[0]!.path = "../outside";
    await expect(projectSession(f.manager, f.input(), invalid)).rejects.toThrow();
    await writeFile(
      join(f.dataDir, "workspaces.json"),
      JSON.stringify({ schemaVersion: 1, workspaces: [] }),
    );
    await expect(projectSession(f.manager, f.input())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("round trips diff tabs and rejects unknown kinds without replacing the previous session", async () => {
    const base = session();
    const tab = base.columns[0]!.tabs[0]!;
    const next = {
      ...base,
      columns: [
        {
          ...base.columns[0]!,
          tabs: [tab, { ...tab, diff: "staged" }, { ...tab, diff: "working" }],
        },
      ],
    };
    expect(await projectSession(f.manager, f.input(), next)).toEqual(next);
    for (const invalid of [
      { ...tab, diff: "history" },
      { ...tab, diff: "staged", preview: true },
    ]) {
      await expect(
        projectSession(f.manager, f.input(), {
          ...next,
          columns: [{ ...next.columns[0]!, tabs: [invalid] }],
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await projectSession(f.manager, f.input())).toEqual(next);
    }
  });
});
