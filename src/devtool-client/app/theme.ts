import { theme, type ThemeConfig } from "antd";

export function createThemeConfig(dark: boolean): ThemeConfig {
  const surface = dark ? "#17171c" : "#ffffff";
  const layout = dark ? "#1d1d23" : "#f6f7fc";
  const text = dark ? "#d3d3dd" : "#17203a";
  return {
    cssVar: { key: "compulsive" },
    algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      borderRadius: 6,
      colorBgContainer: surface,
      colorBgElevated: dark ? "#25252c" : surface,
      colorBgLayout: layout,
      colorBorder: dark ? "#34343d" : "#d9dce6",
      colorBorderSecondary: dark ? "#2b2b33" : "#e7e9f2",
      colorPrimary: dark ? "#7666d5" : "#5b55e7",
      colorPrimaryText: dark ? "#b5afff" : "#514bd8",
      colorLink: dark ? "#b5afff" : "#514bd8",
      colorLinkHover: dark ? "#d1ccff" : "#716bea",
      colorLinkActive: dark ? "#a49cf6" : "#403ac7",
      colorText: text,
      colorTextSecondary: dark ? "#9999a6" : "#7a8194",
      controlHeight: 32,
      fontFamily:
        '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", sans-serif',
    },
    components: {
      Button: { defaultShadow: "none", primaryShadow: "none", dangerShadow: "none" },
      Layout: {
        bodyBg: layout,
        footerBg: surface,
        headerBg: surface,
        headerColor: text,
        headerHeight: 44,
        lightSiderBg: layout,
      },
      Menu: {
        itemBg: "transparent",
        itemHoverBg: dark ? "#292932" : "#f0f0ff",
        itemSelectedBg: dark ? "#383044" : "#ebeaff",
        itemSelectedColor: dark ? "#b5afff" : "#514bd8",
      },
      Table: {
        cellPaddingBlockMD: 4,
        cellPaddingInlineMD: 8,
        headerBg: dark ? "#222229" : "#f7f8fc",
      },
    },
  };
}
