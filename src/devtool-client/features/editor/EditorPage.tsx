import { App, ConfigProvider, Empty, theme } from "antd";
import { useParams } from "react-router";
import type { DevtoolWorkspace } from "../../../devtool.js";
import type { WorkspaceRpc } from "../workspaces/types.js";
import { useI18n } from "../../app/i18n.js";
import EditorWorkspace from "./EditorWorkspace.js";
import "./editor.css";
interface Props {
  onThemeChange: (dark: boolean) => void;
  themeBusy?: boolean | undefined;
  connected?: boolean | undefined;
  onWorkspaceChanged?: (() => Promise<void>) | undefined;
  workspace: DevtoolWorkspace;
  getRpc: () => Promise<WorkspaceRpc>;
  onOpenVscode: (id: string) => void;
}
export default function EditorPage(props: Props) {
  const { repositoryId = "" } = useParams();
  const { t } = useI18n();
  const { token } = theme.useToken();
  if (!props.workspace.members.some((m) => m.repositoryId === repositoryId))
    return <Empty description={t("editor.missingMember")} />;
  return (
    <ConfigProvider
      theme={{
        cssVar: { key: "compulsive-editor" },
        components: {
          Tree: { titleHeight: 32 },
          Tabs: {
            horizontalMargin: "0",
            cardHeightSM: 40,
            cardPaddingSM: "8px 12px",
            itemSelectedColor: token.colorPrimaryText,
            itemActiveColor: token.colorPrimaryText,
          },
          Splitter: { splitBarSize: 1, splitTriggerSize: 8 },
        },
      }}
    >
      <App className="h-full">
        <EditorWorkspace
          key={`${props.workspace.id}:${repositoryId}`}
          {...props}
          repositoryId={repositoryId}
        />
      </App>
    </ConfigProvider>
  );
}
