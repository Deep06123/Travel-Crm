// Playwright does not read .env on its own; fixtures need DATABASE_URL.
import "dotenv/config";

import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration.
 *
 * Tests run against a real server talking to the real development database —
 * nothing is mocked, because the point is to prove the whole stack works, not
 * that the components agree with a stub.
 *
 * `reuseExistingServer` means a dev server already running is used as-is,
 * which keeps the local loop fast; CI starts its own.
 *
 * `E2E_PORT` moves the whole thing off 3000. Needed on a machine running
 * another project's dev server there: Next quietly starts on 3001 instead,
 * and the run then waits on a 3000 that will never be this application.
 */
const PORT = process.env["E2E_PORT"] ?? "3000";
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // Each file seeds and tears down its own fixtures, so files are independent,
  // but the shared database means tests within a file must stay ordered.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  reporter: process.env["CI"] ? "list" : [["list"], ["html", { open: "never" }]],

  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `${ORIGIN}/admin/login`,
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
