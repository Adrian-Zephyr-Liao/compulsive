import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: ["src/index.ts", "src/cli.ts"],
    format: ["esm", "cjs"],
    dts: {
      tsgo: true,
    },
    exports: false,
    platform: "node",
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
});
