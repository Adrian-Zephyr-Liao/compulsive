import { App as AntApp, ConfigProvider } from "antd";

import { LanguageProvider, useI18n } from "./app/i18n.js";
import { themeConfig } from "./app/theme.js";
import WorkspaceApp from "./features/workspaces/WorkspaceApp.js";

function LocalizedApp() {
  const { antdLocale } = useI18n();
  return (
    <ConfigProvider locale={antdLocale} theme={themeConfig} tooltip={{ unique: true }}>
      <AntApp className="h-full">
        <WorkspaceApp />
      </AntApp>
    </ConfigProvider>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <LocalizedApp />
    </LanguageProvider>
  );
}
