import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../../../app/i18n.js";
export default function EditorPreview({
  path,
  content,
  asset,
}: {
  path: string;
  content: string;
  asset?: string | undefined;
}) {
  const { t } = useI18n();
  if (asset)
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-8">
        <img src={asset} alt={path} className="max-h-full max-w-full object-contain" />
      </div>
    );
  if (/\.svg$/i.test(path))
    return (
      <div className="flex h-full items-center justify-center overflow-auto p-8">
        <img
          alt={path}
          className="max-h-full max-w-full"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`}
        />
      </div>
    );
  return (
    <article className="editor-markdown h-full overflow-auto p-8">
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: ({ alt }) => (
            <span className="text-[var(--editor-muted)]">[{alt || t("editor.assetPreview")}]</span>
          ),
          a: ({ href, children }) => (
            <a
              href={href?.startsWith("https://") || href?.startsWith("http://") ? href : undefined}
              target="_blank"
              rel="noreferrer noopener"
            >
              {children}
            </a>
          ),
        }}
      >
        {content}
      </Markdown>
    </article>
  );
}
