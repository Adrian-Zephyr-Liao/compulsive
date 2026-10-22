import { afterEach, describe, expect, it, vi } from "vitest";
import { createEditorFunctions } from "../src/devtool/editor-rpc.js";
import { createRepositoryManager } from "../src/manager.js";
import { projectGitDiscardAll } from "../src/project/git-discard.js";
import { projectGitMessage } from "../src/project/git-message.js";

vi.mock("../src/project/git-discard.js", () => ({ projectGitDiscardAll: vi.fn() }));
vi.mock("../src/project/git-message.js", () => ({ projectGitMessage: vi.fn() }));
afterEach(() => vi.clearAllMocks());
describe("editor Git action RPC schemas", () => {
  it.each(["discard-project-git-changes", "generate-project-commit-message"])(
    "validates and dispatches %s with an object",
    async (name) => {
      const manager = createRepositoryManager();
      const rpc = createEditorFunctions(manager).find((definition) => definition.name === name)!;
      for (const invalid of [
        "local:test",
        {},
        { workspaceId: "workspace:test", repositoryId: "local:test", fingerprint: 1 },
      ]) {
        const checked = await rpc.args[0]["~standard"].validate(invalid);
        expect(checked.issues).toBeDefined();
      }
      const input = {
        workspaceId: "workspace:test",
        repositoryId: "local:test",
        fingerprint: "reviewed",
        ...(name.startsWith("discard") ? { confirmed: true, backup: false } : {}),
      };
      const checked = await rpc.args[0]["~standard"].validate(input);
      expect(checked.issues).toBeUndefined();
      if (checked.issues) throw new Error("Expected valid RPC arguments");
      if (name.startsWith("discard")) {
        const { backup: _, ...legacy } = input;
        expect((await rpc.args[0]["~standard"].validate(legacy)).issues).toBeDefined();
        expect(
          (await rpc.args[0]["~standard"].validate({ ...input, backup: "false" })).issues,
        ).toBeDefined();
      }
      const handler = rpc.handler as (input: unknown) => Promise<unknown>;
      await handler(checked.value);
      expect(
        name.startsWith("discard") ? projectGitDiscardAll : projectGitMessage,
      ).toHaveBeenCalledExactlyOnceWith(manager, input);
    },
  );
});
