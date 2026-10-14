import { presetAnthonyDesign } from "@antfu/design/unocss";
import {
  defineConfig,
  presetIcons,
  presetTypography,
  presetWind4,
  transformerDirectives,
  transformerVariantGroup,
} from "unocss";

export default defineConfig({
  shortcuts: {
    "z-modal-backdrop": "z-[30]",
    "z-modal-content": "z-[31]",
    "z-dropdown": "z-[40]",
  },
  presets: [
    presetAnthonyDesign({ primary: "#28785e" }),
    presetWind4(),
    presetIcons({ scale: 1.2 }),
    presetTypography(),
  ],
  transformers: [transformerDirectives(), transformerVariantGroup()],
});
