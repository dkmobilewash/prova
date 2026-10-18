import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * THE FREE LIEN WAIVER TOOL (apps/lien-waiver), driven in a real browser.
 *
 * Why it lives here and not in apps/lien-waiver: that app deliberately has
 * no Playwright dependency of its own, and adding one would mean a lockfile
 * change for a package this directory already pins (1.63.0). So the specs sit
 * beside the rest of the repo's browser suites and this config starts the
 * TOOL'S production build, not apps/web. It needs no Clerk and no database:
 * outside production the tool keeps rate limits in memory and, with no
 * Resend key, answers "nothing was sent" -- so a full waiver can be walked
 * end to end and no email ever leaves CI.
 *
 * It expects `pnpm --filter @prova/lien-waiver build` to have run first
 * (ci.yml's e2e-public job does it). Specs live in ./lien-waiver.
 */

const webRoot = path.resolve(__dirname, "..");
const PORT = 3300;

export default defineConfig({
  testDir: "./lien-waiver",
  outputDir: path.join(webRoot, "test-results-lien-waiver"),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [
    ["list"],
    // Counted by verdicts.mjs against `--list`, like the other two configs:
    // an exit code cannot tell "all passed" from "collected nothing".
    ["json", { outputFile: path.join(webRoot, "playwright-report-lien-waiver", "results.json") }],
  ],
  use: {
    baseURL: `http://127.0.0.1:${PORT}/lien-waiver/`,
    trace: "retain-on-failure",
    // CI uses the Chromium `playwright install` fetched. An agent container
    // cannot download one, so it points this at the one it already has.
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: "lien-waiver-375", use: { ...devices["iPhone SE"], viewport: { width: 375, height: 740 }, browserName: "chromium" } },
    { name: "lien-waiver-1280", use: { viewport: { width: 1280, height: 900 }, browserName: "chromium" } },
  ],
  webServer: {
    command: `pnpm --filter @prova/lien-waiver exec next start --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/lien-waiver/start`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Explicitly empty, so a runner that happens to carry these can never
    // make the suite send real email or reach a real database.
    env: { RESEND_API_KEY: "", RESEND_AUDIENCE_ID: "", LIEN_TOOL_DATABASE_URL: "", VERCEL_ENV: "" },
  },
});
