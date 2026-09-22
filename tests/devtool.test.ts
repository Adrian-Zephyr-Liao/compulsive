import { describe, expect, it } from "vitest";

import { createServerFunctions } from "../src/devtool.js";
import { createRepositoryManager } from "../src/manager.js";

describe("devtool rpc", () => {
  it("exposes workspace actions", () => {
    const names = createServerFunctions(createRepositoryManager()).map(({ name }) => name);

    expect(names).toContain("clone-workspace");
    expect(names).toContain("open-workspace-in-chatgpt");
    expect(names).toContain("promote-workspace-reference");
    expect(names).toContain("convert-workspace-to-reference");
    expect(names).toContain("rebase-workspace-member");
    expect(names).toContain("push-workspace-member");
    expect(names).toContain("get-workspace-status");
    expect(names).toContain("open-workspace-member-in-vscode");
  });
});
