import { Worker } from "node:worker_threads";
import { minimatch } from "minimatch";
import { CompulsiveError } from "../errors.js";
import { indexProjectFiles, assertProjectSearchSize } from "./file-index.js";
import { readProjectFile, projectTextLimit } from "./files.js";
import { resolveProjectPath, type ProjectFileInput } from "./paths.js";
import type { RepositoryManager } from "../types.js";

export interface ProjectSearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
  from: number;
  to: number;
  version: string;
}
export interface ProjectReplacement {
  path: string;
  content: string;
  expectedVersion: string;
  matches: number;
}
export interface ProjectSearchOptions extends Omit<ProjectFileInput, "path"> {
  requestId: string;
  query: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  include: string;
  exclude: string;
  offset: number;
  replacement?: string | undefined;
}
export interface ProjectSearchResult {
  matches: ProjectSearchMatch[];
  replacements: ProjectReplacement[];
  nextOffset: number | null;
  totalFiles: number;
  truncated: boolean;
  skipped: string[];
}
interface SearchDocument {
  path: string;
  content: string;
  version: string;
}

// Self-contained so the same bounded matcher can run in a killable worker after bundling.
export function matchProjectDocuments(input: {
  documents: SearchDocument[];
  query: string;
  regex: boolean;
  matchCase: boolean;
  wholeWord: boolean;
  replacement?: string;
}) {
  let source = input.regex ? input.query : input.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (input.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  const pattern = new RegExp(source, input.matchCase ? "gmu" : "gimu");
  const matches: ProjectSearchMatch[] = [];
  const replacements: ProjectReplacement[] = [];
  let truncated = false;
  for (const document of input.documents) {
    const starts = [0];
    for (let index = 0; index < document.content.length; index++)
      if (document.content[index] === "\n") starts.push(index + 1);
    pattern.lastIndex = 0;
    let found: RegExpExecArray | null;
    let count = 0;
    while ((found = pattern.exec(document.content))) {
      count++;
      if (matches.length >= 2000) {
        truncated = true;
        break;
      }
      let low = 0;
      let high = starts.length - 1;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (starts[middle]! <= found.index) low = middle;
        else high = middle - 1;
      }
      const begin = starts[low]!;
      const end = document.content.indexOf("\n", begin);
      const line = document.content
        .slice(begin, end < 0 ? document.content.length : end)
        .replace(/\r$/, "");
      matches.push({
        path: document.path,
        line: low + 1,
        column: found.index - begin + 1,
        text: line.slice(Math.max(0, found.index - begin - 100), found.index - begin + 200),
        from: found.index,
        to: found.index + found[0].length,
        version: document.version,
      });
      if (!found[0].length)
        pattern.lastIndex +=
          (document.content.codePointAt(pattern.lastIndex) ?? 0) > 0xffff ? 2 : 1;
    }
    if (truncated && input.replacement !== undefined)
      throw new Error("Too many matches to replace safely. Narrow the search first.");
    if (count && input.replacement !== undefined) {
      pattern.lastIndex = 0;
      const content = document.content.replace(pattern, input.replacement);
      if (content.length > 4 * 1024 * 1024)
        throw new Error("A replacement exceeds the text file limit.");
      replacements.push({
        path: document.path,
        content,
        expectedVersion: document.version,
        matches: count,
      });
    }
    if (truncated) break;
  }
  return { matches, replacements, truncated };
}

