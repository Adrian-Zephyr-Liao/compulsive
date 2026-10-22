import { describe, expect, it } from "vitest";

import { translate } from "../src/devtool-client/app/i18n.js";

describe("devtool translations", () => {
  it("translates the same message key into Chinese and English", () => {
    expect(translate("zh-CN", "sidebar.newRequirement")).toBe("新建需求");
    expect(translate("en-US", "sidebar.newRequirement")).toBe("New requirement");
  });

  it("distinguishes switching a branch from converting a reference to development", () => {
    expect(translate("zh-CN", "action.switchBranch")).toBe("切换分支");
    expect(translate("en-US", "action.switchBranch")).toBe("Switch branch");
    expect(translate("zh-CN", "action.promote")).toBe("转为开发");
    expect(translate("en-US", "action.promote")).toBe("Convert to development");
    expect(translate("zh-CN", "switch.targetBranch")).toBe("目标分支");
    expect(translate("en-US", "switch.targetBranch")).toBe("Target branch");
  });

  it("interpolates named variables", () => {
    expect(translate("zh-CN", "status.behind", { count: 3, branch: "origin/main" })).toBe(
      "↓ 3 落后 origin/main",
    );
    expect(translate("en-US", "status.behind", { count: 3, branch: "origin/main" })).toBe(
      "↓ 3 behind origin/main",
    );
  });
});
