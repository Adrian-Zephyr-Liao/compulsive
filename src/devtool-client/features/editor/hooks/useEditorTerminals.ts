import { useCallback, useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useI18n } from "../../../app/i18n.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type { ProjectTerminalInfo } from "../../../../project/terminals.js";
export function useEditorTerminals(
  getRpc: () => Promise<WorkspaceRpc>,
  workspaceId: string,
  repositoryId: string,
  report: (e: unknown) => void,
) {
  const { modal } = App.useApp();
  const { t } = useI18n();
  const [sessions, setSessions] = useState<ProjectTerminalInfo[]>([]);
  const [selected, setSelected] = useState("");
  const owned = useRef(new Set<string>());
  useEffect(() => {
    let active = true;
    void getRpc()
      .then((rpc) => rpc.call("list-project-terminals", { workspaceId, repositoryId }))
      .then((result) => {
        if (active)
          setSessions((current) => [
            ...current,
            ...result.sessions.filter((s) => !current.some((c) => c.id === s.id)),
          ]);
      })
      .catch(report);
    return () => {
      active = false;
    };
  }, [getRpc, workspaceId, repositoryId, report]);
  const close = useCallback(
    async (terminalId: string) => {
      await (
        await getRpc()
      ).call("close-project-terminal", { workspaceId, repositoryId, terminalId });
      owned.current.delete(terminalId);
      setSessions((all) => all.filter((s) => s.id !== terminalId));
    },
    [getRpc, workspaceId, repositoryId],
  );
  const create = (restartId?: string) =>
    modal.confirm({
      title: t("editor.terminalWarning"),
      content: t("editor.terminalDetail"),
      okText: t("editor.startTerminal"),
      onOk: async () => {
        try {
          if (restartId) await close(restartId);
          const session = await (
            await getRpc()
          ).call("create-project-terminal", {
            workspaceId,
            repositoryId,
            cols: 80,
            rows: 24,
            confirmed: true,
          });
          owned.current.add(session.id);
          setSessions((all) => [...all, session]);
          setSelected(session.id);
        } catch (error) {
          report(error);
          throw error;
        }
      },
    });
  const write = useCallback(
    async (terminalId: string, data: string) => {
      await (
        await getRpc()
      ).call("write-project-terminal", { workspaceId, repositoryId, terminalId, data });
    },
    [getRpc, workspaceId, repositoryId],
  );
  const resize = useCallback(
    async (terminalId: string, cols: number, rows: number) => {
      await (
        await getRpc()
      ).call("resize-project-terminal", { workspaceId, repositoryId, terminalId, cols, rows });
    },
    [getRpc, workspaceId, repositoryId],
  );
  const wait = useCallback(
    async (terminalId: string, cursor: number) =>
      (await getRpc()).call("wait-project-terminal", {
        workspaceId,
        repositoryId,
        terminalId,
        cursor,
      }),
    [getRpc, workspaceId, repositoryId],
  );
  useEffect(
    () => () => {
      for (const id of owned.current) void close(id).catch(report);
    },
    [close, report],
  );
  return {
    sessions,
    selected: sessions.some((s) => s.id === selected) ? selected : (sessions[0]?.id ?? ""),
    setSelected,
    create,
    close,
    write,
    resize,
    wait,
  };
}
