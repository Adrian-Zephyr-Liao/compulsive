import { fileURLToPath } from "node:url";

import vue from "@vitejs/plugin-vue";
import UnoCSS from "unocss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  root: fileURLToPath(new URL("./src/devtool-client", import.meta.url)),
  plugins: [vue(), UnoCSS()],
  build: {
    outDir: fileURLToPath(new URL("./dist/devtool-client", import.meta.url)),
    emptyOutDir: false,
  },
});
