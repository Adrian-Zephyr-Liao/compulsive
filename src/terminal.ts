import { confirm, isCancel, select, spinner, type SpinnerOptions } from "@clack/prompts";
import pc from "picocolors";

import type { TerminalColorMode } from "./file-config.js";
import type { RepositoryRecord } from "./types.js";

export interface TerminalThemeOptions {
  color: TerminalColorMode;
  unicode: boolean;
  isTTY: boolean;
}

export interface TerminalTheme {
  success(title: string, detail?: string): string;
  warning(message: string): string;
  error(code: string, message: string): string;
  repository(classification: string, path: string): string;
  check(ok: boolean, name: string, detail: string): string;
  transition(source: string, target: string): string;
}

export function createTerminalTheme(options: TerminalThemeOptions): TerminalTheme {
  const colors = pc.createColors(
    options.color === "always" ||
      (options.color === "auto" && options.isTTY && pc.isColorSupported),
  );
  const icons = options.unicode
    ? { success: "◆", item: "◇", warning: "▲", error: "✖", pass: "●", fail: "●" }
    : { success: "OK", item: "-", warning: "!", error: "x", pass: "OK", fail: "x" };

  return {
    success(title, detail) {
      const heading = `${colors.green(icons.success)} ${colors.bold(title)}`;
      return detail === undefined ? heading : `${heading}\n   ${colors.dim(detail)}`;
    },
    warning(message) {
      return `${colors.yellow(icons.warning)} ${colors.yellow(message)}`;
    },
    error(code, message) {
      return `${colors.red(icons.error)} ${colors.red(colors.bold(code))}: ${message}`;
    },
    repository(classification, path) {
      return `${colors.cyan(icons.item)} ${colors.bold(classification)}\n  ${colors.dim(path)}`;
    },
    check(ok, name, detail) {
      const icon = ok ? colors.green(icons.pass) : colors.red(icons.fail);
      return `${icon} ${colors.bold(name)}\n  ${colors.dim(detail)}`;
    },
    transition(source, target) {
      const arrow = options.unicode ? "→" : "->";
      return `${colors.dim(source)}\n${colors.cyan(arrow)} ${colors.bold(target)}`;
    },
  };
}

export async function selectRepository(
  message: string,
  repositories: RepositoryRecord[],
): Promise<RepositoryRecord | undefined> {
  const result = await select({
    message,
    options: repositories.map((repository) => ({
      value: repository,
      label: repository.classificationPath,
      hint: repository.absolutePath,
    })),
    output: process.stderr,
  });
  return isCancel(result) ? undefined : result;
}

export async function confirmAction(message: string): Promise<boolean | undefined> {
  const result = await confirm({ message, initialValue: false, output: process.stderr });
  return isCancel(result) ? undefined : result;
}

export async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  const options: SpinnerOptions = { output: process.stderr };
  const indicator = spinner(options);
  indicator.start(message);
  try {
    const result = await task();
    indicator.stop(message);
    return result;
  } catch (error) {
    indicator.error(message);
    throw error;
  }
}
