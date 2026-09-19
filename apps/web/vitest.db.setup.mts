import { scratchProblem } from "../../packages/db/scripts/connection-target.mjs";

/**
 * Refuses to start the db suite against anything that is not a local
 * scratch database. Runs as vitest globalSetup, so it fires once, before
 * any test file loads Prisma — not after the first delete has already
 * happened.
 *
 * Why this exists: vitest.db.config.mts has SAID "run it against a
 * SCRATCH database — never a real one" since the suite was written, and a
 * comment is not a guard. On 2026-09-18 a real Neon endpoint was reset by
 * tooling that trusted whatever URL it was handed (see the
 * shadow-database entry in CLAUDE.md). The suite deletes companies; the
 * same trust here is the same incident waiting on a different day.
 */
export default function assertScratchDatabase(): void {
  for (const name of ["DATABASE_URL", "DIRECT_URL"] as const) {
    const problem = scratchProblem(process.env[name], name);
    if (problem) throw new Error(`db suite refused: ${problem}`);
  }
}