function patterns(value: string) {
  const result = value
    .split(/,(?![^{}]*\})/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  if (
    result.length > 16 ||
    result.some(
      (pattern) =>
        pattern.length > 256 ||
        (pattern.match(/\{/g)?.length ?? 0) > 1 ||
        (pattern.match(/,/g)?.length ?? 0) > 16,
    )
  )
    throw new CompulsiveError("INVALID_INPUT", "Use up to 16 simple include/exclude patterns.");
  return result;
}
function selected(path: string, include: string[], exclude: string[]) {
  const matches = (pattern: string) =>
    minimatch(path, pattern, { matchBase: !pattern.includes("/"), dot: true }) ||
    minimatch(path, `${pattern}/**`, { dot: true });
  return (!include.length || include.some(matches)) && !exclude.some(matches);
}

export function createProjectSearch(manager: RepositoryManager) {
  const active = new Map<
    string,
    { workspaceId: string; repositoryId: string; cancelled: boolean; worker: Worker | undefined }
  >();
  return {
    cancel(input: Omit<ProjectFileInput, "path"> & { requestId: string }) {
      const job = active.get(input.requestId);
      if (job && job.workspaceId === input.workspaceId && job.repositoryId === input.repositoryId) {
        job.cancelled = true;
        void job.worker?.terminate();
      }
      return { cancelled: true };
    },
    async search(input: ProjectSearchOptions): Promise<ProjectSearchResult> {
      await resolveProjectPath(manager, { ...input, path: "" });
      assertProjectSearchSize(input.query);
      if (
        !/^[\w-]{1,100}$/.test(input.requestId) ||
        !Number.isInteger(input.offset) ||
        input.offset < 0 ||
        input.offset > 20000 ||
        input.include.length > 2000 ||
        input.exclude.length > 2000 ||
        (input.replacement?.length ?? 0) > 10000
      )
        throw new CompulsiveError("INVALID_INPUT", "Invalid search options.");
      if (!input.query)
        return {
          matches: [],
          replacements: [],
          nextOffset: null,
          totalFiles: 0,
          truncated: false,
          skipped: [],
        };
      if (active.has(input.requestId) || active.size >= 4)
        throw new CompulsiveError("CONFLICT", "Wait for or cancel the active search.");
      const job = {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        cancelled: false,
        worker: undefined as Worker | undefined,
      };
      active.set(input.requestId, job);
      try {
        const index = await indexProjectFiles(manager, input);
        const include = patterns(input.include);
        const exclude = patterns(input.exclude);
        const files = index.files.filter((path) => selected(path, include, exclude));
        const documents: SearchDocument[] = [];
        const skipped: string[] = [];
        let offset = input.offset;
        let bytes = 0;
        for (; offset < files.length && offset < input.offset + 100; offset++) {
          if (job.cancelled) throw new CompulsiveError("CONFLICT", "Search cancelled.");
          try {
            const file = await readProjectFile(manager, { ...input, path: files[offset]! });
            if (bytes + file.bytes > 8 * 1024 * 1024) break;
            bytes += file.bytes;
            documents.push({ path: file.path, content: file.content, version: file.version });
          } catch {
            skipped.push(files[offset]!);
          }
        }
        if (job.cancelled) throw new CompulsiveError("CONFLICT", "Search cancelled.");
        const worker = new Worker(
          `const {parentPort,workerData}=require('node:worker_threads'); parentPort.postMessage((${matchProjectDocuments.toString()})(workerData));`,
          { eval: true, workerData: { ...input, documents } },
        );
        job.worker = worker;
        const result = await new Promise<ReturnType<typeof matchProjectDocuments>>(
          (resolve, reject) => {
            const timer = setTimeout(() => {
              void worker.terminate();
              reject(
                new CompulsiveError(
                  "INVALID_INPUT",
                  "Search timed out. Use a simpler pattern or narrower include filter.",
                ),
              );
            }, 2500);
            worker.once("message", (result) => {
              clearTimeout(timer);
              resolve(result);
            });
            worker.once("error", (error) => {
              clearTimeout(timer);
              reject(new CompulsiveError("INVALID_INPUT", error.message));
            });
            worker.once("exit", (code) => {
              clearTimeout(timer);
              if (code !== 0 || job.cancelled)
                reject(new CompulsiveError("CONFLICT", "Search cancelled."));
            });
          },
        );
        for (const replacement of result.replacements)
          if (Buffer.byteLength(replacement.content, "utf8") > projectTextLimit)
            throw new CompulsiveError(
              "INVALID_INPUT",
              "A replacement exceeds the text file limit.",
            );
        return {
          ...result,
          nextOffset: result.truncated ? null : offset < files.length ? offset : null,
          totalFiles: files.length,
          truncated: index.truncated || result.truncated,
          skipped,
        };
      } finally {
        if (active.get(input.requestId) === job) active.delete(input.requestId);
        void job.worker?.terminate();
      }
    },
    dispose() {
      for (const job of active.values()) {
        job.cancelled = true;
        void job.worker?.terminate();
      }
      active.clear();
    },
  };
}
