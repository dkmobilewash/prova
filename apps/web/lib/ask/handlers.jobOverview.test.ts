import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "@/lib/permissions";

/**
 * job_overview — one job, composed from the tools that answer each part in
 * detail, each section gated before it is read.
 *
 * The fake HONOURS the where clause on every model it serves, and the other
 * company has a job with the SAME NAME and its own RFIs, punch items and
 * invoices. A section whose query lost `companyId` therefore reports the
 * other tenant's counts (or finds two Riversides) and goes red. Reads are
 * counted per model, so a section read for somebody who may not see it —
 * rather than never read — also goes red.
 */

type Where = Record<string, unknown>;
function matches(row: Record<string, unknown>, where: Where | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, want]) => {
    if (key === "OR") return (want as Where[]).some((branch) => matches(row, branch));
    const have = row[key];
    if (want !== null && typeof want === "object" && !(want instanceof Date)) {
      const op = want as { contains?: string; equals?: string; in?: unknown[]; not?: unknown };
      if (op.contains !== undefined) return String(have ?? "").toLowerCase().includes(op.contains.toLowerCase());
      if (op.equals !== undefined) return String(have ?? "").toLowerCase() === op.equals.toLowerCase();
      if (op.in !== undefined) return op.in.includes(have);
      if ("not" in op) return have !== op.not;
      return false;
    }
    return have === want;
  });
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const job = (id: string, companyId: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  companyId,
  name,
  status: "IN_PROGRESS",
  startDate: day("2026-08-01"),
  endDate: day("2026-12-01"),
  createdAt: day("2026-07-01"),
  contact: { name: companyId === "co-1" ? "Turner" : "Other GC", paymentTermsDays: 30 },
  lineItems: [
    {
      id: `${id}-l1`,
      description: "Board",
      quantity: 10,
      unitPrice: companyId === "co-1" ? 100 : 999,
      budgetedUnitCost: 60,
      currentEstimatedUnitCost: null,
      estimatedCostToComplete: null,
      isDeleted: false,
      costEntries: [],
    },
  ],
  invoices: [{ amount: companyId === "co-1" ? 400 : 9999 }],
  timeEntries: [],
  changeOrders: [
    { number: 1, title: "Extra soffit", status: "SUBMITTED", submittedOn: day("2026-09-01"), decidedOn: null, proposals: [] },
  ],
  ...over,
});

const JOBS = [job("j1", "co-1", "Riverside"), job("j2", "co-2", "Riverside"), job("j3", "co-1", "Maple", { status: "ESTIMATE" })];
const RFIS = [
  { companyId: "co-1", status: "SENT", number: 4, subject: "Door schedule", sentOn: day("2026-09-01"), dueBy: day("2026-09-08"), job: { name: "Riverside", contact: { name: "Turner" } } },
  { companyId: "co-2", status: "SENT", number: 9, subject: "Leak", sentOn: day("2026-09-01"), dueBy: null, job: { name: "Riverside", contact: { name: "Other GC" } } },
  { companyId: "co-2", status: "SENT", number: 10, subject: "Leak 2", sentOn: day("2026-09-01"), dueBy: null, job: { name: "Riverside", contact: { name: "Other GC" } } },
];
// `status: "OPEN"` is what these rows carried as `isDone: false` until
// 20260920030000 dropped that column — the same set, said once.
const PUNCH = [
  { companyId: "co-1", status: "OPEN", description: "Patch 2B", createdAt: day("2026-09-10"), job: { name: "Riverside" }, raisedBy: null },
  { companyId: "co-1", status: "OPEN", description: "Patch 3A", createdAt: day("2026-09-10"), job: { name: "Riverside" }, raisedBy: null },
  { companyId: "co-2", status: "OPEN", description: "Other", createdAt: day("2026-09-10"), job: { name: "Riverside" }, raisedBy: null },
];

const reads: Record<string, number> = {};
const served = <T extends Record<string, unknown>>(model: string, rows: T[]) => ({
  findMany: vi.fn(async (args: { where?: Where; select?: Record<string, unknown> } = {}) => {
    reads[model] = (reads[model] ?? 0) + 1;
    // The two money reads (job_margin's and change_order_status's) are the
    // only job reads that select invoices or change orders.
    if (args.select?.invoices || args.select?.changeOrders) reads.jobMoney = (reads.jobMoney ?? 0) + 1;
    return rows.filter((row) => matches(row, args.where));
  }),
  findFirst: vi.fn(async (args: { where?: Where } = {}) => {
    reads[model] = (reads[model] ?? 0) + 1;
    return rows.find((row) => matches(row, args.where)) ?? null;
  }),
});

