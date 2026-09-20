import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

/**
 * Real browser E2E, chromium-only, kept deliberately separate from
 * vitest.db.config.mts and vitest.config.mts the same way that file is
 * separate from vitest.config.ts: a suite that needs infrastructure it
 * might not have (here: Postgres AND a running Next server AND a real
 * Clerk dev instance) is a suite that gets skipped and rots if it isn't
 * kept out of the fast path. See vitest.db.config.mts's own docstring.
 *
 * WHY THIS EXISTS AT ALL: the unit suite runs in happy-dom, which does no
 * layout — `getBoundingClientRect` returns zeros there (see CLAUDE.md's
 * "Cancel inherits the delete pixel" entry, discovered precisely because
 * no DOM-only test in this repo could see it). Phone-width breakage,
 * off-screen panels and the tour's on-screen containment are only
 * checkable in a real browser. This suite is that check, for the ten
 * screens a pilot tester actually touches.
 *
 * DATABASE SAFETY: global-setup.ts refuses to run against anything but a
 * local scratch Postgres before any Clerk user is minted or any row is
 * written — see lib/assertScratchDatabase.ts. There is no env-var escape
 * hatch, on purpose, matching vitest.db.setup.mts.
 *
 * Run locally:
 *   export DATABASE_URL='postgresql://you@localhost:5433/prova_e2e_test?host=/tmp/pgsock'
 *   export DIRECT_URL="$DATABASE_URL"
 *   pnpm --filter @prova/db exec prisma migrate deploy --schema prisma/schema
 *   pnpm --filter @prova/web exec playwright install --with-deps chromium
 *   pnpm --filter @prova/web run test:e2e
 */

// __dirname, not import.meta.url: Playwright loads a .ts config as CJS
// unless the nearest package.json says "type": "module" (apps/web's
// doesn't), and import.meta throws a SyntaxError under that loader.
const repoRoot = path.resolve(__dirname, "../../..");
const webRoot = path.resolve(__dirname, "..");
const PORT = 3100;

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  // Explicit, not Playwright's default (relative to this config file) —
  // pinned to apps/web/ so .gitignore's two entries and the CI job's
  // "Upload Playwright report" step path agree with where this actually
  // writes, instead of three places quietly assuming the same default.
  outputDir: path.join(webRoot, "test-results"),
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Each spec signs in as one of four fixed personas and none of them
  // mutate a persona another spec depends on (see lib/personas.ts) — so
  // retries exist only for genuine infra flakiness (a cold Next compile,
  // a slow first Clerk round trip), never to paper over an order
  // dependency. If a spec needs more than this to pass reliably, the fix
  // is to delete it (per the task's own discipline rule), not to raise it.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // The HTML report always writes, CI or not — a local failure deserves
  // the same "open the report" instruction as a CI one, rather than a
  // click-list step that only works in one of the two places it's given.
  reporter: [["html", { open: "never", outputFolder: path.join(webRoot, "playwright-report") }], ["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/*.mobile.spec.ts",
    },
    {
      // "Chromium only, plus one mobile viewport" — a narrow Chromium
      // viewport, not a WebKit/iOS emulation swap. `devices["iPhone 12"]`
      // was deliberately NOT used here: it pins `defaultBrowserType:
      // "webkit"`, and the brief is chromium-only. This project overrides
      // only viewport/touch/UA, keeping the chromium engine.
      name: "mobile-375",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/125.0.0.0 Mobile Safari/537.36",
      },
      testMatch: "**/*.mobile.spec.ts",
    },
  ],
  webServer: {
    // Production-like on purpose (build + start, not `next dev`): a dev
    // server's HMR client and slower first compile are their own source
    // of noise in a suite whose entire premise is "the unit suite already
    // covers logic, this covers what a browser renders."
    command: `pnpm --filter @prova/web exec next start -p ${PORT}`,
    cwd: repoRoot,
    url: `http://localhost:${PORT}/pilot`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
