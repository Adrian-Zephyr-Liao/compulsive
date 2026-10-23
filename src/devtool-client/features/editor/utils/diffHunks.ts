export interface DiffHunk {
  index: number;
  header: string;
  oldLine: number;
  line: number;
}

// Git hunk indices are mutation targets; CodeMirror chunks are navigation targets only.
export function diffHunks(headers: readonly string[], oldLines: number, lines: number): DiffHunk[] {
  const result: DiffHunk[] = [];
  for (const [index, header] of headers.entries()) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: |$)/.exec(header);
    if (!match) return [];
    const values = [match[1], match[2] ?? "1", match[3], match[4] ?? "1"].map(Number);
    if (values.some((n) => !Number.isSafeInteger(n) || n < 0)) return [];
    const start = values[2]!;
    const count = values[3]!;
    const oldStart = values[0]!;
    const oldCount = values[1]!;
    if (
      oldStart > oldLines ||
      (oldCount > 0 && (oldStart < 1 || oldStart + oldCount - 1 > oldLines))
    )
      return [];
    if (start > lines || (count > 0 && (start < 1 || start + count - 1 > lines))) return [];
    result.push({ index, header, oldLine: Math.max(1, oldStart), line: Math.max(1, start) });
  }
  return result;
}
