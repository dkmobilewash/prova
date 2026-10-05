/**
 * The marker every row this suite writes carries in its name.
 *
 * Lifted out of `seedDatabase.ts` 2026-10-05, and the reason is mechanical
 * rather than tidy: `seedDatabase.ts` imports `@prova/db`, which instantiates
 * a `PrismaClient` at module load. `salesFixture.ts` has to be readable by the
 * UNIT suite — that is the whole point of it, see its own header — and a unit
 * test that reaches a real Prisma client to learn a string constant is a unit
 * test that needs a database.
 *
 * `seedDatabase.ts` re-exports it, so the four specs that import `E2E_TAG`
 * from there keep working and nothing had to be renamed.
 *
 * Same convention, for the same reason, as `clean-scratch-data.mjs` and
 * `seed-demo.mjs`'s "[demo]": a marker future cleanup can find, without
 * touching a row a person entered by hand while poking at their own scratch
 * database.
 */
export const E2E_TAG = "ZZ-E2E";
