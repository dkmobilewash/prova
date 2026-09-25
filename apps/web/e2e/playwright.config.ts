import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { assertScratchDatabase } from "./lib/assertScratchDatabase";
import { E2E_FAKE_BLOB_TOKEN } from "./lib/fakeBlobToken.mjs";

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
/**
 * 3100 unless `E2E_PORT` says otherwise, and the override is a scar rather
 * than a nicety: this was a bare literal, so two runs on one machine — two
 * agents, or a laptop run beside a CI job on a self-hosted runner — collide,
 * and the second one gets `next start`'s "port already used" through
 * Playwright's webServer. That surfaces as a suite-wide timeout with no
 * results, which reads as a BROKEN SUITE rather than as a busy port. Two
 * sessions lost time to it on 2026-09-21.
 *
 * `baseURL` and `webServer.url` below both derive from this, so the port
 * cannot be changed in one place and missed in the other.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

/** Run the suite against `next dev` instead of `next start`, so React
 * reports hydration mismatches with a diff instead of a stripped error
 * code. Diagnostic only — see the note on `webServer.command`. */
const DEV_SERVER = process.env.E2E_DEV_SERVER === "1";

// AT CONFIG LOAD, not only in global-setup.ts. Read out of the installed
// runner (playwright@1.63.0 lib/runner/index.js, `createGlobalSetupTasks`):
// the task order is remove-output-dirs -> PLUGIN SETUP -> global setup,
// and `webServer` is a plugin. So `next start` below boots BEFORE
// global-setup.ts gets to refuse a non-scratch DATABASE_URL — and a
// production Next server inherits whatever connection string this
// process has. Booting it against a real database writes nothing by
// itself, but "writes nothing by itself" is the exact sentence that
// preceded the shadow-database reset in CLAUDE.md. Refusing here, while
// this file is still being evaluated, is the earliest point there is.
// Same guard, same function (`scratchProblem()`), no second opinion.
assertScratchDatabase();

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
  reporter: [
    ["html", { open: "never", outputFolder: path.join(webRoot, "playwright-report") }],
    // The JSON report is what `e2e/verdicts.mjs` counts. An exit code cannot
    // tell a run where everything passed from a run that collected nothing
    // or skipped everything, and CI reads only the exit code — see
    // CLAUDE.md's "a verifier that cannot distinguish refuted from never
    // ran" entry. It writes inside the HTML report's folder so the CI
    // artifact upload carries both without a second path.
    ["json", { outputFile: path.join(webRoot, "playwright-report/results.json") }],
    ["list"],
  ],
  // A dev server compiles each route on first hit, which does not fit the
  // production timeouts — and the journey is serial, so one slow first load
  // times out step 1 and SKIPS the step that prints the hydration diff,
  // which is the only reason the dev run exists. The looser numbers apply
  // only under E2E_DEV_SERVER.
  timeout: DEV_SERVER ? 120_000 : 30_000,
  expect: { timeout: DEV_SERVER ? 30_000 : 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      // `*.public.spec.ts` belongs to playwright.public.config.ts, which
      // runs it at three viewports with a setup that seeds the rows those
      // pages read and mints no Clerk user. Without this line the default
      // `testDir` glob would sweep those specs into this project too, where
      // their fixtures do not exist — and a spec that runs in two suites
      // gets fixed for one of them.
      testIgnore: ["**/*.mobile.spec.ts", "**/*.public.spec.ts"],
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
    //
    // E2E_DEV_SERVER=1 IS THE ONE REASON TO BREAK THAT, AND IT IS A
    // DIAGNOSTIC, NEVER A MODE TO SHIP IN. Production React strips its own
    // error arguments: a hydration mismatch arrives as #418 with args
    // ["HTML", ""], which names the page and never the element. A dev
    // server's React prints the actual diff and a component stack, so a
    // mismatch that would otherwise cost a day of reading the shell's
    // imports (2026-09-24 — four wrong hypotheses before anyone thought to
    // do this) costs one run. journey.spec.ts step 11 prints the console
    // output for exactly this.
    //
    // Everything the comment above warns about is still true while it is
    // on: expect slower first loads and HMR noise, and do not read a
    // pass/fail verdict off a dev run.
    command: DEV_SERVER
      ? `pnpm --filter @prova/web exec next dev -p ${PORT}`
      : `pnpm --filter @prova/web exec next start -p ${PORT}`,
    cwd: repoRoot,
    url: `http://localhost:${PORT}/pilot`,
    // Never reuse a server the runner (e2e/run.mjs) did not start: a
    // `next start` somebody left on :3100 carries ITS env, not the
    // throwaway database and fake blob token below, and every assertion in
    // the journey would then be about a server nobody vouched for.
    reuseExistingServer: !process.env.CI && !process.env.E2E_RUNNER,
    // The server under test cannot reach anything real. `webServer.env`
    // REPLACES the child's environment rather than merging, so the spread
    // comes first and the two overrides win:
    //   - BLOB_READ_WRITE_TOKEN is a fake read-write token whose store id
    //     is `e2estore`. Every real upload would fail against it, and the
    //     journey never sends one: lib/blobStub.ts answers the browser's
    //     upload in the browser, with a URL the app's own
    //     `documentUrlProblem` check accepts BECAUSE it names this store.
    //   - ANTHROPIC_API_KEY is blank, so no spec can spend a model call by
    //     accident (memory: a full eval run once emptied the shared
    //     balance). specs/ask-panel.spec.ts stubs /api/ask in the browser
    //     anyway; this is the server-side belt to that brace.
    env: {
      ...process.env,
      BLOB_READ_WRITE_TOKEN: E2E_FAKE_BLOB_TOKEN,
      ANTHROPIC_API_KEY: "",
    },
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
