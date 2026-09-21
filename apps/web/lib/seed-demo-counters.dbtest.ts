/**
 * The demo seed leaves every sequence counter agreeing with the rows it
 * wrote — proved by RUNNING the seed against a real database and then
 * issuing the next number, not by reading the script.
 *
 * WHAT WENT WRONG, and why a source scan was not enough on its own.
 * `packages/db/scripts/seed-demo.mjs` wrote three `Invoice` rows (#1, #1, #2)
 * and two `ChangeOrder` rows (#1, #2) and created NEITHER counter, while
 * correctly seeding the other six. So on every demo-seeded job:
 *
 *   1. `issueInvoiceNumber` upserts the missing counter with `lastNumber: 1`;
 *   2. the insert collides with the seeded invoice #1 on
 *      `@@unique([jobId, number])`;
 *   3. the bump and the insert are ONE `$transaction`, so the counter rolls
 *      back with the failed insert.
 *
 * Which makes it permanent rather than flaky: the next attempt upserts 1
 * again, and the next. "Create invoice" was dead on every demo job forever,
 * on the demo project and on every Vercel preview — which is exactly where
 * testers and previews land. Production seeds nothing and was unaffected.
 *
 * `counterCensus.test.ts` now scans the seed and would catch a missing
 * counter in a second on a laptop. It CANNOT catch this, and saying what it
 * cannot do is the point of having both: that census is file-level, so a
 * script that seeds a counter for one job and writes rows for another passes
 * it and is still broken. Per-job agreement is a claim about data, and only
 * a database can answer it. Same division as the `scratch-cleanup-order`
 * census and the dbtests that prove the delete order for real.
 *
 * WHY IT RUNS THE SCRIPT AS A SUBPROCESS rather than importing it: that is
 * how it actually runs — `node scripts/seed-demo.mjs` under the Seed demo
 * database workflow, with no bundler and no test harness in the way. A test
 * that imported and re-implemented its wiring would be testing a copy.
 *
 * SCOPED TO A COMPANY THIS FILE CREATES, via `SEED_COMPANY_ID`. The seed
 * defaults to the OLDEST company in the database, which in a shared scratch
 * database is whatever another test file left behind.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prova/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NUMBERED_TABLES } from "../../../packages/db/scripts/numbered-tables.mjs";
import { issueInvoiceNumber } from "./billing/invoice-number";

const prisma = new PrismaClient();
const dbPackage = fileURLToPath(new URL("../../../packages/db/", import.meta.url));

let companyId = "";
let seedOutput = "";

/** Runs the real script, the real way. Throws with its own output attached,
 * because a seed that refuses says WHY and that message is the whole
 * diagnosis. */
function runSeed(...args: string[]): string {
  return execFileSync("node", ["scripts/seed-demo.mjs", ...args], {
    cwd: dbPackage,
    encoding: "utf8",
    env: {
      ...process.env,
      // The seed refuses to write to a database nobody named. `localhost`
      // and `127.0.0.1` both satisfy its substring check; DATABASE_URL is
      // already guaranteed local by vitest.db.setup.mts, which refuses the
      // whole suite otherwise.
      SEED_EXPECT_HOST: new URL(process.env.DATABASE_URL ?? "").hostname,
      SEED_COMPANY_ID: companyId,
    },
    // The seed writes a few hundred rows across a couple of dozen tables.
    timeout: 240_000,
  });
}

beforeAll(async () => {
  const company = await prisma.company.create({
    data: { name: `seed-demo-counters ${Date.now()}` },
  });
  companyId = company.id;
  seedOutput = runSeed();
}, 300_000);

afterAll(async () => {
  // `--undo` removes only what the seed wrote; the company is this file's.
  if (companyId) {
    try {
      runSeed("--undo");
    } finally {
      // `--undo` deliberately KEEPS SafetyCaseCounter — it is a company-wide
      // high-water mark, and resetting it reissues a retired OSHA case number
      // (issue #148). It is a RESTRICT child of Company, so it blocks this
      // delete, which is the seed being right rather than anything being
      // wrong. Only a throwaway company created by this file is ever removed
      // here, so taking its counter with it costs nothing.
      await prisma.safetyCaseCounter.deleteMany({ where: { companyId } });
      await prisma.company.deleteMany({ where: { id: companyId } });
    }
  }
  await prisma.$disconnect();
}, 300_000);

/** Every per-job counter, with the delegate names it is read through.
 * `SafetyCaseCounter` is company-scoped and deliberately excluded — it is a
 * high-water mark across jobs and years (issue #148), and asking it a
 * per-job question has no meaning. */
const perJob = Object.entries(NUMBERED_TABLES).filter(([, t]) => t.scope === "job");

