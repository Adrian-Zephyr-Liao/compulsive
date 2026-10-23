import { describe, expect, it } from "vitest";
import { diffHunks } from "../src/devtool-client/features/editor/utils/diffHunks.js";

describe("Git hunk anchors", () => {
  it("keeps Git indices even when one hunk contains multiple display changes", () => {
    const headers = ["@@ -1,12 +1,13 @@", "@@ -40,7 +41,8 @@ function second()"];
    expect(diffHunks(headers, 60, 60)).toEqual([
      { index: 0, header: headers[0], oldLine: 1, line: 1 },
      { index: 1, header: headers[1], oldLine: 40, line: 41 },
    ]);
  });
  it("supports single-line, pure addition and whole-file deletion ranges", () => {
    expect(diffHunks(["@@ -1 +1 @@"], 1, 1)[0]?.line).toBe(1);
    expect(diffHunks(["@@ -0,0 +1,2 @@"], 1, 3)[0]?.line).toBe(1);
    expect(diffHunks(["@@ -1,5 +0,0 @@"], 5, 1)[0]?.line).toBe(1);
  });
  it.each([
    "@@ broken",
    "@@ -900 +1 @@",
    "@@ -1 +900 @@",
    "@@ -1 +0,2 @@",
    "@@ -1 +99999999999999999999 @@",
  ])("disables actions rather than guessing an invalid anchor: %s", (header) => {
    expect(diffHunks(["@@ -1 +1 @@", header], 20, 20)).toEqual([]);
  });
});
