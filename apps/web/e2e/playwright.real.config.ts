import baseConfig from "./playwright.config";

/**
 * The REAL-DRAWING specs, LOCAL ONLY. Run from the repo root with the env each
 * spec names in its own header (REAL_PLAN_DIR, REAL_SET_PDF, TRACE_SHOTS, …):
 *
 *     REAL_PLAN_DIR=… APP_EQ_OUT=… pnpm test:e2e -- --real-plans takeoff-app-equals-eval
 *     … --real-plans --skip-build          reuses the last build
 *
 * Client drawings never enter the repository, so in CI every one of these could
 * only SKIP — and `verdicts.mjs` counts a skip as a failure, on purpose. So they
 * live in `local/`, which the main config's `testDir: "./specs"` never reaches,
 * and no CI job runs them. Everything else is the main config's: same
 * globalSetup, webServer (whose env passes the shell's through), workers and
 * retries, and its Desktop Chrome project — the conditions they ran under when
 * they sat in `specs/`.
 *
 * Every `*.local.spec.ts` here except the two click lists, which have their own
 * configs and flags. A new real-drawing spec dropped into `local/` is picked up
 * with no edit to this file.
 */
const chromium = baseConfig.projects!.find((project) => project.name === "chromium")!;

export default {
  ...baseConfig,
  testDir: "./local",
  testMatch: "*.local.spec.ts",
  projects: [{ ...chromium, testIgnore: ["billing-click.local.spec.ts", "takeoff-click.local.spec.ts"] }],
};
