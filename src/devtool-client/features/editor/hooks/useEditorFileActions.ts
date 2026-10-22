import { useState } from "react";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type { FileAction, EditorDocument, EditorScope } from "../types.js";
import { useI18n } from "../../../app/i18n.js";
export function useEditorFileActions(
  getRpc: () => Promise<WorkspaceRpc>,
  scope: EditorScope,
  documents: Record<string, EditorDocument>,
  refresh: () => void,
  report: (e: unknown) => void,
) {
  const { t } = useI18n();
  const [dialog, setDialog] = useState<{ action: FileAction; path: string; identity: string }>();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  async function action(action: FileAction, path: string) {
    try {
      const rpc = await getRpc();
      if (action === "reveal") {
        await rpc.call("reveal-project-item", { ...scope, path });
        return;
      }
      if (
        (action === "rename" || action === "trash") &&
        Object.keys(documents).some((p) => p === path || p.startsWith(`${path}/`))
      )
        throw new Error(t("editor.closeBeforeMutation"));
      const item =
        action === "rename" || action === "trash"
          ? await rpc.call("inspect-project-item", { ...scope, path })
          : undefined;
      setValue(
        action === "rename"
          ? path
          : action === "trash"
            ? ""
            : path
              ? `${path.slice(0, path.lastIndexOf("/") + 1)}`
              : "",
      );
      setDialog({ action, path, identity: item?.identity ?? "" });
    } catch (e) {
      report(e);
    }
  }
  async function submit() {
    if (!dialog) return;
    setBusy(true);
    try {
      const rpc = await getRpc();
      if (dialog.action === "newFile" || dialog.action === "newFolder")
        await rpc.call("create-project-item", {
          ...scope,
          path: value.trim(),
          directory: dialog.action === "newFolder",
        });
      if (dialog.action === "rename")
        await rpc.call("rename-project-item", {
          ...scope,
          path: dialog.path,
          destination: value.trim(),
          expectedIdentity: dialog.identity,
        });
      if (dialog.action === "trash")
        await rpc.call("trash-project-item", {
          ...scope,
          path: dialog.path,
          confirmedPath: value,
          expectedIdentity: dialog.identity,
        });
      setDialog(undefined);
      refresh();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  return { dialog, value, setValue, busy, action, submit, cancel: () => setDialog(undefined) };
}
