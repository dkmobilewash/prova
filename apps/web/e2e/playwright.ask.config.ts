import baseConfig from "./playwright.config";

/**
 * Ask commands, typed and confirmed, LOCAL ONLY. From the repo root:
 *
 *     pnpm test:e2e -- --ask-click                 builds, then runs it
 *     pnpm test:e2e -- --ask-click --skip-build    reuses the last build
 *
 * Same throwaway Postgres, Clerk keys and webServer as the suite. With
 * ANTHROPIC_API_KEY set the typing reaches the real model; without it the
 * spec says so and stubs only the model's choice (see the spec's header).
 */
export default {
  ...baseConfig,
  testDir: "./local",
  testMatch: "ask-commands.local.spec.ts",
  workers: 1,
  retries: 0,
  projects: [{ name: "chromium", use: { browserName: "chromium" as const, viewport: { width: 1280, height: 900 } } }],
};
