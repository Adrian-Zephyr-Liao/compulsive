import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ execute: vi.fn(), access: vi.fn(), stat: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.execute }));
vi.mock("node:fs/promises", () => ({ access: mocks.access, lstat: mocks.stat }));
import { moveProjectItemToTrash } from "../src/project/trash.js";
describe("literal native Trash adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.access.mockResolvedValue(undefined);
    mocks.stat.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
    mocks.execute.mockImplementation((_command, _args, _options, callback) =>
      callback(null, "", ""),
    );
  });
  it("rejects relative and NUL paths before invoking any native command", async () => {
    for (const path of ["../outside", "relative.txt", "/tmp/bad\0name"])
      await expect(moveProjectItemToTrash(path)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform !== "darwin")(
    "passes one absolute path literally, including glob characters, and stops on native failure",
    async () => {
      const path = "/tmp/cpl-test/literal[1]*?.txt";
      await moveProjectItemToTrash(path);
      expect(mocks.execute.mock.calls[0]?.slice(0, 2)).toEqual(["/usr/bin/trash", ["-s", path]]);
      mocks.access.mockRejectedValue(new Error("missing command"));
      await expect(moveProjectItemToTrash(path)).rejects.toThrow("nothing was deleted");
      expect(mocks.execute).toHaveBeenCalledTimes(1);
    },
  );
  it.skipIf(process.platform !== "darwin")(
    "does not report success if the confirmed item is still on disk",
    async () => {
      mocks.stat.mockResolvedValue({});
      await expect(moveProjectItemToTrash("/tmp/cpl-test/retained.txt")).rejects.toThrow(
        "still present",
      );
    },
  );
});
