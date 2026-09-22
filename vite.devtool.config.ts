import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  root: fileURLToPath(new URL("./src/devtool-client", import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL("./dist/devtool-client", import.meta.url)),
    emptyOutDir: false,
  },
});
