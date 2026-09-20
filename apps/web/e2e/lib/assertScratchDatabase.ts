// Same plain .mjs import apps/web/vitest.db.setup.mts makes, for the
// identical reason — this guard reuses that one exactly rather than
// reimplementing it.
import { scratchProblem } from "../../../../packages/db/scripts/connection-target.mjs";

/**
 * Refuses to run the E2E suite against anything that is not a local
 * scratch database. Copied in spirit from `apps/web/vitest.db.setup.mts`
 * rather than imported from it, because that file is vitest globalSetup
 * (a default export vitest itself calls) and this one is plain Playwright
 * global setup — but the guard underneath, `scratchProblem()`, is the
 * exact same function, not a reimplementation. See CLAUDE.md's
 * `--shadow-database-url` entry for why this exists at all: a tool that
 * trusted whatever connection string it was handed reset a real Neon
 * endpoint once. This suite creates a company, a job, a contact and a
 * second user, and (via clean-up) deletes them — the same risk wearing a
 * browser instead of a test runner.
 *
 * Called from Playwright's `globalSetup`, so it runs once, before any
 * spec file loads Prisma or opens a browser — not after the first write
 * has already happened.
 */
export function assertScratchDatabase(): void {
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const problem = scratchProblem(process.env[name], name);
    if (problem) {
      throw new Error(
        `e2e suite refused: ${problem}\n` +
          "e2e: see apps/web/vitest.db.config.mts for the scratch-database recipe " +
          "this suite reuses verbatim.",
      );
    }
  }
}