/**
 * The three delegate methods this file calls, by NAME rather than through
 * Prisma's generated types.
 *
 * The map is what makes the test general — every per-job counter gets the
 * same assertion, and a counter added tomorrow is covered the day somebody
 * declares it — and a name chosen at runtime cannot be typed by a client
 * whose types are per-model. Narrowed to the three signatures actually used
 * so this stays a hole of known size: `Function` would accept anything, and
 * the lint rule that refuses it is right.
 */
type CounterDelegate = {
  groupBy: (args: unknown) => Promise<Array<{ jobId: string | null; _max: Record<string, number | null> }>>;
  findUnique: (args: unknown) => Promise<Record<string, number | null> | null>;
  count: (args: unknown) => Promise<number>;
};
const delegate = (name: string): CounterDelegate =>
  (prisma as unknown as Record<string, CounterDelegate>)[name];

describe("the demo seed leaves the counters agreeing with the rows", () => {
  it("seeded, and said so", () => {
    // An empty question passes everything below it: if the seed refused —
    // wrong host, a company that already has demo data — every counter
    // assertion would hold vacuously over zero jobs.
    expect(seedOutput).toContain("seed: company");
    expect(companyId).not.toBe("");
  });

  it("created jobs to have counters for", async () => {
    const jobs = await prisma.job.count({ where: { companyId } });
    expect(jobs).toBeGreaterThan(0);
  });

  it.each(perJob)(
    "%s is at least the highest number the seed wrote, on every job it wrote one for",
    async (_counter, table) => {
      const rows = await delegate(table.accessor).groupBy({
        by: ["jobId"],
        where: { job: { companyId } },
        _max: { [table.numberField]: true },
      });

      const behind: string[] = [];
      for (const row of rows) {
        const highest = row._max[table.numberField];
        if (row.jobId == null || highest == null) continue;
        const counter = await delegate(table.counterAccessor).findUnique({
          where: { jobId: row.jobId },
        });
        const at = counter?.[table.counterField];
        if (at == null || at < highest) {
          behind.push(
            `job ${row.jobId}: rows go to ${table.numberField} ${highest}, ` +
              `${table.counterAccessor} is ${at ?? "MISSING"}`,
          );
        }
      }
      expect(
        behind,
        `The next number issued for these jobs is one the seed already used. The insert ` +
          `collides on the unique index and rolls the counter bump back with it, so it is ` +
          `not a one-off — it fails identically forever: ${behind.join("; ")}`,
      ).toEqual([]);
    },
  );

  it("issues an invoice number that actually inserts, on a seeded job", async () => {
    // THE HEADLINE, exercised end to end through the REAL issuer and the
    // real unique index rather than asserted about. This is the click that
    // was dead: a seeded job, "Create invoice", a number that has to be free.
    const job = await prisma.invoice
      .findFirst({
        where: { job: { companyId } },
        orderBy: { number: "desc" },
        select: { jobId: true, number: true },
      })
      .then((row) => row);
    expect(job, "the seed wrote no invoices, so this proves nothing").not.toBeNull();

    const created = await prisma.$transaction(async (tx) => {
      const number = await issueInvoiceNumber(tx, job!.jobId);
      return tx.invoice.create({
        data: {
          jobId: job!.jobId,
          number,
          description: "counter proof",
          amount: "1000",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          dueAt: new Date("2026-02-01T00:00:00.000Z"),
          status: "SUBMITTED",
        },
        select: { number: true },
      });
    });

    expect(created.number).toBe(job!.number + 1);

    // And again, because the defect's signature is that the SECOND attempt
    // fails the same way as the first — a counter that rolled back issues
    // the same number twice.
    const again = await prisma.$transaction(async (tx) => {
      const number = await issueInvoiceNumber(tx, job!.jobId);
      return tx.invoice.create({
        data: {
          jobId: job!.jobId,
          number,
          description: "counter proof 2",
          amount: "1000",
          issuedAt: new Date("2026-01-01T00:00:00.000Z"),
          dueAt: new Date("2026-02-01T00:00:00.000Z"),
          status: "SUBMITTED",
        },
        select: { number: true },
      });
    });
    expect(again.number).toBe(job!.number + 2);

    await prisma.invoice.deleteMany({
      where: { jobId: job!.jobId, number: { in: [created.number, again.number] } },
    });
  });

  it("can be undone and re-seeded, which is how the demo is rebuilt", async () => {
    // A counter is a RESTRICT child of Job that deleting the numbered rows
    // does NOT reach — #227's scar. If `--undo` missed one, the job delete
    // throws and the dataset is left half-removed; the next seed then
    // duplicates everything (issue #180). Proved by doing it.
    runSeed("--undo");
    for (const [, table] of perJob) {
      const left = await delegate(table.counterAccessor).count({
        where: { job: { companyId } },
      });
      expect(left, `${table.counterAccessor} rows survived --undo`).toBe(0);
    }
    expect(await prisma.job.count({ where: { companyId } })).toBe(0);

    seedOutput = runSeed();
    expect(await prisma.job.count({ where: { companyId } })).toBeGreaterThan(0);
  }, 300_000);
});
