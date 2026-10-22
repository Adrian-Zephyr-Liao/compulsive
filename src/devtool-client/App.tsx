import { App as AntApp, ConfigProvider } from "antd";
import { createHashRouter, RouterProvider } from "react-router";
import { useEffect, useState } from "react";

import { LanguageProvider, useI18n } from "./app/i18n.js";
import { createThemeConfig } from "./app/theme.js";
import { AppearanceProvider, useAppearance } from "./app/appearance.js";
import WorkspaceApp from "./features/workspaces/WorkspaceApp.js";

function LocalizedApp() {
  const { antdLocale } = useI18n();
  const { dark } = useAppearance();
  const themeConfig = createThemeConfig(dark);
  const background = themeConfig.token!.colorBgLayout!;
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    document.documentElement.style.backgroundColor = background;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", background);
  }, [dark, background]);
  const [router] = useState(() => createHashRouter([{ path: "*", element: <WorkspaceApp /> }]));
  return (
    <ConfigProvider locale={antdLocale} theme={themeConfig}>
      <AntApp className="h-full">
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <AppearanceProvider>
        <LocalizedApp />
      </AppearanceProvider>
    </LanguageProvider>
  );
}
