import baseConfig from "./playwright.config";

/**
 * `pnpm test:e2e -- --welcome-click`: e2e/local/trade-presets.local.spec.ts and
 * nothing else. LOCAL ONLY, like the ask and billing click lists — outside
 * `specs/`, so no CI job runs it. Its persona must be brand new, which the
 * run's throwaway database guarantees on every run.
 */
export default {
  ...baseConfig,
  testDir: "./local",
  testMatch: "trade-presets.local.spec.ts",
  workers: 1,
  retries: 0,
  projects: [{ name: "chromium", use: { browserName: "chromium" as const, viewport: { width: 1280, height: 900 } } }],
};
