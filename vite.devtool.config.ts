import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  root: fileURLToPath(new URL("./src/devtool-client", import.meta.url)),
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 800,
    outDir: fileURLToPath(new URL("./dist/devtool-client", import.meta.url)),
    emptyOutDir: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "react-vendor",
              test: /node_modules[\\/](?:react|react-dom|scheduler)(?:[\\/]|$)/,
              priority: 30,
            },
            {
              name: "antd-vendor",
              test: /node_modules[\\/]antd[\\/]/,
              priority: 20,
            },
            {
              name: "antd-icons",
              test: /node_modules[\\/]@ant-design[\\/]/,
              priority: 15,
            },
            {
              name: "antd-runtime",
              test: /node_modules[\\/](?:@rc-component|rc-)/,
              priority: 12,
            },
          ],
        },
      },
    },
  },
});
