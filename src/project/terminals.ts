import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { IPty } from "node-pty";
import { CompulsiveError } from "../errors.js";
import { resolveProjectPath, type ProjectFileInput } from "./paths.js";
import type { RepositoryManager } from "../types.js";
import { loadProjectPty } from "./pty.js";

export interface ProjectTerminalScope {
  workspaceId: string;
  repositoryId: string;
  terminalId: string;
}
export interface ProjectTerminalOutput {
  cursor: number;
  data: string;
  truncated: boolean;
  exitCode: number | null;
}
export interface ProjectTerminalInfo {
  id: string;
  title: string;
  cwd: string;
  exitCode: number | null;
}
interface Session extends ProjectTerminalInfo {
  workspaceId: string;
  repositoryId: string;
  pty: IPty;
  sequence: number;
  chunks: { sequence: number; data: string }[];
  characters: number;
  wake: Set<() => void>;
  idle: ReturnType<typeof setTimeout> | undefined;
}

function dimensions(cols: number, rows: number) {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 2 ||
    cols > 500 ||
    rows < 1 ||
    rows > 300
  )
    throw new CompulsiveError(
      "INVALID_INPUT",
      "Terminal dimensions must be between 2×1 and 500×300.",
    );
}

export function createProjectTerminals(manager: RepositoryManager) {
  const sessions = new Map<string, Session>();
  let exitAttached = false;
  function closeSession(session: Session) {
    clearTimeout(session.idle);
    sessions.delete(session.id);
    if (session.exitCode === null) {
      try {
        session.pty.kill();
      } catch {
        /* The shell may have exited first. */
      }
    }
    session.exitCode ??= -1;
    for (const wake of session.wake) wake();
    if (!sessions.size && exitAttached) {
      process.off("exit", dispose);
      exitAttached = false;
    }
  }
  function touch(session: Session) {
    clearTimeout(session.idle);
    session.idle = setTimeout(() => closeSession(session), 20 * 60 * 1000);
    session.idle.unref();
  }
  function dispose() {
    for (const session of sessions.values()) closeSession(session);
  }
  async function lookup(input: ProjectTerminalScope) {
    const session = sessions.get(input.terminalId);
    if (
      !session ||
      session.workspaceId !== input.workspaceId ||
      session.repositoryId !== input.repositoryId
    )
      throw new CompulsiveError("NOT_FOUND", "This terminal session is not available.");
    try {
      const { root } = await resolveProjectPath(manager, { ...input, path: "" });
      if (root !== session.cwd)
        throw new CompulsiveError(
          "CONFLICT",
          "The terminal's repository changed. Start a new terminal.",
        );
    } catch (error) {
      closeSession(session);
      throw error;
    }
    touch(session);
    return session;
  }
  function information(session: Session): ProjectTerminalInfo {
    return { id: session.id, title: session.title, cwd: session.cwd, exitCode: session.exitCode };
  }

  return {
    dispose,
    async create(
      input: Omit<ProjectFileInput, "path"> & { cols: number; rows: number; confirmed: boolean },
    ): Promise<ProjectTerminalInfo> {
      if (!input.confirmed)
        throw new CompulsiveError(
          "INVALID_INPUT",
          "Confirm that the terminal runs with your local user permissions; it is not a sandbox.",
        );
      dimensions(input.cols, input.rows);
      if (sessions.size >= 6)
        throw new CompulsiveError(
          "CONFLICT",
          "Close an existing terminal before starting another (maximum six).",
        );
      const { root } = await resolveProjectPath(manager, { ...input, path: "" });
      const shell =
        process.env.SHELL && /^(zsh|bash|sh|fish)$/.test(basename(process.env.SHELL))
          ? process.env.SHELL
          : "/bin/sh";
      const environment: Record<string, string> = {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        TERM_PROGRAM: "Compulsive",
      };
      for (const key of [
        "HOME",
        "USER",
        "LOGNAME",
        "PATH",
        "SHELL",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TMPDIR",
        "SSH_AUTH_SOCK",
        "EDITOR",
        "VISUAL",
      ])
        if (process.env[key]) environment[key] = process.env[key]!;
      const { spawn } = await loadProjectPty();
      // Recheck after loading the native module; concurrent requests must share the limit.
      if (sessions.size >= 6)
        throw new CompulsiveError("CONFLICT", "The terminal session limit has been reached.");
      const pty = spawn(shell, ["-l"], {
        name: "xterm-256color",
        cwd: root,
        cols: input.cols,
        rows: input.rows,
        env: environment,
      });
      const session: Session = {
        id: randomUUID(),
        title: basename(shell),
        cwd: root,
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        pty,
        exitCode: null,
        sequence: 0,
        chunks: [],
        characters: 0,
        wake: new Set(),
        idle: undefined,
      };
      sessions.set(session.id, session);
      if (!exitAttached) {
        process.once("exit", dispose);
        exitAttached = true;
      }
      touch(session);
      pty.onData((data) => {
        for (let offset = 0; offset < data.length; offset += 16384) {
          const piece = data.slice(offset, offset + 16384);
          session.chunks.push({ sequence: ++session.sequence, data: piece });
          session.characters += piece.length;
          while (session.characters > 512 * 1024 && session.chunks.length > 1)
            session.characters -= session.chunks.shift()!.data.length;
        }
        for (const wake of session.wake) wake();
      });
      pty.onExit(({ exitCode }) => {
        session.exitCode = exitCode;
        for (const wake of session.wake) wake();
      });
      return information(session);
    },
    async list(input: Omit<ProjectFileInput, "path">) {
      await resolveProjectPath(manager, { ...input, path: "" });
      return {
        sessions: [...sessions.values()]
          .filter(
            (session) =>
              session.workspaceId === input.workspaceId &&
              session.repositoryId === input.repositoryId,
          )
          .map(information),
      };
    },
    async write(input: ProjectTerminalScope & { data: string }) {
      if (input.data.length > 65536)
        throw new CompulsiveError("INVALID_INPUT", "Terminal input exceeds the 64 KiB limit.");
      const session = await lookup(input);
      if (session.exitCode !== null)
        throw new CompulsiveError("CONFLICT", "This shell has exited.");
      session.pty.write(input.data);
      return { accepted: true };
    },
    async resize(input: ProjectTerminalScope & { cols: number; rows: number }) {
      dimensions(input.cols, input.rows);
      const session = await lookup(input);
      if (session.exitCode === null) session.pty.resize(input.cols, input.rows);
      return { resized: true };
    },
    async close(input: ProjectTerminalScope) {
      const session = sessions.get(input.terminalId);
      if (
        session &&
        session.workspaceId === input.workspaceId &&
        session.repositoryId === input.repositoryId
      )
        closeSession(session);
      return { closed: true };
    },
    async wait(
      input: ProjectTerminalScope & { cursor: number; waitMs?: number },
    ): Promise<ProjectTerminalOutput> {
      if (!Number.isInteger(input.cursor) || input.cursor < 0)
        throw new CompulsiveError("INVALID_INPUT", "Invalid terminal cursor.");
      const session = await lookup(input);
      if (input.cursor > session.sequence)
        throw new CompulsiveError("INVALID_INPUT", "Terminal cursor is ahead of the session.");
      if (input.cursor === session.sequence && session.exitCode === null) {
        if (session.wake.size >= 4)
          throw new CompulsiveError("CONFLICT", "Too many terminal readers.");
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            session.wake.delete(done);
            resolve();
          };
          const timer = setTimeout(done, Math.max(0, Math.min(input.waitMs ?? 25000, 25000)));
          session.wake.add(done);
        });
      }
      return {
        cursor: session.sequence,
        data: session.chunks
          .filter((chunk) => chunk.sequence > input.cursor)
          .map((chunk) => chunk.data)
          .join(""),
        truncated: input.cursor < (session.chunks[0]?.sequence ?? 1) - 1,
        exitCode: session.exitCode,
      };
    },
  };
}
