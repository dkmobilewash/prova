import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `loadPriceAnomalies` against a real Postgres.
 *
 * `price-anomalies.test.ts` owns the DECIDING — what counts as a typo, what
 * stays silent, which threshold applies. This owns the JOIN, and the join is
 * the half that can be wrong while every unit test passes:
 *
 *   A LINE'S HISTORY IS NOT ON ITS OWN JOB. It hangs off the catalog entry the
 *   line was created from, and that entry's history is every line made from it
 *   across every OTHER job. Scope that query to this job and the check compares
 *   the bid to itself — which always looks clean, because a line is never an
 *   outlier against itself.
 *
 * And it is the shape no fake can test: `catalogActuals` counts only FINISHED
 * jobs, so the fixture has to carry a complete job with real cost rows for any
 * figure to exist at all.
 */

vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { loadPriceAnomalies } = await import("./price-anomalies-query");

let companyId = "";
let otherCompanyId = "";
/** The job being priced. */
let bidJobId = "";
/** A finished job carrying the history. */
let doneJobId = "";
let entryId = "";
let contactId = "";

/** A line on a job, optionally costed. */
async function line(input: {
  jobId: string;
  description: string;
  quantity: string;
  unit?: string | null;
  budgetedUnitCost?: string | null;
  unitPrice?: string | null;
  sourceCatalogEntryId?: string | null;
  costEntry?: { amount: string; category: string } | null;
}) {
  const created = await prisma.jobLineItem.create({
    data: {
      jobId: input.jobId,
      description: input.description,
      quantity: input.quantity,
      unit: input.unit ?? "SF",
      budgetedUnitCost: input.budgetedUnitCost ?? null,
      unitPrice: input.unitPrice ?? null,
      sourceCatalogEntryId: input.sourceCatalogEntryId ?? null,
    },
    select: { id: true },
  });
  if (input.costEntry) {
    // A `CostEntry` hangs off the LINE, not the job — which is also why the
    // catalog's history query reaches costs through `jobLineItems` rather than
    // through a job.
    await prisma.costEntry.create({
      data: {
        lineItemId: created.id,
        description: "cost",
        amount: input.costEntry.amount,
        category: input.costEntry.category as never,
        incurredAt: new Date(Date.UTC(2026, 5, 1)),
      },
    });
  }
  return created;
}

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Price Anomaly Test Co" } });
  companyId = company.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  contactId = contact.id;

  const entry = await prisma.lineItemCatalogEntry.create({
    data: {
      companyId,
      description: '5/8" Type X board',
      unit: "SF",
      defaultBudgetedUnitCost: "2.85",
      costCategory: "MATERIAL",
    },
    select: { id: true },
  });
  entryId = entry.id;

  // THE HISTORY: two lines on a COMPLETE job, costed. `catalogActuals` counts
  // only finished jobs, and `CATALOG_MIN_SAMPLE` is 2 — so two is the smallest
  // fixture that can produce a drift finding at all.
  const done = await prisma.job.create({
    data: { companyId, contactId, name: "Finished Job", status: "COMPLETE" },
    select: { id: true },
  });
  doneJobId = done.id;
  // 1,000 SF at $2,850 and 500 SF at $1,425 — $2.85/SF either way.
  await line({
    jobId: doneJobId,
    description: '5/8" Type X board',
    quantity: "1000",
    sourceCatalogEntryId: entryId,
    costEntry: { amount: "2850", category: "MATERIAL" },
  });
  await line({
    jobId: doneJobId,
    description: '5/8" Type X board',
    quantity: "500",
    sourceCatalogEntryId: entryId,
    costEntry: { amount: "1425", category: "MATERIAL" },
  });

  const bid = await prisma.job.create({
    data: { companyId, contactId, name: "Live Bid", status: "ESTIMATE" },
    select: { id: true },
  });
  bidJobId = bid.id;

  const other = await prisma.company.create({ data: { name: "Other Anomaly Co" } });
  otherCompanyId = other.id;
});

afterAll(async () => {
  for (const id of [companyId, otherCompanyId]) {
    await prisma.costEntry.deleteMany({ where: { lineItem: { job: { companyId: id } } } });
    await prisma.jobLineItem.deleteMany({ where: { job: { companyId: id } } });
    await prisma.job.deleteMany({ where: { companyId: id } });
    await prisma.lineItemCatalogEntry.deleteMany({ where: { companyId: id } });
    await prisma.contact.deleteMany({ where: { companyId: id } });
    await prisma.company.delete({ where: { id } });
  }
  await prisma.$disconnect();
});

