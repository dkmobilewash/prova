import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { EXPORT_DATASETS } from "./export";

/**
 * The export, executed against a real database.
 *
 * `export.test.ts` proves the CSV encoding and that no credential column is
 * on the allowlist. It cannot prove the queries RUN: the route looks the
 * Prisma delegate up by name through an `unknown` cast, so a wrong model
 * name, a column that is not selectable, or a relation that does not exist
 * in a `scope` all typecheck perfectly and throw at request time — on the
 * one feature that must not fail, because somebody is using it to leave.
 *
 * Run it against a scratch database:
 *
 *   DATABASE_URL=postgresql://... DIRECT_URL=$DATABASE_URL \
 *     pnpm --filter @prova/web exec vitest run --config vitest.db.config.ts
 *
 * The second assertion is the important one. Several of these models carry
 * no companyId and reach it through a relation — a Payment through its
 * Invoice through its Job. Get one of those wrong and the export hands a
 * customer another company's rows, which is the worst possible bug in a
 * feature whose entire job is handing over data. So this builds TWO
 * companies with overlapping-looking data and insists each export sees only
 * its own.
 */

type Delegate = {
  findMany: (args: unknown) => Promise<Record<string, unknown>[]>;
  count: (args: unknown) => Promise<number>;
};

const delegateFor = (model: string) =>
  (prisma as unknown as Record<string, Delegate>)[model];

const mine = { companyId: "", jobId: "", userId: "", lineItemId: "", invoiceId: "" };
const theirs = { companyId: "", jobId: "", userId: "", lineItemId: "", invoiceId: "" };

async function buildCompany(label: string, into: typeof mine) {
  const company = await prisma.company.create({ data: { name: `${label} ${Date.now()}` } });
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      clerkId: `test_${label}_${Date.now()}`,
      email: `${label}_${Date.now()}@example.test`,
      role: "OWNER",
    },
  });
  const contact = await prisma.contact.create({
    data: { companyId: company.id, name: `${label} GC` },
  });
  const job = await prisma.job.create({
    data: { companyId: company.id, contactId: contact.id, name: `${label} job` },
  });
  const lineItem = await prisma.jobLineItem.create({
    data: { jobId: job.id, description: `${label} drywall`, quantity: 100, unit: "sq ft" },
  });
  const invoice = await prisma.invoice.create({
    data: { jobId: job.id, number: 1, amount: 1000, issuedAt: new Date() },
  });
  await prisma.payment.create({
    data: { invoiceId: invoice.id, amount: 500, receivedAt: new Date() },
  });
  await prisma.costEntry.create({
    data: { lineItemId: lineItem.id, description: `${label} cost`, amount: 250, incurredAt: new Date() },
  });
  await prisma.invoiceLineItem.create({
    data: { invoiceId: invoice.id, lineItemId: lineItem.id, thisPeriodBilled: 1000 },
  });
  await prisma.timeEntry.create({
    data: { jobId: job.id, employeeUserId: user.id, date: new Date(), hours: 8 },
  });

  into.companyId = company.id;
  into.jobId = job.id;
  into.userId = user.id;
  into.lineItemId = lineItem.id;
  into.invoiceId = invoice.id;
}

/* Hooks live at the TOP LEVEL, not inside the first describe.

   They were inside it first, and vitest runs a describe's afterAll before
   the NEXT describe starts — so the isolation block below ran against a
   database this file had just emptied. Every assertion in it passed, on no
   rows at all. That is why the "returns MY rows" test exists beside the
   isolation test: an empty result satisfies "contains no other company's
   data" perfectly, and only a non-vacuity check tells the two apart. */
beforeAll(async () => {
  await buildCompany("mine", mine);
  await buildCompany("theirs", theirs);
});

afterAll(async () => {
  for (const c of [mine, theirs]) {
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { jobId: c.jobId } } });
    await prisma.payment.deleteMany({ where: { invoice: { jobId: c.jobId } } });
    await prisma.costEntry.deleteMany({ where: { lineItem: { jobId: c.jobId } } });
    await prisma.timeEntry.deleteMany({ where: { jobId: c.jobId } });
    await prisma.invoice.deleteMany({ where: { jobId: c.jobId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: c.jobId } });
    await prisma.job.deleteMany({ where: { companyId: c.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: c.companyId } });
    await prisma.user.deleteMany({ where: { companyId: c.companyId } });
    await prisma.company.delete({ where: { id: c.companyId } });
  }
  await prisma.$disconnect();
});


describe("every export query runs against a real schema", () => {
  // One test per dataset rather than a loop with one assertion: a failure
  // then names the dataset that is broken instead of "the export".
  for (const dataset of EXPORT_DATASETS) {
    it(`${dataset.key}: the model, every column and the scope all resolve`, async () => {
      const delegate = delegateFor(dataset.model);
      expect(delegate, `prisma.${dataset.model} exists`).toBeDefined();

      const select = Object.fromEntries(dataset.columns.map((c) => [c, true]));
      const rows = await delegate.findMany({
        where: dataset.scope(mine.companyId),
        select,
      });
      expect(Array.isArray(rows)).toBe(true);

      // The page shows a count beside every table before anything is
      // downloaded. If count and findMany disagreed about scope, the number
      // on screen would be a promise the file does not keep.
      const counted = await delegate.count({ where: dataset.scope(mine.companyId) });
      expect(counted).toBe(rows.length);
    });
  }
});

describe("an export contains one company and no other", () => {
  it("returns MY rows for the datasets that were seeded", async () => {
    // Proves the scoping is not vacuous — a `where` that matched nothing
    // would pass the isolation test below while exporting an empty file.
    for (const key of ["jobs", "job-line-items", "invoices", "payments", "cost-entries", "time-entries", "contacts"]) {
      const dataset = EXPORT_DATASETS.find((d) => d.key === key)!;
      const rows = await delegateFor(dataset.model).findMany({
        where: dataset.scope(mine.companyId),
        select: Object.fromEntries(dataset.columns.map((c) => [c, true])),
      });
      expect(rows.length, `${key} has my row`).toBeGreaterThan(0);
    }
  });

  it("NEVER returns the other company's rows, including through a relation", async () => {
    // Payment and InvoiceLineItem reach companyId only through
    // Invoice -> Job, and CostEntry only through JobLineItem -> Job. Those
    // are the three that a plain `{ companyId }` would have silently
    // exported for everybody.
    const theirIds = new Set(
      [theirs.jobId, theirs.lineItemId, theirs.invoiceId, theirs.userId, theirs.companyId],
    );

    for (const dataset of EXPORT_DATASETS) {
      const rows = await delegateFor(dataset.model).findMany({
        where: dataset.scope(mine.companyId),
        select: Object.fromEntries(dataset.columns.map((c) => [c, true])),
      });
      for (const row of rows) {
        for (const [column, value] of Object.entries(row)) {
          expect(
            typeof value === "string" && theirIds.has(value),
            `${dataset.key}.${column} leaked another company's id`,
          ).toBe(false);
        }
      }
    }
  });
});
