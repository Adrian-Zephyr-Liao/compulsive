import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProjectFixture } from "./helpers/project-fixture.js";
import { createProjectTerminals } from "../src/project/terminals.js";

describe("local editor PTYs", () => {
  let fixture: Awaited<ReturnType<typeof createProjectFixture>>;
  let terminals: ReturnType<typeof createProjectTerminals>;
  beforeEach(async () => {
    fixture = await createProjectFixture();
    vi.stubEnv("HOME", fixture.sandbox);
    vi.stubEnv("SHELL", "/bin/sh");
    vi.stubEnv("CPL_EDITOR_PRIVATE_TEST", "must-not-inherit");
    terminals = createProjectTerminals(fixture.manager);
  }, 30000);
  afterEach(async () => {
    terminals.dispose();
    vi.unstubAllEnvs();
    await fixture.dispose();
  }, 20000);

  it("requires confirmation, starts in the member worktree and streams interactive output without inheriting agent secrets", async () => {
    const project = fixture.input();
    await expect(
      terminals.create({ ...project, cols: 80, rows: 24, confirmed: false }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const session = await terminals.create({ ...project, cols: 80, rows: 24, confirmed: true });
    expect(session.cwd).toBe(fixture.root);
    const scope = { ...project, terminalId: session.id };
    await terminals.write({
      ...scope,
      data: 'printf \'__CPL_CWD__%s__SECRET__%s__DONE__\\n\' "$PWD" "${CPL_EDITOR_PRIVATE_TEST-unset}"\r',
    });
    let cursor = 0;
    let output = "";
    const deadline = Date.now() + 5000;
    while (
      !output.includes(`__CPL_CWD__${fixture.root}__SECRET__unset__DONE__`) &&
      Date.now() < deadline
    ) {
      const next = await terminals.wait({ ...scope, cursor, waitMs: 250 });
      output += next.data;
      cursor = next.cursor;
    }
    expect(output).toContain(`__CPL_CWD__${fixture.root}__SECRET__unset__DONE__`);
    await terminals.resize({ ...scope, cols: 100, rows: 40 });
    expect((await terminals.list(project)).sessions).toHaveLength(1);
    await terminals.close(scope);
    expect((await terminals.list(project)).sessions).toEqual([]);
    await expect(terminals.write({ ...scope, data: "unsafe" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  }, 20000);

  it("bounds dimensions, input, cursors and session count; dispose tears down sessions", async () => {
    const project = fixture.input();
    await expect(
      terminals.create({ ...project, cols: 0, rows: 24, confirmed: true }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const sessions = [];
    for (let index = 0; index < 6; index++)
      sessions.push(await terminals.create({ ...project, cols: 80, rows: 24, confirmed: true }));
    await expect(
      terminals.create({ ...project, cols: 80, rows: 24, confirmed: true }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const scope = { ...project, terminalId: sessions[0]!.id };
    await expect(terminals.write({ ...scope, data: "x".repeat(65537) })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(terminals.wait({ ...scope, cursor: -1 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(terminals.wait({ ...scope, cursor: 999999 })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    terminals.dispose();
    expect((await terminals.list(project)).sessions).toEqual([]);
  }, 20000);
  it("delivers Ctrl+C to the foreground process and remains interactive", async () => {
    const session = await terminals.create({
      ...fixture.input(),
      cols: 80,
      rows: 24,
      confirmed: true,
    });
    const scope = { ...fixture.input(), terminalId: session.id };
    let cursor = 0;
    let output = "";
    const until = async (token: string) => {
      const end = Date.now() + 3000;
      while (!output.includes(token) && Date.now() < end) {
        const next = await terminals.wait({ ...scope, cursor, waitMs: 100 });
        cursor = next.cursor;
        output += next.data;
      }
      expect(output).toContain(token);
    };
    await terminals.write({
      ...scope,
      data: "printf 'CPL_%s\\n' READY; sleep 30\r",
    });
    await until("CPL_READY");
    await terminals.write({ ...scope, data: "\u0003" });
    await terminals.write({ ...scope, data: "printf 'AFTER_%s\\n' interrupt\r" });
    await until("AFTER_interrupt");
    expect(output).toContain("^C");
  }, 10000);

  it("terminates an old terminal when its member is removed", async () => {
    const project = fixture.input();
    const session = await terminals.create({ ...project, cols: 80, rows: 24, confirmed: true });
    vi.spyOn(fixture.manager, "searchWorkspaces").mockResolvedValue([]);
    await expect(
      terminals.wait({ ...project, terminalId: session.id, cursor: 0 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      terminals.write({ ...project, terminalId: session.id, data: "pwd\r" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }, 20000);
});
