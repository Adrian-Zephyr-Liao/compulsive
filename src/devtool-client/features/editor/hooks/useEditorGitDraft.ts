import { useEffect, useRef, useState } from "react";
import { App } from "antd";
import { useI18n } from "../../../app/i18n.js";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type { ProjectGitStatus } from "../../../../project/git.js";
import type { EditorScope } from "../types.js";
import { groupGitChanges } from "../utils/gitChanges.js";

export function useEditorGitDraft(
  getRpc: () => Promise<WorkspaceRpc>,
  scope: EditorScope,
  status: ProjectGitStatus | undefined,
  busy: boolean,
  dirtyPaths: string[],
  report: (error: unknown) => void,
) {
  const { t } = useI18n();
  const { modal } = App.useApp();
  const [message, updateMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const draft = useRef("");
  const request = useRef(0);
  const pending = useRef(false);
  useEffect(
    () => () => {
      request.current++;
    },
    [scope.workspaceId, scope.repositoryId, status?.fingerprint],
  );
  function setMessage(value: string) {
    draft.current = value;
    updateMessage(value);
  }
  async function generateMessage() {
    if (
      busy ||
      pending.current ||
      !status ||
      !groupGitChanges(status)[1].items.length ||
      status.changes.some((change) => change.conflict)
    )
      return;
    if (dirtyPaths.length) {
      report(new Error(t("editor.saveBeforeGit")));
      return;
    }
    pending.current = true;
    setGenerating(true);
    const id = ++request.current;
    const original = draft.current;
    try {
      const confirmed = await new Promise<boolean>((resolve) =>
        modal.confirm({
          centered: true,
          title: t("editor.generateMessage"),
          content: `${t("editor.generateMessageDetail")}${original ? ` ${t("editor.replaceMessage")}` : ""}`,
          okText: t("editor.generateMessage"),
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        }),
      );
      if (!confirmed || id !== request.current) return;
      const result = await (
        await getRpc()
      ).call("generate-project-commit-message", { ...scope, fingerprint: status.fingerprint });
      if (id !== request.current) return;
      if (draft.current !== original || result.fingerprint !== status.fingerprint) {
        report(new Error(t("editor.generatedMessageStale")));
        return;
      }
      setMessage(result.message);
    } catch (error) {
      if (id === request.current) report(error);
    } finally {
      pending.current = false;
      setGenerating(false);
    }
  }
  return { message, setMessage, generating, generateMessage };
}
