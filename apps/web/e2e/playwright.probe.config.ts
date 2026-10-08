import baseConfig from "./playwright.config";

/**
 * The #510 hydration probe, and the reason it is a SEPARATE CONFIG rather
 * than a spec in the suite.
 *
 * `playwright.config.ts` sets `testDir: "./specs"` and ignores only
 * `*.mobile.spec.ts` and `*.public.spec.ts` — so any spec under `specs/`
 * joins the `e2e` job that gates every PR. This probe must never do that:
 * it runs against `next dev`, where a mismatch is classified as a CRASH by
 * `lib/health.ts` (which matches the MINIFIED "#418" a dev build never
 * prints), and where the config's own comment says not to read a pass/fail
 * verdict at all. A diagnostic that can turn CI red is not a diagnostic.
 *
 * So: same harness, same `globalSetup` (which mints the Clerk users and
 * seeds the rows these pages read), same `webServer` — which already
 * switches to `next dev` and loosens the timeouts when `E2E_DEV_SERVER=1`.
 * Only `testDir` differs, and `workers: 1`.
 *
 * ONE WORKER IS NOT A PERFORMANCE CHOICE. `next dev` dies after about ten
 * compiled routes, and the two memory failures need different fixes: the
 * "approaching the used memory threshold, restarting" warning is cured by
 * `--max-old-space-size`, and `FATAL ERROR: Zone Allocation failed` is NOT,
 * because zone allocation is a separate allocator that flag does not govern.
 * Its next symptom is `ERR_CONNECTION_REFUSED`, which reads exactly like a
 * broken app. Two parallel workers compiling different routes is the fastest
 * way to reach it.
 *
 * Run it from the Actions tab — `.github/workflows/hydration-probe.yml`,
 * `workflow_dispatch` only, so nothing about the current build changes.
 */
export default {
  ...baseConfig,
  testDir: "./probes",
  workers: 1,
  // A diagnostic's zero must be its own. A retry would re-run the probe
  // after a harness failure and could report a clean pass over a broken
  // control, which is the one outcome this whole file exists to prevent.
  retries: 0,
};
