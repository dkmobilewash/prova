import baseConfig from "./playwright.config";

/**
 * The billing click list as a spec, LOCAL ONLY. Run from the repo root:
 *
 *     pnpm test:e2e -- --billing-click                 builds, then runs it
 *     pnpm test:e2e -- --billing-click --skip-build    reuses the last build
 *
 * It needs apps/web/.env's development Clerk keys, like the rest of the signed-in
 * suite, and boots its own throwaway Postgres. It lives in `local/`, which the
 * main config's `testDir: "./specs"` never reaches, so no CI job runs it. Same
 * globalSetup and webServer as the suite; one worker, no retries, because the
 * steps are one serial story over one fixture job.
 */
export default {
  ...baseConfig,
  testDir: "./local",
  // `local/` holds the takeoff click list too, which has its own config and flag.
  testMatch: "billing-click.local.spec.ts",
  workers: 1,
  retries: 0,
  projects: [{ name: "chromium", use: { browserName: "chromium" as const, viewport: { width: 1280, height: 900 } } }],
};
