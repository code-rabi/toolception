import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      name: "mcp-dynamic-tooling",
      formats: ["es"],
      fileName: (format) => `index.${format === "es" ? "js" : format}`,
    },
    sourcemap: true,
    rollupOptions: {
      external: [
        /^@modelcontextprotocol\/sdk(\/.*)?$/,
        /^fastify(\/.*)?$/,
        /^@fastify\/cors(\/.*)?$/,
        "zod",
        // Node built-ins (in case peer deps reference them)
        "node:crypto",
        "node:http",
        "node:https",
        "node:stream",
        "node:events",
        "node:url",
        "node:buffer",
        "node:util",
      ],
    },
    target: "es2020",
  },
});
