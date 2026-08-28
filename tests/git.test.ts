import { describe, expect, it } from "vitest";

import { redactGitError } from "../src/git.js";

describe("redactGitError", () => {
  it("removes URL credentials from Git diagnostics", () => {
    const message =
      "fatal: unable to access 'https://secret-user:secret-token@example.com/acme/repo.git'";

    expect(redactGitError(message)).toBe(
      "fatal: unable to access 'https://[redacted]@example.com/acme/repo.git'",
    );
  });
});
