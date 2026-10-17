import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // `server-only` throws outside a React Server Component graph. Integration
      // tests exercise exactly those server modules on purpose, so the guard is
      // stubbed here. It still protects the application build, where it matters.
      "server-only": fileURLToPath(
        new URL("./tests/stubs/server-only.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Unit tests run in Node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Playwright owns tests/e2e.
    exclude: ["tests/e2e/**", "node_modules/**"],
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // Integration tests share one database, so they must not interleave.
    fileParallelism: false,
  },
});
