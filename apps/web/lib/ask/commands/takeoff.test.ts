import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * run_takeoff and post_takeoff_to_estimate against a fake Prisma, a fake
 * wall-sheet list and a fake startPlanIngest. Pinned: the card states the
 * sheet count and the allowance BEFORE anything starts; resolve never
 * starts a run; the tap calls the same startPlanIngest(plan, "WALLS") the
 * button does and records the run as its target (which is what the
 * TAKEOFF_RUN_DONE alert reads); the post card ticks one sheet's unposted
 * rows and nothing else.
 */
const fake = vi.hoisted(() => ({
  prisma: {
    job: { findMany: vi.fn(), findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
    takeoffPlan: { findFirst: vi.fn() },
    planIngestJob: { findFirst: vi.fn() },
    takeoffMeasurement: { findMany: vi.fn() },
  },
  startPlanIngest: vi.fn(),
  wallsSheetsFor: vi.fn(),
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/planIngest", () => ({ startPlanIngest: fake.startPlanIngest }));
vi.mock("@/lib/plan-ingest/walls", () => ({
  wallsSheetsFor: fake.wallsSheetsFor,
  wallsTaskPages: (sheets: number[]) => sheets,
}));
vi.mock("../allowance", () => ({ allowanceSummary: async () => ({ planSheetsLeft: 1340 }) }));

const { runTakeoffCommand, postTakeoffToEstimateCommand } = await import("./takeoff");

const ctx = { companyId: "co-1", userId: "u-1", principal: { role: "OWNER", jobFunction: null }, today: "2026-11-04" } as const;
const wv = { id: "job-1", name: "Washington Village", status: "ESTIMATE", contact: { name: "WV GC" } };

beforeEach(() => {
  fake.prisma.job.findMany.mockReset().mockResolvedValue([wv]);
  fake.prisma.job.findFirst.mockReset().mockResolvedValue({ status: "ESTIMATE" });
  fake.prisma.company.findUnique.mockReset().mockResolvedValue({ wholeSetTakeoffOn: true });
  fake.prisma.takeoffPlan.findFirst.mockReset().mockResolvedValue({ id: "plan-1", fileName: "WV permit set.pdf" });
  fake.prisma.planIngestJob.findFirst.mockReset().mockResolvedValue(null);
  fake.prisma.takeoffMeasurement.findMany.mockReset();
  fake.startPlanIngest.mockReset().mockResolvedValue({ ok: true, value: { jobId: "run-9", stage: "WALLS" } });
  fake.wallsSheetsFor.mockReset().mockResolvedValue([3, 4, 5, 6]);
});

describe("run_takeoff", () => {
  it("is DIRECT over startPlanIngest on VIEW_JOB_COSTS, the capability the action checks", () => {
    expect(runTakeoffCommand.mode).toBe("DIRECT");
    expect(runTakeoffCommand.core).toBe("startPlanIngest");
    expect(runTakeoffCommand.capability).toBe("VIEW_JOB_COSTS");
  });

  it("shows the sheet count and the allowance on the card, and starts nothing while resolving", async () => {
    const result = await runTakeoffCommand.resolve(ctx, { jobName: "Washington Village" });
    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.resolved).toEqual({ jobId: "job-1", jobName: "Washington Village", planId: "plan-1", sheets: 4 });
    expect(result.preview.find((l) => l.label === "Sheets")?.value).toMatch(/^4 floor plans/);
    // WALLS spends nothing (STAGE_SPENDS), and the card says so with the balance.
    expect(result.preview.find((l) => l.label === "Allowance")?.value).toMatch(/none .*1340 plan sheets left/);
    expect(fake.startPlanIngest).not.toHaveBeenCalled();
  });

  it("the tap starts the WALLS run and names it as the card's target", async () => {
    const done = await runTakeoffCommand.execute(ctx, { jobId: "job-1", jobName: "Washington Village", planId: "plan-1", sheets: 4 });
    expect(fake.startPlanIngest).toHaveBeenCalledWith("plan-1", "WALLS");
    if (!done.ok) throw new Error(done.error);
    expect(done.message).toMatch(/Started.*alert/);
    expect(done.created).toMatchObject({ targetType: "PlanIngestJob", targetId: "run-9", href: "/jobs/job-1/takeoff" });
  });

  it("carries the action's own refusal to the card", async () => {
    fake.startPlanIngest.mockResolvedValue({ ok: false, error: "That plan set could not be found." });
    const done = await runTakeoffCommand.execute(ctx, { jobId: "job-1", jobName: "Washington Village", planId: "plan-1", sheets: 4 });
    expect(done).toEqual({ ok: false, error: "That plan set could not be found." });
  });

  it("refuses when the switch is off, when no floor plan has a scale, and past estimating", async () => {
    fake.prisma.company.findUnique.mockResolvedValueOnce({ wholeSetTakeoffOn: false });
    expect((await runTakeoffCommand.resolve(ctx, { jobName: "Washington Village" })).kind).toBe("refuse");
    fake.wallsSheetsFor.mockResolvedValueOnce([]);
    expect((await runTakeoffCommand.resolve(ctx, { jobName: "Washington Village" })).kind).toBe("refuse");
    fake.prisma.job.findFirst.mockResolvedValueOnce({ status: "IN_PROGRESS" });
    expect((await runTakeoffCommand.resolve(ctx, { jobName: "Washington Village" })).kind).toBe("refuse");
  });

  it("links to a run already going instead of offering a second", async () => {
    fake.prisma.planIngestJob.findFirst.mockResolvedValue({ id: "run-1" });
    const result = await runTakeoffCommand.resolve(ctx, { jobName: "Washington Village" });
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.existing?.label).toMatch(/already going/);
  });
});

describe("post_takeoff_to_estimate", () => {
  const rows = [
    { id: "m-1", page: { id: "p-3", pageNumber: 3, label: "A101" } },
    { id: "m-2", page: { id: "p-3", pageNumber: 3, label: "A101" } },
    { id: "m-3", page: { id: "p-4", pageNumber: 4, label: "A102" } },
  ];

  it("is a HANDOFF to the takeoff tab", () => {
    expect(postTakeoffToEstimateCommand.mode).toBe("HANDOFF");
    expect(postTakeoffToEstimateCommand.handoffHref("card", { jobId: "job-1" })).toBe("/jobs/job-1/takeoff?draft=card");
  });

  it("counts everything unposted and ticks the first sheet's rows only", async () => {
    fake.prisma.takeoffMeasurement.findMany.mockResolvedValue(rows);
    const result = await postTakeoffToEstimateCommand.resolve(ctx, { jobName: "Washington Village" });
    if (result.kind !== "ready") throw new Error(`expected ready, got ${result.kind}`);
    expect(result.resolved).toEqual({ jobId: "job-1", jobName: "Washington Village", pageId: "p-3", measurementIds: ["m-1", "m-2"] });
    expect(result.preview.find((l) => l.label === "Not on the estimate yet")?.value).toBe("3 measurements on 2 sheets");
  });

  it("opens the sheet the person named", async () => {
    fake.prisma.takeoffMeasurement.findMany.mockResolvedValue(rows);
    const result = await postTakeoffToEstimateCommand.resolve(ctx, { jobName: "Washington Village", sheet: "a102" });
    if (result.kind !== "ready") throw new Error("unreachable");
    expect(result.resolved.measurementIds).toEqual(["m-3"]);
  });

  it("refuses when everything measured is already on the estimate", async () => {
    fake.prisma.takeoffMeasurement.findMany.mockResolvedValue([]);
    expect((await postTakeoffToEstimateCommand.resolve(ctx, { jobName: "Washington Village" })).kind).toBe("refuse");
  });
});
