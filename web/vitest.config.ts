import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests for web/src (npm test). Server modules read the repo's data files relative to web/,
// so tests run from this folder; "server-only" is stubbed so those modules can load outside Next.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/unit/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
