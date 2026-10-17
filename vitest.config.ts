import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // Unit tests run in Node; component tests opt into jsdom with a
    // `@vitest-environment jsdom` docblock.
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Playwright owns tests/e2e.
    exclude: ["tests/e2e/**", "node_modules/**"],
    globals: true,
  },
});
