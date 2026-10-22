import { useEffect, type RefObject } from "react";
import { App, Button } from "antd";
import { useBlocker } from "react-router";
import { useI18n } from "../../../app/i18n.js";
import type { EditorDocument } from "../types.js";

export function useEditorGuards({
  dirtyCount,
  docsRef,
  save,
  saveAll,
  report,
}: {
  dirtyCount: number;
  docsRef: RefObject<Record<string, EditorDocument>>;
  save: (path: string) => Promise<void>;
  saveAll: () => Promise<void>;
  report: (error: unknown) => void;
}) {
  const { modal } = App.useApp();
  const { t } = useI18n();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirtyCount > 0 && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    const dialog = modal.confirm({
      rootClassName: "cpl-editor-overlay",
      title: t("editor.unsaved"),
      content: t("editor.leaveWarning"),
      okText: t("editor.saveAll"),
      cancelText: t("editor.keepEditing"),
      footer: (_, { OkBtn, CancelBtn }) => (
        <div className="flex justify-end gap-2">
          <Button
            danger
            onClick={() => {
              dialog.destroy();
              blocker.proceed();
            }}
          >
            {t("editor.discardBuffer")}
          </Button>
          <CancelBtn />
          <OkBtn />
        </div>
      ),
      onOk: async () => {
        await saveAll();
        if (Object.values(docsRef.current).some((d) => d.saved !== d.content))
          throw new Error(t("editor.unsaved"));
        blocker.proceed();
      },
      onCancel: () => blocker.reset(),
    });
    return () => dialog.destroy();
  }, [blocker.state]);
  useEffect(() => {
    const before = (event: BeforeUnloadEvent) => {
      if (dirtyCount) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [dirtyCount]);
  async function confirmDiscard(path: string) {
    const doc = docsRef.current[path];
    if (!doc || doc.content === doc.saved) return true;
    return new Promise<boolean>((resolve) => {
      const dialog = modal.confirm({
        title: t("editor.unsaved"),
        content: path,
        okText: t("editor.save"),
        cancelText: t("editor.keepEditing"),
        footer: (_, { OkBtn, CancelBtn }) => (
          <div className="flex justify-end gap-2">
            <Button
              danger
              onClick={() => {
                dialog.destroy();
                resolve(true);
              }}
            >
              {t("editor.discardBuffer")}
            </Button>
            <CancelBtn />
            <OkBtn />
          </div>
        ),
        onOk: async () => {
          try {
            await save(path);
            if (docsRef.current[path]?.content !== docsRef.current[path]?.saved)
              throw new Error(t("editor.unsaved"));
            resolve(true);
          } catch (e) {
            report(e);
            throw e;
          }
        },
        onCancel: () => resolve(false),
      });
    });
  }
  return { confirmDiscard };
}
