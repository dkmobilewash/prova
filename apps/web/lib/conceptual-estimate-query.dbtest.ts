import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `loadConceptualBenchmark` and `countFinishedJobsWithoutArea` against a real
 * Postgres.
 *
 * `conceptual-estimate.test.ts` covers the DECIDING with hand-written inputs.
 * This file covers what nothing else executes, and what a unit test cannot see:
 *
 *   - the WHERE clause. "COMPLETE, and carrying a gross area" is the entire
 *     honesty of the feature — a running job has spent a fifth of its cost and
 *     earned none of its lessons, and averaging it in makes the figure read
 *     better the more work is in progress. A query that let one through would
 *     still produce a plausible $/SF.
 *   - the TENANT filter. This is the most quotable number the product makes,
 *     and a `companyId` missing from either query would price one contractor's
 *     bid off another's finished work.
 *   - the Decimal conversion. `grossAreaSqFt` arrives as a Prisma Decimal and
 *     has to come out as the number the pure module divides by; `Number()` on a
 *     Decimal object that was never converted is `NaN`, which propagates
 *     silently through every average.
 *
 * Three finished jobs is the module's floor (`MINIMUM_SAMPLE`), so the fixture
 * builds exactly three usable ones and then adds every kind of job that must
 * NOT count — a fourth that is still running, a fifth with no area, and a sixth
 * on another company — so "three" is the answer that proves each exclusion.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadConceptualBenchmark, countFinishedJobsWithoutArea } = await import("./conceptual-estimate-query");

let companyId = "";
let otherCompanyId = "";

/** One finished job worth `sell` over `area` square feet, having cost `cost`.
 * Sell is a single line item's extension; cost is one cost entry against it,
 * which is the pair `calculateJobWip` reads as contract value and actual cost. */
async function finishedJob(input: {
  company: string;
  contactId: string;
  name: string;
  area: number | null;
  sell: number;
  cost: number;
  status?: "COMPLETE" | "IN_PROGRESS";
}) {
  const job = await prisma.job.create({
    data: {
      companyId: input.company,
      contactId: input.contactId,
      name: input.name,
      status: input.status ?? "COMPLETE",
      grossAreaSqFt: input.area === null ? null : input.area.toFixed(2),
    },
  });
  const line = await prisma.jobLineItem.create({
    data: { jobId: job.id, description: "Drywall", quantity: "1", unitPrice: input.sell.toFixed(2) },
  });
  // CostEntry hangs off the LINE ITEM, not the job — there is no companyId on
  // it, which is also why the teardown reaches it through the line item.
  await prisma.costEntry.create({
    data: {
      lineItemId: line.id,
      category: "MATERIAL",
      amount: input.cost.toFixed(2),
      incurredAt: new Date("2026-06-01T00:00:00.000Z"),
      description: "Board",
    },
  });
  return job;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Conceptual Test Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });

  const other = await prisma.company.create({ data: { name: "Conceptual Other Co" } });
  otherCompanyId = other.id;
  const otherContact = await prisma.contact.create({ data: { companyId: otherCompanyId, name: "Their GC" } });

  // THE THREE THAT COUNT. $10/SF, $20/SF, $30/SF sold; half of each as cost,
  // so the cost range is exactly half the sell range and the gap between them
  // is the margin those jobs carried.
  await finishedJob({ company: companyId, contactId: contact.id, name: "Finished A", area: 1000, sell: 10_000, cost: 5_000 });
  await finishedJob({ company: companyId, contactId: contact.id, name: "Finished B", area: 1000, sell: 20_000, cost: 10_000 });
  await finishedJob({ company: companyId, contactId: contact.id, name: "Finished C", area: 1000, sell: 30_000, cost: 15_000 });

  // A RUNNING JOB, priced far above all of them. If the status filter leaked,
  // the high end of the range would move and nothing on screen would say why.
  await finishedJob({
    company: companyId,
    contactId: contact.id,
    name: "Still running",
    area: 1000,
    sell: 900_000,
    cost: 400_000,
    status: "IN_PROGRESS",
  });

  // FINISHED, NO AREA — contributes nothing, and is COUNTED so the screen can
  // tell "you have finished nothing" from "you have recorded no areas".
  await finishedJob({ company: companyId, contactId: contact.id, name: "No area", area: null, sell: 50_000, cost: 25_000 });

  // ANOTHER COMPANY'S finished work, at a wildly different rate.
  await finishedJob({
    company: otherCompanyId,
    contactId: otherContact.id,
    name: "Their finished job",
    area: 1000,
    sell: 500_000,
    cost: 100_000,
  });
});

afterAll(async () => {
  for (const id of [companyId, otherCompanyId]) {
    await prisma.costEntry.deleteMany({ where: { lineItem: { job: { companyId: id } } } });
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId: id } } });
    await prisma.job.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("loadConceptualBenchmark against a real database", () => {
  it("counts only this company's finished jobs that carry an area", async () => {
    const benchmark = await loadConceptualBenchmark(companyId);
    // Six jobs exist across two companies; exactly three qualify.
    expect(benchmark.sampleSize).toBe(3);
    expect(benchmark.because).toBeNull();
  });

  it("turns the Decimal area into the number the rate is divided by", async () => {
    const benchmark = await loadConceptualBenchmark(companyId);
    // $10, $20 and $30 per square foot over 1,000 SF each — arithmetic this
    // file supplied. A Decimal that never became a number would make these NaN.
    expect(benchmark.sellPerSqFt?.low).toBe(10);
    expect(benchmark.sellPerSqFt?.median).toBe(20);
    expect(benchmark.sellPerSqFt?.high).toBe(30);
    expect(Number.isNaN(benchmark.sellPerSqFt?.median ?? NaN)).toBe(false);
  });

  it("reads cost from the same place the WIP schedule does", async () => {
    const benchmark = await loadConceptualBenchmark(companyId);
    // Half of each sell figure, entered as one cost entry per job.
    expect(benchmark.costPerSqFt?.low).toBe(5);
    expect(benchmark.costPerSqFt?.median).toBe(10);
    expect(benchmark.costPerSqFt?.high).toBe(15);
  });

  it("leaves the running job out, whatever it is priced at", async () => {
    const benchmark = await loadConceptualBenchmark(companyId);
    // The running job sells at $900/SF. Its presence anywhere in the range
    // would be the status filter leaking.
    expect(benchmark.sellPerSqFt?.high).toBe(30);
  });

  it("never reaches another company's finished work", async () => {
    const theirs = await loadConceptualBenchmark(otherCompanyId);
    // One qualifying job on that company, which is below the floor — so it
    // gets the reason and no range at all.
    expect(theirs.sampleSize).toBe(1);
    expect(theirs.sellPerSqFt).toBeNull();
    expect(theirs.because).toMatch(/Only 1 finished job carries a gross area/);

    // And ours is unmoved by theirs at $500/SF.
    const ours = await loadConceptualBenchmark(companyId);
    expect(ours.sellPerSqFt?.high).toBe(30);
  });
});

describe("countFinishedJobsWithoutArea against a real database", () => {
  it("counts this company's finished jobs with no area on them", async () => {
    expect(await countFinishedJobsWithoutArea(companyId)).toBe(1);
  });

  it("is scoped to the company", async () => {
    expect(await countFinishedJobsWithoutArea(otherCompanyId)).toBe(0);
  });
});