vi.mock("@prova/db", async (importOriginal) => ({
  Prisma: (await importOriginal<typeof import("@prova/db")>()).Prisma,
  prisma: {
    job: served("job", JOBS),
    rfi: served("rfi", RFIS),
    punchListItem: served("punchListItem", PUNCH),
  },
}));
vi.mock("@/lib/fringe-schedules-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fringe-schedules-query")>()),
  loadFringeSchedulesByCraft: async () => new Map(),
}));
vi.mock("@/lib/serverToday", () => ({ serverToday: () => "2026-09-18" }));
vi.mock("@/lib/viewerToday", () => ({ viewerToday: async () => "2026-09-18", viewerTimeZone: async () => "UTC" }));

const { runTool } = await import("./handlers");

const OWNER: Principal = { role: "OWNER", jobFunction: null };
const FIELD: Principal = { role: "MEMBER", jobFunction: "FIELD" };

type Overview = {
  job: string;
  gc: string;
  status: string;
  money: { contractValue: number; billedToDate: number } | string | null;
  openRfis: number | null;
  rfisPastResponseDate: number | null;
  openPunchItems: number | null;
  changeOrders: { total: number; pending: number; awaitingGc: number } | null;
  withheldFromYou: string[];
};

beforeEach(() => {
  for (const key of Object.keys(reads)) delete reads[key];
});

describe("job_overview", () => {
  it("summarises ONE job from this company — never the other tenant's Riverside", async () => {
    const result = await runTool({ companyId: "co-1", principal: OWNER }, "job_overview", { jobName: "riverside" });
    expect(result.unavailable).toBeUndefined();
    const data = result.data as Overview;
    expect(data).toMatchObject({ job: "Riverside", gc: "Turner", status: "IN_PROGRESS" });
    expect(data.money).toMatchObject({ contractValue: 1000, billedToDate: 400 });
    expect(data.openRfis).toBe(1);
    expect(data.rfisPastResponseDate).toBe(1);
    expect(data.openPunchItems).toBe(2);
    expect(data.changeOrders).toEqual({ total: 1, pending: 1, awaitingGc: 1 });
    expect(reads.jobMoney).toBe(2);
    expect(data.withheldFromYou).toEqual([]);
    expect(result.citations.map((c) => c.href)).toContain("/jobs");
  });

  it("withholds the money for a foreman WITHOUT reading it, and says it was withheld rather than zero", async () => {
    const result = await runTool({ companyId: "co-1", principal: FIELD }, "job_overview", { jobName: "Riverside" });
    const data = result.data as Overview;
    expect(data.money).toBeNull();
    expect(data.changeOrders).toBeNull();
    expect(data.withheldFromYou.join(" ")).toMatch(/contract value/);
    // FIELD holds MANAGE_FIELD and MANAGE_JOBS, so those two sections stay.
    expect(data.openPunchItems).toBe(2);
    expect(data.openRfis).toBe(1);
    // Neither money read ran at all — refused before reading.
    expect(reads.jobMoney).toBeUndefined();
  });

  it("withholds everything gated for somebody holding none of it", async () => {
    const accounting: Principal = { role: "MEMBER", jobFunction: "ACCOUNTING" };
    const result = await runTool({ companyId: "co-1", principal: accounting }, "job_overview", { jobName: "Riverside" });
    const data = result.data as Overview;
    expect(data.openRfis).toBeNull();
    expect(data.openPunchItems).toBeNull();
    expect(reads.rfi).toBeUndefined();
    expect(reads.punchListItem).toBeUndefined();
  });

  it("says when no job matches, asks when none was named, and says so for a job with nothing costed", async () => {
    expect((await runTool({ companyId: "co-1", principal: OWNER }, "job_overview", { jobName: "Cedar" })).unavailable).toBe(
      'No job matches "Cedar".',
    );
    expect((await runTool({ companyId: "co-1", principal: OWNER }, "job_overview", {})).unavailable).toBe("Say which job.");
    const estimate = await runTool({ companyId: "co-1", principal: OWNER }, "job_overview", { jobName: "Maple" });
    expect((estimate.data as Overview).money).toMatch(/only contracted and in-progress/);
    expect((estimate.data as Overview).openRfis).toBe(0);
  });
});
