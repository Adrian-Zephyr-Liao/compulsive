import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    env: {
      // Temporary repositories must not inherit a developer's hooks, signing or Git identity.
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Compulsive Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Compulsive Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  },
  pack: {
    entry: ["src/index.ts", "src/bin.ts"],
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
