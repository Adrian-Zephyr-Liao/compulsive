import { describe, expect, it } from "vitest";
import { gitGraph } from "../src/devtool-client/features/editor/utils/gitGraph.js";
describe("commit graph", () => {
  it("joins real parent IDs instead of drawing an unrelated decorative line", () => {
    const rows = gitGraph([
      { id: "merge", parents: ["left", "right"] },
      { id: "left", parents: ["root"] },
      { id: "right", parents: ["root"] },
      { id: "root", parents: [] },
    ]);
    expect(rows[0]?.edges).toEqual([
      { from: 0, to: 0, parent: true },
      { from: 0, to: 1, parent: true },
    ]);
    expect(rows[1]?.incoming).toBe(true);
    expect(rows[2]?.column).toBe(1);
    expect(rows[2]?.edges).toContainEqual({ from: 1, to: 0, parent: true });
    expect(rows[3]?.edges).toEqual([]);
  });
});
