import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "examples/**",
        "vite.config.ts",
        "vitest.config.ts",
        "src/index.ts",
      ],
    },
  },
});
