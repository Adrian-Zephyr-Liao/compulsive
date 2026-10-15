import { describe, expect, it } from "vitest";

import { translate } from "../src/devtool-client/app/i18n.js";

describe("devtool translations", () => {
  it("translates the same message key into Chinese and English", () => {
    expect(translate("zh-CN", "sidebar.newRequirement")).toBe("新建需求");
    expect(translate("en-US", "sidebar.newRequirement")).toBe("New requirement");
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
