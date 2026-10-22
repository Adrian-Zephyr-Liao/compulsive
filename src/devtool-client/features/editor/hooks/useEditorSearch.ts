import type { EditorScope } from "../types.js";
import { useEffect, useRef, useState } from "react";
import type { WorkspaceRpc } from "../../workspaces/types.js";
import type { ProjectSearchResult } from "../../../../project/search.js";
import { useI18n } from "../../../app/i18n.js";
export function useEditorSearch(
  getRpc: () => Promise<WorkspaceRpc>,
  scope: EditorScope,
  dirtyPaths: string[],
  report: (e: unknown) => void,
  onSaved: () => void,
) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [regex, setRegex] = useState(false);
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [result, setResult] = useState<ProjectSearchResult>();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const current = useRef("");
  const generation = useRef(0);
  const alive = useRef(true);
  async function cancel() {
    generation.current++;
    const id = current.current;
    current.current = "";
    setBusy(false);
    if (id) await (await getRpc()).call("cancel-project-search", { ...scope, requestId: id });
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void cancel().catch(() => {});
    };
  }, []);
  async function run(replace = false, more = false) {
    await cancel();
    const serial = generation.current;
    const requestId = crypto.randomUUID();
    current.current = requestId;
    setBusy(true);
    setPreview(false);
    try {
      const rpc = await getRpc();
      const next = await rpc.call("search-project-files", {
        ...scope,
        requestId,
        query,
        regex,
        matchCase,
        wholeWord,
        include,
        exclude,
        offset: more ? (result?.nextOffset ?? 0) : 0,
        ...(replace ? { replacement } : {}),
      });
      if (alive.current && generation.current === serial) {
        setResult((old) =>
          more && old
            ? { ...next, matches: [...old.matches, ...next.matches].slice(0, 4000) }
            : next,
        );
        setPreview(replace);
      }
    } catch (e) {
      if (alive.current && generation.current === serial) report(e);
    } finally {
      if (alive.current && generation.current === serial) setBusy(false);
    }
  }
  async function apply() {
    if (!result) return;
    setBusy(true);
    try {
      const rpc = await getRpc();
      if (result.replacements.some((item) => dirtyPaths.includes(item.path)))
        throw new Error(t("editor.replaceDirty"));
      for (const file of result.replacements) {
        try {
          await rpc.call("save-project-file", {
            ...scope,
            path: file.path,
            content: file.content,
            expectedVersion: file.expectedVersion,
          });
        } catch (e) {
          throw new Error(`${file.path}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      setPreview(false);
      onSaved();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  return {
    query,
    setQuery,
    replacement,
    setReplacement,
    include,
    setInclude,
    exclude,
    setExclude,
    regex,
    setRegex,
    matchCase,
    setMatchCase,
    wholeWord,
    setWholeWord,
    result,
    busy,
    preview,
    setPreview,
    run,
    cancel,
    apply,
  };
}
