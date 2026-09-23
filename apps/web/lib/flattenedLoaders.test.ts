/**
 * The two layout loaders whose nested reads were flattened for speed
 * (2026-09-18) must hand back the same shape the nested read did — every
 * child under the right parent, a null foreign key as null, and a parent
 * with nothing under it as an empty list. The arithmetic downstream reads
 * that shape and was not touched, so this is where a mis-grouping would
 * show up as a wrong figure on every page.
 *
 * A fake client, deliberately strict: every `where` key it does not
 * understand throws, so a loader that changes what it filters on fails here
 * instead of silently matching everything. (alerts-query's flattened job
 * read is covered against a real Postgres by alerts-query.dbtest.ts, which
 * exercises the retainage, closeout-handover and certified-payroll alerts
 * that read it.)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const calls: string[] = [];

function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (key === "job" && value && typeof value === "object") {
      const job = tables.job.find((j) => j.id === row.jobId);
      return !!job && matches(job, value as Row);
    }
    if (value && typeof value === "object" && "in" in value) return (value.in as unknown[]).includes(row[key]);
    if (key === "date" && value && typeof value === "object") return true;
    if (typeof value === "object" && value !== null) throw new Error(`fake: unsupported where ${key}`);
    return row[key] === value;
  });
}

function project(row: Row, select: Row): Row {
  const out: Row = {};
  for (const [key, spec] of Object.entries(select)) {
    if (spec === true) out[key] = row[key];
    else if (key === "costEntries") out[key] = tables.costEntry.filter((c) => c.lineItemId === row.id).map((c) => project(c, (spec as { select: Row }).select));
    else if (key === "unionLocal") out[key] = tables.unionLocal.find((u) => u.id === row.unionLocalId) ?? null;
    else throw new Error(`fake: unsupported select ${key}`);
  }
  return out;
}

function model(name: string) {
  return {
    findMany: async ({ where, select }: { where?: Row; select?: Row }) => {
      calls.push(name);
      const rows = (tables[name] ?? []).filter((row) => matches(row, where));
      return select ? rows.map((row) => project(row, select)) : rows;
    },
  };
}

vi.mock("@prova/db", () => ({
  Prisma: {},
  prisma: new Proxy({}, { get: (_target, name: string) => model(name) }),
}));

const { loadActiveJobCostRows } = await import("./company-financials-query");
const { loadRatioReviews } = await import("./union-compliance-query");

beforeEach(() => {
  calls.length = 0;
  for (const key of Object.keys(tables)) delete tables[key];
  Object.assign(tables, {
    job: [
      { id: "j1", companyId: "co", status: "IN_PROGRESS", name: "Riverside" },
      { id: "j2", companyId: "co", status: "CONTRACTED", name: "Harbor" },
      { id: "j3", companyId: "co", status: "COMPLETE", name: "Done" },
      { id: "jx", companyId: "other", status: "IN_PROGRESS", name: "Not ours" },
    ],
    jobLineItem: [
      { id: "l1", jobId: "j1", isDeleted: false, quantity: 1, unitPrice: 10 },
      { id: "l2", jobId: "j1", isDeleted: true, quantity: 1, unitPrice: 99 },
      { id: "l3", jobId: "jx", isDeleted: false, quantity: 1, unitPrice: 5 },
    ],
    costEntry: [
      { id: "c1", lineItemId: "l1", amount: 4 },
      { id: "c2", lineItemId: "l1", amount: 6 },
    ],
    timeEntry: [],
    invoice: [
      { id: "i1", jobId: "j2", amount: 100 },
      { id: "i2", jobId: "j3", amount: 999 },
    ],
  });
});

describe("loadActiveJobCostRows", () => {
  it("files every child under its own job, active jobs of this company only", async () => {
    const jobs = await loadActiveJobCostRows("co");
    expect(jobs).toHaveLength(2);
    const [riverside, harbor] = jobs;
    expect(riverside.lineItems.map((l) => l.id)).toEqual(["l1"]);
    expect(riverside.lineItems[0].costEntries.map((c) => c.amount)).toEqual([4, 6]);
    expect(riverside.invoices).toEqual([]);
    expect(harbor.lineItems).toEqual([]);
    expect(harbor.invoices.map((i) => i.amount)).toEqual([100]);
    expect(harbor.timeEntries).toEqual([]);
  });

  it("sends no child query for a company with no active job, as the nested read did", async () => {
    expect(await loadActiveJobCostRows("nobody")).toEqual([]);
    expect(calls).toEqual(["job"]);
  });
});

describe("loadRatioReviews", () => {
  beforeEach(() => {
    Object.assign(tables, {
      unionLocal: [{ id: "u1", parentInternational: "UBC", localNumber: "713", jurisdictionName: "Oakland" }],
      craftClassification: [
        { id: "k1", tier: "APPRENTICE", unionLocalId: "u1" },
        { id: "k2", tier: "JOURNEYMAN", unionLocalId: "u1" },
      ],
      user: [{ id: "usr1", name: "Ana Ruiz", email: "ana@example.com" }],
      crewMember: [{ id: "cm1", legalFirstName: "Luis", legalMiddleName: null, legalLastName: "Ortega" }],
      apprenticeRatioRule: [
        { unionLocalId: "u1", companyId: "co", apprenticeCount: 1, journeymenCount: 1, programStandardReference: null },
      ],
      timeEntry: [
        { id: "t1", jobId: "j1", date: new Date("2026-09-01T00:00:00Z"), hours: 8, craftClassificationId: "k1", employeeUserId: "usr1", crewMemberId: null },
        { id: "t2", jobId: "j1", date: new Date("2026-09-01T00:00:00Z"), hours: 8, craftClassificationId: "k2", employeeUserId: null, crewMemberId: "cm1" },
        { id: "t3", jobId: "j1", date: new Date("2026-09-01T00:00:00Z"), hours: 8, craftClassificationId: null, employeeUserId: "usr1", crewMemberId: null },
        { id: "t4", jobId: "j1", date: new Date("2026-09-01T00:00:00Z"), hours: 2, craftClassificationId: null, employeeUserId: null, crewMemberId: "cm1" },
      ],
    });
  });

  it("names each entry's job, local and worker, and leaves an untagged entry untagged", async () => {
    const reviews = await loadRatioReviews("co", "2026-09");
    expect(reviews).toHaveLength(1);
    const [review] = reviews;
    expect(review.jobName).toBe("Riverside");
    expect(review.unionLocalId).toBe("u1");
    expect(review.rule).toEqual({ apprenticeCount: 1, journeymenCount: 1, programStandardReference: null });
    // Tiers come through the craft lookup, so these two sums prove every
    // entry found its own craft; the untagged ones stay unclassified, and
    // their names prove the user and crew-member lookups.
    expect(review.days).toHaveLength(1);
    const [day] = review.days;
    expect(day.apprenticeHours).toBe(8);
    expect(day.journeymanHours).toBe(8);
    expect(day.unclassifiedHours).toBe(10);
    expect([...day.unclassifiedNames].sort()).toEqual(["Ana Ruiz", "Luis Ortega"]);
  });

  it("sends only the entry query when the month has no entries", async () => {
    tables.timeEntry = [];
    expect(await loadRatioReviews("co", "2026-09")).toEqual([]);
    expect(calls.sort()).toEqual(["apprenticeRatioRule", "timeEntry"]);
  });
});
