import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Unit tests for the pure logic in this app — the derived-state and date
 * functions that decide what a page says.
 *
 * Deliberately scoped to modules with no database, no network and no React:
 * `orderState`, `isLate`, `submittalState`, `daysBetween` and friends are
 * plain functions, and they are where this project's real bugs have lived
 * (a reissued case number, a same-day answer that was impossible, a
 * superseded revision shown as current). Those never needed a browser to
 * catch — they needed the code path actually executed with real inputs.
 *
 * Action- and page-level tests need a scratch database and are a separate,
 * later step; nothing here talks to Postgres, so this suite runs in a
 * second and can gate every push.
 */
export default defineConfig({
  // The app compiles JSX with the automatic runtime (next/tsconfig sets
  // "jsx": "preserve" and Next injects it); esbuild defaults to the classic
  // one and turns every icon into a bare `React.createElement`, which throws
  // "React is not defined" the moment a test imports a .tsx module. Nothing
  // here renders — navItems.tsx is imported for its route table, and the
  // icons just have to survive being constructed. Same runtime Next itself
  // uses, so nothing here diverges from how the app is built.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Web Storage where the runtime gives none — see vitest.setup.ts.
    setupFiles: ["./vitest.setup.ts"],
    // BOTH EXTENSIONS. `.tsx` was missing until 2026-09-24, and nothing was
    // orphaned only because no `.test.tsx` existed in this app yet: a
    // deliberately-failing `lib/ZZ_orphan_probe.test.tsx` was collected by
    // nothing while `pnpm test` reported 454 files and 7202 tests green, and
    // asking vitest to run that one file printed `No test files found` with
    // the single-extension include under it.
    //
    // `.tsx` is the natural extension for a rendered component test and is the
    // one `apps/mobile/screens` already uses for exactly that, so the first
    // component test written here would have been invisible. It is the
    // 161-orphaned-`.dbtest.ts` shape in CLAUDE.md, loaded and waiting.
    //
    // `lib/testRunnerCensus.test.ts` now derives every test file from `git
    // ls-files` and every include glob from the configs the package scripts
    // name, and fails when any file is collected by nothing.
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["node_modules/**", ".next/**"],
    /* VITEST'S 5000ms DEFAULT IS TOO TIGHT FOR THIS SUITE, AND THE COST IS
       NOT A SLOW TEST — IT IS THAT "THE SUITE IS GREEN" STOPPED MEANING
       ANYTHING. On 2026-09-21, five DIFFERENT files timed out at exactly
       5000ms across runs on one machine, each passing in seconds when run
       alone: correspondence-dates, field-reports-core,
       billing/retainage-amount, ask/attachmentStream, ask/injection.batch.
       Three separate reviewers reported it independently and each had to
       re-run in isolation to find out whether their own diff was at fault.

       That is the expensive part. A suite that fails on a different file
       every run trains everyone to re-run rather than read, and a red that
       is usually noise is a red nobody believes on the day it is real.

       These tests are not slow: the same files finish in 1-6s in isolation.
       They are page renders and property sweeps competing for CPU when
       several turbo runs or agents share the machine, which is now normal
       here. 30s leaves roughly a 5x margin over the slowest legitimate file
       while still catching a genuine hang — an infinite loop or an awaited
       promise that never settles blows through 30s exactly as it blows
       through 5s.

       If a single test ever legitimately needs longer, give THAT test its
       own timeout argument rather than raising this again. */
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
});
