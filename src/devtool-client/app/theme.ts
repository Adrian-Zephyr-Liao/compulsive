import type { ThemeConfig } from "antd";

export const themeConfig: ThemeConfig = {
  cssVar: { key: "compulsive" },
  token: {
    borderRadius: 6,
    colorBgContainer: "#ffffff",
    colorBgLayout: "#f6f7fc",
    colorBorderSecondary: "#e7e9f2",
    colorPrimary: "#5b55e7",
    colorText: "#17203a",
    colorTextSecondary: "#7a8194",
    controlHeight: 32,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", sans-serif',
  },
  components: {
    Layout: {
      bodyBg: "#f6f7fc",
      footerBg: "rgba(255, 255, 255, 0.92)",
      headerBg: "rgba(255, 255, 255, 0.92)",
      headerColor: "#17203a",
      headerHeight: 44,
      lightSiderBg: "#f8f9fd",
    },
    Menu: {
      itemBg: "transparent",
      itemHoverBg: "#f0f0ff",
      itemSelectedBg: "#ebeaff",
      itemSelectedColor: "#514bd8",
    },
    Table: {
      cellPaddingBlockMD: 4,
      cellPaddingInlineMD: 8,
      headerBg: "#f7f8fc",
    },
  },
};
