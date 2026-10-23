import {
  ApiOutlined,
  BranchesOutlined,
  CodeOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileMarkdownOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileZipOutlined,
  FolderFilled,
  FolderOpenFilled,
  Html5Outlined,
  SettingOutlined,
} from "@ant-design/icons";

const fileIcons: Array<[RegExp, typeof CodeOutlined, string]> = [
  [/^\.git/, BranchesOutlined, "error-text"],
  [
    /^(?:package(?:-lock)?\.json|[\w.-]*config\.[\w]+|pnpm-lock\.yaml|yarn\.lock)$/,
    SettingOutlined,
    "text-secondary",
  ],
  [/\.mdx?$/, FileMarkdownOutlined, "info-text"],
  [/\.(?:png|jpe?g|gif|webp|svg|ico|avif|bmp)$/, FileImageOutlined, "success-text"],
  [/\.(?:tsx|jsx|vue|svelte)$/, ApiOutlined, "primary-text"],
  [/\.(?:[cm]?js|py)$/, CodeOutlined, "warning-text"],
  [/\.(?:[cm]?ts|go|rs|java|c|cpp|h|css|scss|less|sql|sh)$/, CodeOutlined, "info-text"],
  [/\.(?:json|ya?ml|toml|xml|ini)$/, SettingOutlined, "text-secondary"],
  [/\.html$/, Html5Outlined, "error-text"],
  [/\.pdf$/, FilePdfOutlined, "error-text"],
  [/\.(?:xlsx?|csv)$/, FileExcelOutlined, "success-text"],
  [/\.(?:zip|gz|tar|7z)$/, FileZipOutlined, "warning-text"],
];

export default function EditorFileIcon({
  name,
  directory = false,
  expanded = false,
  selected = false,
}: {
  name: string;
  directory?: boolean;
  expanded?: boolean;
  selected?: boolean;
}) {
  const match = fileIcons.find(([pattern]) => pattern.test(name.toLowerCase()));
  const Icon = directory
    ? expanded
      ? FolderOpenFilled
      : FolderFilled
    : (match?.[1] ?? FileTextOutlined);
  const color = directory ? "warning-text" : (match?.[2] ?? "text-secondary");
  return <Icon style={{ color: selected ? "inherit" : `var(--ant-color-${color})` }} />;
}
