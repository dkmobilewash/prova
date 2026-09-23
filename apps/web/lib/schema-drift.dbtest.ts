import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";

/**
 * The drift marker fires on a REAL Prisma P2022, through the real client.
 *
 * `packages/db/src/schema-drift.ts` is unit-tested on hand-made objects;
 * this is the half that cannot be faked — that `$extends` in
 * `packages/db/src/index.ts` actually wraps the query that fails, inside
 * an interactive transaction too, and that the error which comes back out
 * carries `SCHEMA_DRIFT_P2022` where Next.js will find it. "Written,
 * documented, and never called" is a recurring shape here; this is the
 * call.
 *
 * HOW A MISSING COLUMN IS MANUFACTURED WITHOUT LEAVING ONE BEHIND. DDL is
 * transactional in Postgres. Inside one `$transaction`, drop a column,
 * then run a model query that selects it: the query fails with P2022, the
 * throw aborts the transaction, and the ROLLBACK puts the column back.
 * The scratch schema is byte-identical before and after — asserted, not
 * assumed, by reading `information_schema.columns` in `afterAll`.
 *
 * Runs only against a scratch database: vitest.db.setup.mts refuses
 * anything that is not localhost or a unix socket.
 */

const COLUMN = "website";

async function columnExists(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*)::bigint AS n
    FROM information_schema.columns
    WHERE table_name = 'Company' AND column_name = ${COLUMN}
  `;
  return Number(rows[0]?.n ?? 0) === 1;
}

afterAll(async () => {
  // The transaction rolled the DDL back; if it did not, every later
  // Company query in the suite would fail with exactly the error this
  // file is about, so say so here rather than let that be discovered.
  expect(await columnExists()).toBe(true);
  await prisma.$disconnect();
});

describe("a real P2022 through the real client", () => {
  it("arrives with the SCHEMA_DRIFT_P2022 digest set by the Prisma client hook", async () => {
    expect(await columnExists()).toBe(true);

    let caught: unknown = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`ALTER TABLE "Company" DROP COLUMN "${COLUMN}"`);
        // A model query that selects every scalar column, including the
        // one that no longer exists → P2022 from the query engine.
        await tx.company.findFirst();
      });
    } catch (err) {
      caught = err;
    }

    expect(caught, "the transaction threw").not.toBeNull();
    const err = caught as { code?: unknown; digest?: unknown };
    expect(err.code).toBe("P2022");
    expect(err.digest).toBe("SCHEMA_DRIFT_P2022");

    // And the rollback held: the column is back.
    expect(await columnExists()).toBe(true);
  });

  it("does not stamp an ordinary failure — a unique violation stays a P2002 with no digest", async () => {
    // The hook must only ever mark the two drift codes. A P2002 is the
    // most common real failure in this app; it goes through the same hook
    // and must come out untouched.
    const company = await prisma.company.findFirst({ select: { id: true } });
    if (!company) return; // an empty scratch database cannot make a duplicate
    let caught: unknown = null;
    try {
      await prisma.company.create({ data: { id: company.id, name: "duplicate id on purpose" } });
    } catch (err) {
      caught = err;
    }
    const err = caught as { code?: unknown; digest?: unknown } | null;
    expect(err?.code).toBe("P2002");
    expect(err?.digest).toBeUndefined();
  });
});