describe("history is read across OTHER jobs, not this one", () => {
  it("finds the typo on the live bid from a finished job's costs", async () => {
    // $28.50 against the $2.85 the finished job actually cost. If the query
    // scoped history to this job, there would be no history and no finding —
    // which is the failure that always looks clean.
    const typo = await line({
      jobId: bidJobId,
      description: '5/8" Type X board',
      quantity: "800",
      budgetedUnitCost: "28.50",
      sourceCatalogEntryId: entryId,
    });

    const report = await loadPriceAnomalies(bidJobId, companyId);
    const found = report.anomalies.find((anomaly) => anomaly.lineId === typo.id);
    expect(found, "the typo was not found — history was probably scoped to this job").toBeDefined();
    expect(found?.kind).toBe("TYPED_WRONG");
    expect(found?.sentence).toContain("$2.85");
    // TWO finished lines, which is the sample after the exclusions.
    expect(found?.sentence).toContain("2 finished jobs");

    await prisma.jobLineItem.delete({ where: { id: typo.id } });
  });

  it("counts a hand-typed line as unchecked rather than inventing history for it", async () => {
    const typed = await line({
      jobId: bidJobId,
      description: "Hand-typed patching",
      quantity: "10",
      budgetedUnitCost: "999",
      sourceCatalogEntryId: null,
    });
    const report = await loadPriceAnomalies(bidJobId, companyId);
    expect(report.anomalies.some((a) => a.lineId === typed.id)).toBe(false);
    expect(report.unchecked).toBeGreaterThanOrEqual(1);
    await prisma.jobLineItem.delete({ where: { id: typed.id } });
  });

  it("reports drift at the real percentage", async () => {
    const drift = await line({
      jobId: bidJobId,
      description: '5/8" Type X board',
      quantity: "800",
      budgetedUnitCost: "3.40",
      sourceCatalogEntryId: entryId,
    });
    const report = await loadPriceAnomalies(bidJobId, companyId);
    const found = report.anomalies.find((anomaly) => anomaly.lineId === drift.id);
    expect(found?.kind).toBe("COST_DRIFT");
    expect(found?.sentence).toContain("19%");
    await prisma.jobLineItem.delete({ where: { id: drift.id } });
  });

  it("flags a unit that disagrees with the catalog entry's own", async () => {
    const wrongUnit = await line({
      jobId: bidJobId,
      description: '5/8" Type X board',
      quantity: "800",
      unit: "LF",
      budgetedUnitCost: "2.85",
      sourceCatalogEntryId: entryId,
    });
    const report = await loadPriceAnomalies(bidJobId, companyId);
    const found = report.anomalies.find((anomaly) => anomaly.lineId === wrongUnit.id);
    expect(found?.kind).toBe("UNIT_MISMATCH");
    await prisma.jobLineItem.delete({ where: { id: wrongUnit.id } });
  });

  it("says nothing about a correctly priced line", async () => {
    const fine = await line({
      jobId: bidJobId,
      description: '5/8" Type X board',
      quantity: "800",
      budgetedUnitCost: "2.90",
      sourceCatalogEntryId: entryId,
    });
    const report = await loadPriceAnomalies(bidJobId, companyId);
    expect(report.anomalies.some((a) => a.lineId === fine.id)).toBe(false);
    // Still COUNTED as checked — that is the difference between "fine" and
    // "not looked at".
    expect(report.checked).toBeGreaterThanOrEqual(1);
    await prisma.jobLineItem.delete({ where: { id: fine.id } });
  });

  it("ignores a DELETED line", async () => {
    const gone = await line({
      jobId: bidJobId,
      description: '5/8" Type X board',
      quantity: "800",
      budgetedUnitCost: "28.50",
      sourceCatalogEntryId: entryId,
    });
    await prisma.jobLineItem.update({ where: { id: gone.id } , data: { isDeleted: true } });
    const report = await loadPriceAnomalies(bidJobId, companyId);
    expect(report.anomalies.some((a) => a.lineId === gone.id)).toBe(false);
    await prisma.jobLineItem.delete({ where: { id: gone.id } });
  });
});

describe("an unfinished job contributes no history", () => {
  it("leaves a line unchecked when the only costed job is still running", async () => {
    // `catalogActuals` counts COMPLETE jobs only — "only a finished job's cost
    // is a real unit cost". A fresh entry whose history is all in flight must
    // therefore produce no figure, and the line must read as unchecked rather
    // than as fine.
    const freshEntry = await prisma.lineItemCatalogEntry.create({
      data: { companyId, description: "Taping", unit: "SF", defaultBudgetedUnitCost: "0.60", costCategory: "LABOR" },
      select: { id: true },
    });
    const running = await prisma.job.create({
      data: { companyId, contactId, name: "Still Running", status: "IN_PROGRESS" },
      select: { id: true },
    });
    await line({
      jobId: running.id,
      description: "Taping",
      quantity: "1000",
      sourceCatalogEntryId: freshEntry.id,
      costEntry: { amount: "600", category: "MATERIAL" },
    });
    const live = await line({
      jobId: bidJobId,
      description: "Taping",
      quantity: "900",
      budgetedUnitCost: "6.00",
      sourceCatalogEntryId: freshEntry.id,
    });

    const report = await loadPriceAnomalies(bidJobId, companyId);
    expect(report.anomalies.some((a) => a.lineId === live.id)).toBe(false);
    expect(report.unchecked).toBeGreaterThanOrEqual(1);

    await prisma.jobLineItem.delete({ where: { id: live.id } });
    await prisma.costEntry.deleteMany({ where: { lineItem: { jobId: running.id } } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: running.id } });
    await prisma.job.delete({ where: { id: running.id } });
    await prisma.lineItemCatalogEntry.delete({ where: { id: freshEntry.id } });
  });
});

describe("another company's history is unreachable", () => {
  it("returns nothing for a job belonging to someone else", async () => {
    const report = await loadPriceAnomalies(bidJobId, otherCompanyId);
    expect(report).toEqual({ anomalies: [], checked: 0, unchecked: 0 });
  });

  it("reads our own job correctly when asked as us, which is the control", async () => {
    // Without this, the assertion above would pass on a query that always
    // returns nothing.
    const typo = await line({
      jobId: bidJobId,
      description: '5/8" Type X board',
      quantity: "800",
      budgetedUnitCost: "28.50",
      sourceCatalogEntryId: entryId,
    });
    const report = await loadPriceAnomalies(bidJobId, companyId);
    expect(report.anomalies.some((a) => a.lineId === typo.id)).toBe(true);
    await prisma.jobLineItem.delete({ where: { id: typo.id } });
  });
});
