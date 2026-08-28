import { describe, expect, it } from "vitest";

import { parseGitRemote } from "../src/git-url.js";

describe("parseGitRemote", () => {
  it.each([
    "https://github.com/vuejs/core.git",
    "ssh://git@github.com/vuejs/core.git",
    "git@github.com:vuejs/core.git",
  ])("normalizes %s to the same safe classification", (remote) => {
    expect(parseGitRemote(remote)).toEqual({
      kind: "remote",
      host: "github.com",
      ownerPath: ["vuejs"],
      name: "core",
      relativePath: "github.com/vuejs/core",
      canonicalRemote: "github.com/vuejs/core",
    });
  });

  it("preserves nested GitLab groups", () => {
    expect(parseGitRemote("git@gitlab.com:group/subgroup/project.git")).toMatchObject({
      ownerPath: ["group", "subgroup"],
      relativePath: "gitlab.com/group/subgroup/project",
    });
  });

  it("strips credentials from canonical data", () => {
    const result = parseGitRemote("https://secret-user:secret-token@github.com/acme/repo.git");

    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.canonicalRemote).toBe("github.com/acme/repo");
  });

  it.each([
    "https://github.com/../repo.git",
    "git@github.com:owner/../../repo.git",
    "not-a-remote",
  ])("rejects unsafe or unsupported remote %s", (remote) => {
    expect(() => parseGitRemote(remote)).toThrowError(
      expect.objectContaining({ code: "INVALID_REMOTE" }),
    );
  });
});
