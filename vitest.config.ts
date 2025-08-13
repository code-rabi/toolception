import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "tests/**",
        "examples/**",
        "vite.config.ts",
        "vitest.config.ts",
        "src/types/**",
        "src/index.ts",
      ],
    },
  },
});
