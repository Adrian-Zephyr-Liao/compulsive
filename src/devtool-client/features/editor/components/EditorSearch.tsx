import { Button, Checkbox, Input, Modal } from "antd";
import { SearchOutlined, StopOutlined } from "@ant-design/icons";
import { useI18n } from "../../../app/i18n.js";
import type { useEditorSearch } from "../hooks/useEditorSearch.js";
import type { ProjectSearchMatch } from "../../../../project/search.js";
interface Props {
  search: ReturnType<typeof useEditorSearch>;
  open: (path: string, line: number, column: number) => void;
  report: (e: unknown) => void;
}
export default function EditorSearch({ search: s, open, report }: Props) {
  const { t } = useI18n();
  const groups: Record<string, ProjectSearchMatch[]> = {};
  for (const match of s.result?.matches ?? []) (groups[match.path] ??= []).push(match);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-2 border-b border-[var(--editor-border)] p-3">
        <Input
          aria-label={t("editor.findPlaceholder")}
          placeholder={t("editor.findPlaceholder")}
          value={s.query}
          onChange={(e) => s.setQuery(e.target.value)}
          onPressEnter={() => void s.run().catch(report)}
          suffix={
            s.busy ? (
              <Button
                type="text"
                size="small"
                icon={<StopOutlined />}
                onClick={() => void s.cancel().catch(report)}
                aria-label={t("editor.cancel")}
              />
            ) : (
              <Button
                type="text"
                size="small"
                icon={<SearchOutlined />}
                onClick={() => void s.run().catch(report)}
                aria-label={t("editor.runSearch")}
              />
            )
          }
        />
        <Input
          aria-label={t("editor.replacePlaceholder")}
          placeholder={t("editor.replacePlaceholder")}
          value={s.replacement}
          onChange={(e) => s.setReplacement(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Checkbox checked={s.matchCase} onChange={(e) => s.setMatchCase(e.target.checked)}>
            {t("editor.matchCase")}
          </Checkbox>
          <Checkbox checked={s.wholeWord} onChange={(e) => s.setWholeWord(e.target.checked)}>
            {t("editor.wholeWord")}
          </Checkbox>
          <Checkbox checked={s.regex} onChange={(e) => s.setRegex(e.target.checked)}>
            .*
          </Checkbox>
        </div>
        <Input
          value={s.include}
          onChange={(e) => s.setInclude(e.target.value)}
          placeholder={t("editor.include")}
          aria-label={t("editor.include")}
        />
        <Input
          value={s.exclude}
          onChange={(e) => s.setExclude(e.target.value)}
          placeholder={t("editor.exclude")}
          aria-label={t("editor.exclude")}
        />
        <Button disabled={!s.query || s.busy} onClick={() => void s.run(true).catch(report)}>
          {t("editor.replacePreview")}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {s.result && (
          <div className="px-3 py-2 text-xs text-[var(--editor-muted)]">
            {t("editor.searchCount", {
              count: s.result.matches.length,
              files: s.result.totalFiles,
            })}
            {s.result.truncated && <p>{t("editor.searchLimited")}</p>}
            {s.result.skipped.length > 0 && (
              <p>{t("editor.searchSkipped", { count: s.result.skipped.length })}</p>
            )}
          </div>
        )}
        {Object.entries(groups).map(([path, matches]) => (
          <details key={path} open>
            <summary className="cursor-pointer truncate px-3 py-1 text-xs font-medium" title={path}>
              {path} <span className="text-[var(--editor-muted)]">{matches?.length}</span>
            </summary>
            {matches?.map((match, index) => (
              <button
                key={`${match.from}:${index}`}
                className="editor-result w-full truncate px-5 py-1 text-left font-mono text-xs"
                title={match.text}
                onClick={() => open(path, match.line, match.column)}
              >
                <span className="mr-2 text-[var(--editor-muted)]">{match.line}</span>
                {match.text}
              </button>
            ))}
          </details>
        ))}
        {s.result?.nextOffset !== null && s.result?.nextOffset !== undefined && (
          <Button
            className="!m-3"
            loading={s.busy}
            onClick={() => void s.run(false, true).catch(report)}
          >
            {t("editor.moreResults")}
          </Button>
        )}
      </div>
      <Modal
        open={s.preview}
        title={t("editor.replacePreview")}
        onCancel={() => s.setPreview(false)}
        onOk={() => void s.apply()}
        confirmLoading={s.busy}
        okText={t("editor.applyReplace")}
        width={800}
      >
        <p className="mb-4">{t("editor.replaceWarning")}</p>
        <div className="max-h-[60vh] overflow-auto">
          {s.result?.replacements.map((item) => (
            <details key={item.path}>
              <summary className="cursor-pointer py-2">
                {item.path} · {item.matches}
              </summary>
              <pre className="overflow-auto rounded border border-[var(--editor-border)] p-3 text-xs">
                {item.content}
              </pre>
            </details>
          ))}
        </div>
      </Modal>
    </div>
  );
}
