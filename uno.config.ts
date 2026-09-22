import {
  defineConfig,
  presetIcons,
  presetTypography,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  theme: {
    colors: {
      primary: {
        50: "#f5f6ff",
        100: "#e9edff",
        200: "#d3dafe",
        300: "#b5c2fe",
        400: "#90a3fe",
        500: "#6b84fd",
        600: "#5e74df",
        700: "#4d5fb6",
        800: "#3c4a8e",
        900: "#2d376a",
        950: "#1c2242",
      },
    },
  },
  shortcuts: {
    "color-base": "color-neutral-800 dark:color-neutral-200",
    "bg-base": "bg-white dark:bg-[#111]",
    "bg-active": "bg-[#8881]",
    "bg-secondary": "bg-[#eee] dark:bg-[#222]",
    "border-base": "border-[#8882]",
    "color-active": "color-primary-600 dark:color-primary-300",
    "border-active": "border-primary-600/25 dark:border-primary-400/25",
    "bg-glass": "bg-white/80 dark:bg-[#050505]/80 backdrop-blur-7",
    "btn-action":
      "border border-base rounded flex gap-2 items-center px-2 py-1.5 op-75 hover:op-100 hover:bg-active transition disabled:pointer-events-none disabled:op-30",
    "btn-primary":
      "px-3 py-1.5 rounded flex gap-2 items-center justify-center bg-primary-500 hover:bg-primary-600 text-white transition disabled:op-50 disabled:pointer-events-none outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40",
    "btn-icon":
      "w-8 h-8 rounded-full flex items-center justify-center op-75 hover:op-100 hover:bg-active transition disabled:pointer-events-none disabled:op-30",
    "op-fade": "op-65 dark:op-55",
    "op-mute": "op-30 dark:op-25",
  },
  presets: [presetWind4(), presetIcons({ scale: 1.2 }), presetTypography()],
  transformers: [transformerDirectives(), transformerVariantGroup()],
});
