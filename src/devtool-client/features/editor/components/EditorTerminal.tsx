import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { theme } from "antd";
import { useI18n } from "../../../app/i18n.js";
import type { ProjectTerminalOutput } from "../../../../project/terminals.js";
interface Props {
  id: string;
  active: boolean;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  wait: (id: string, cursor: number) => Promise<ProjectTerminalOutput>;
  report: (e: unknown) => void;
}
export default function EditorTerminal(props: Props) {
  const host = useRef<HTMLDivElement>(null);
  const { t } = useI18n();
  const { token } = theme.useToken();
  const latest = useRef(props);
  latest.current = props;
  const terminal = useRef<Terminal>(undefined);
  const fitter = useRef<FitAddon>(undefined);
  useEffect(() => {
    if (!host.current) return;
    let active = true;
    const term = new Terminal({
      fontFamily: '"SFMono-Regular",Consolas,monospace',
      fontSize: 13,
      scrollback: 3000,
      allowProposedApi: false,
      screenReaderMode: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    terminal.current = term;
    fitter.current = fit;
    const resize = () => {
      if (host.current?.clientWidth && host.current.clientHeight) {
        fit.fit();
        void latest.current
          .resize(props.id, Math.min(term.cols, 500), Math.min(term.rows, 300))
          .catch(props.report);
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    let writes = Promise.resolve();
    const input = term.onData((data) => {
      writes = writes.then(() => latest.current.write(props.id, data)).catch(props.report);
    });
    const output = async () => {
      let cursor = 0;
      while (active) {
        try {
          const next = await latest.current.wait(props.id, cursor);
          if (!active) return;
          cursor = next.cursor;
          if (next.truncated) term.writeln(`\r\n[${t("editor.terminalTruncated")}]`);
          await new Promise<void>((resolve) => term.write(next.data, resolve));
          if (next.exitCode !== null) {
            term.writeln(`\r\n[${t("editor.terminalExited", { code: next.exitCode })}]`);
            return;
          }
        } catch (e) {
          if (active) props.report(e);
          return;
        }
      }
    };
    void output();
    return () => {
      active = false;
      observer.disconnect();
      input.dispose();
      term.dispose();
      terminal.current = undefined;
    };
  }, [props.id, props.report, t]);
  useEffect(() => {
    if (terminal.current)
      terminal.current.options.theme = {
        background: token.colorBgContainer,
        foreground: token.colorText,
        cursor: token.colorPrimaryText,
      };
  }, [token.colorBgContainer, token.colorText, token.colorPrimaryText, t]);
  useEffect(() => {
    if (props.active) {
      requestAnimationFrame(() => {
        fitter.current?.fit();
        terminal.current?.focus();
      });
    }
  }, [props.active]);
  return (
    <div
      ref={host}
      className={`h-full min-h-0 p-2 ${props.active ? "" : "hidden"}`}
      aria-label={t("editor.terminal")}
    />
  );
}
