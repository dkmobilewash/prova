import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config";

/**
 * THE HALF OF THE E2E SUITE THAT NEEDS NO CLERK INSTANCE — so that "we have
 * no Clerk secret" stops meaning "no page in this product is ever checked
 * at phone width".
 *
 * WHY THIS FILE EXISTS. `playwright.config.ts`'s `globalSetup` mints four
 * Clerk users through the Backend API before any browser opens. That is
 * correct for the specs that sign in, and it is also unconditional — so
 * `pilot.mobile.spec.ts`, which signs nobody in and asserts nothing but
 * `scrollWidth <= innerWidth`, cannot run either. On 2026-09-21 no
 * workflow invoked `test:e2e` at all and the repository's Actions history
 * had only ever run three workflows (CI, Migrate, Migrate demo database),
 * so the one suite in this repo that can see layout had never run
 * anywhere. This config is the part of it that can run on day one, with a
 * Postgres container and nothing else.
 *
 * It does NOT replace the Clerk-backed suite and takes nothing away from
 * it: `playwright.config.ts` is imported here unchanged, and everything
 * below is an override. The signed-in screens — the ones a foreman
 * actually uses — are still only reachable with a Clerk development
 * instance, and `.github/workflows/e2e.yml`'s second job fails loudly
 * saying so rather than skipping.
 *
 * THE DEV-BROWSER COOKIE, AND WHY IT IS NOT AN AUTH BYPASS. Measured
 * 2026-09-21, because it looked like a wall: `clerkMiddleware()` runs on
 * every page in `middleware.ts`'s matcher, public ones included, and a
 * DEVELOPMENT instance answers a browser's first request with a 307 to its
 * Frontend API to mint a dev-browser token. With a placeholder
 * publishable key that FAPI host does not resolve, and every navigation —
 * including `/pilot` — dies with `net::ERR_NAME_NOT_RESOLVED` at the
 * top-level URL. Presenting a `__clerk_db_jwt` cookie suppresses that one
 * redirect, and `/pilot` then renders 200.
 *
 * What it does NOT do is sign anybody in. Every page walked here is
 * public, every request is anonymous, and `middleware.ts`, `lib/auth.ts`
 * and every capability check are untouched — the suite's own rule, and
 * this keeps it. It is a cookie in the browser, not a flag in the app.
 */

const webRoot = path.resolve(__dirname, "..");

/**
 * The viewports, and the reason each one is here rather than a round
 * number somebody liked.
 *
 * A FIGURE WITHOUT ITS VIEWPORT IS UNREPRODUCIBLE, so the viewport is in
 * the project NAME: every line of a report, every failure and every trace
 * says which width it was taken at, and no measurement in this suite can
 * be quoted without one.
 */
const VIEWPORTS = [
  // The narrowest phone still in the field — iPhone SE (1st gen) and 5/5s,
  // and, which is the larger audience, ANY iPhone with Display Zoom turned
  // on, which reports 320 CSS px on hardware that is physically 375. The
  // landing page failed exactly here and nowhere wider (measured
  // 2026-09-21: device 320 -> `window.innerWidth` 342), which is the whole
  // argument for keeping a width below 375 in this list.
  { name: "public-320", width: 320 },
  // The brief's phone width, and the same one `mobile-375` uses in the
  // Clerk-backed config.
  { name: "public-375", width: 375 },
] as const;

export default defineConfig({
  ...base,
  testDir: "./specs",
  globalSetup: "./public-setup.ts",
  outputDir: path.join(webRoot, "test-results-public"),
  reporter: [
    ["html", { open: "never", outputFolder: path.join(webRoot, "playwright-report-public") }],
    // The JSON report is not decoration: `verdicts.mjs` counts the verdicts
    // in it against the number of tests collected, because a run that
    // reported nothing and a run that reported all-pass look identical to
    // an exit code. See CLAUDE.md's "a verifier that cannot distinguish
    // refuted from never ran" entry.
    ["json", { outputFile: path.join(webRoot, "playwright-report-public/results.json") }],
    ["list"],
  ],
  projects: [
    ...VIEWPORTS.map(({ name, width }) => ({
      name,
      testMatch: "**/*.public.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width, height: 812 },
        isMobile: true,
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/125.0.0.0 Mobile Safari/537.36",
      },
    })),
    {
      // THE CONTROL. Without it a failure at 320 or 375 cannot be told from
      // a page that is broken at every width, and "it breaks on a phone"
      // would be a claim with no comparison behind it.
      name: "public-1280-control",
      testMatch: "**/*.public.spec.ts",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } },
    },
  ],
});
