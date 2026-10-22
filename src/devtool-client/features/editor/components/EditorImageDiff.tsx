import { Empty, Image } from "antd";
import { useI18n } from "../../../app/i18n.js";

interface Props {
  path: string;
  original: string;
  content: string;
  images: { original?: string; content?: string };
}

export default function EditorImageDiff({ path, original, content, images }: Props) {
  const { t } = useI18n();
  const sides = [
    { label: t("editor.imageBefore"), image: images.original, text: original },
    { label: t("editor.imageAfter"), image: images.content, text: content },
  ];
  return (
    <div className="h-full min-h-0 overflow-auto p-4">
      <Image.PreviewGroup>
        <div className="flex min-h-full flex-wrap gap-4">
          {sides.map(({ label, image, text }) => (
            <figure
              key={label}
              className="m-0 flex min-h-48 min-w-0 flex-1 basis-64 flex-col overflow-hidden rounded-lg border border-[var(--editor-border)]"
            >
              <figcaption className="border-b border-[var(--editor-border)] bg-[var(--editor-panel)] px-4 py-3 font-medium">
                {label}
              </figcaption>
              <div className="flex min-h-0 flex-1 items-center justify-center p-4">
                {image ? (
                  <Image
                    src={image}
                    alt={`${label} · ${path}`}
                    styles={{
                      root: { maxWidth: "100%" },
                      image: { maxWidth: "100%", maxHeight: "60vh", objectFit: "contain" },
                    }}
                  />
                ) : text ? (
                  <pre className="m-0 max-w-full overflow-auto whitespace-pre-wrap break-words font-mono text-xs">
                    {text}
                  </pre>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={t("editor.imageAbsent")}
                  />
                )}
              </div>
            </figure>
          ))}
        </div>
      </Image.PreviewGroup>
    </div>
  );
}
