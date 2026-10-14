import { App as AntApp, ConfigProvider } from "antd";

import { themeConfig } from "./app/theme.js";
import WorkspaceApp from "./features/workspaces/WorkspaceApp.js";

export default function App() {
  return (
    <ConfigProvider theme={themeConfig} tooltip={{ unique: true }}>
      <AntApp className="h-full">
        <WorkspaceApp />
      </AntApp>
    </ConfigProvider>
  );
}
