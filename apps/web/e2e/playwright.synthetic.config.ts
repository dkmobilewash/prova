import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * The daily synthetic check (.github/workflows/synthetic-demo.yml): one walk,
 * against a DEPLOYED preview, never a local server. So there is no webServer,
 * no scratch database and no seeding here, and this file deliberately does not
 * import playwright.config.ts, whose first act is to refuse anything but a
 * local scratch Postgres.
 *
 *     SYNTHETIC_BASE_URL=https://<preview> pnpm --filter @prova/web exec \
 *       playwright test -c e2e/playwright.synthetic.config.ts
 *
 * Needs the DEVELOPMENT instance's pk_test_/sk_test_ keys in
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY / CLERK_SECRET_KEY (synthetic-setup.ts).
 */
const baseURL = process.env.SYNTHETIC_BASE_URL;
if (!baseURL) throw new Error("SYNTHETIC_BASE_URL is not set: name the deployed preview to check.");

export default defineConfig({
  testDir: "./synthetic",
  globalSetup: "./synthetic-setup.ts",
  outputDir: path.resolve(__dirname, "../test-results-synthetic"),
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: path.resolve(__dirname, "../playwright-report-synthetic") }]],
  // The walk's own steps carry their budgets; this is the ceiling over all of them.
  timeout: 25 * 60_000,
  expect: { timeout: 30_000 },
  use: { baseURL, actionTimeout: 30_000, navigationTimeout: 120_000, trace: "retain-on-failure", screenshot: "only-on-failure", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
});
