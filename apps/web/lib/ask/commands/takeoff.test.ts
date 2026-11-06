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
    takeoffItem: { findMany: vi.fn() },
  },
  setWallGroupHeight: vi.fn(),
  startPlanIngest: vi.fn(),
  wallsSheetsFor: vi.fn(),
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/planIngest", () => ({ startPlanIngest: fake.startPlanIngest }));
vi.mock("@/lib/actions/takeoffItems", () => ({ setWallGroupHeight: fake.setWallGroupHeight }));
vi.mock("@/lib/plan-ingest/walls", () => ({
  wallsSheetsFor: fake.wallsSheetsFor,
  wallsTaskPages: (sheets: number[]) => sheets,
}));
vi.mock("../allowance", () => ({ allowanceSummary: async () => ({ planSheetsLeft: 1340 }) }));

const { runTakeoffCommand, postTakeoffToEstimateCommand, setWallHeightCommand, spokenFeet } = await import("./takeoff");

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

describe("set_wall_height", () => {
  const items = [
    { id: "it-1", name: "S6B walls", heightFt: null, wallType: { code: "S6B" }, _count: { measurements: 4 } },
    { id: "it-2", name: "S6B walls — levels 2–9", heightFt: "9.67", wallType: { code: "S6B" }, _count: { measurements: 1 } },
    { id: "it-3", name: "S6A walls", heightFt: "10", wallType: { code: "S6A" }, _count: { measurements: 7 } },
  ];
  beforeEach(() => {
    fake.prisma.takeoffItem.findMany.mockReset().mockResolvedValue(items);
    fake.setWallGroupHeight.mockReset().mockResolvedValue({ ok: true });
  });

  it("reads a height the way it is said, and refuses what is not one", () => {
    expect(["15", "15 feet", "15 ft", "15'", "15 foot 6 inches", "15' 6\"", "15 feet and 6 inches"].map(spokenFeet)).toEqual([15, 15, 15, 15, 15.5, 15.5, 15.5]);
    expect(["fifteen", "", "0", "120 feet", undefined].map(spokenFeet)).toEqual([null, null, null, null, null]);
  });

  it("is a T2 modify, DIRECT over the queue's own Set height", () => {
    expect(setWallHeightCommand).toMatchObject({ mode: "DIRECT", core: "setWallGroupHeight", tier: "T2_MODIFY", capability: "VIEW_JOB_COSTS" });
  });

  it("covers every item of the type, one per level, and nothing else; resolving writes nothing", async () => {
    const card = await setWallHeightCommand.resolve(ctx, { jobName: "Washington Village", wallType: "s6b", height: "15 feet" });
    if (card.kind !== "ready") throw new Error(`expected ready, got ${card.kind}`);
    expect(card.resolved).toEqual({ jobId: "job-1", jobName: "Washington Village", code: "S6B", heightFt: 15, itemIds: ["it-1", "it-2"] });
    expect(card.preview.filter((l) => l.label.startsWith("S6B")).map((l) => l.value)).toEqual(["no height → 15 ft (4 walls)", "9.67 ft → 15 ft (1 wall)"]);
    expect(fake.setWallGroupHeight).not.toHaveBeenCalled();
  });

  it("the tap sets each item through the action, and stops at the first refusal", async () => {
    const resolved = { jobId: "job-1", jobName: "Washington Village", code: "S6B", heightFt: 15, itemIds: ["it-1", "it-2"] };
    expect(await setWallHeightCommand.execute(ctx, resolved)).toMatchObject({ ok: true });
    expect(fake.setWallGroupHeight.mock.calls).toEqual([["job-1", "it-1", 15], ["job-1", "it-2", 15]]);
    fake.setWallGroupHeight.mockReset().mockResolvedValue({ ok: false, error: "A wall height is a number of feet between 0 and 100." });
    expect(await setWallHeightCommand.execute(ctx, resolved)).toMatchObject({ ok: false });
    expect(fake.setWallGroupHeight).toHaveBeenCalledTimes(1);
  });

  it("asks for what is missing, and refuses a job past estimating", async () => {
    expect(await setWallHeightCommand.resolve(ctx, { jobName: "Washington Village", height: "15" })).toMatchObject({ kind: "need", missing: expect.stringMatching(/wall type/) });
    expect(await setWallHeightCommand.resolve(ctx, { jobName: "Washington Village", wallType: "S6B" })).toMatchObject({ kind: "need", missing: "the height in feet" });
    expect(await setWallHeightCommand.resolve(ctx, { jobName: "Washington Village", wallType: "S6B", height: "tall" })).toMatchObject({ kind: "need" });
    fake.prisma.job.findFirst.mockResolvedValue({ status: "CONTRACTED" });
    expect(await setWallHeightCommand.resolve(ctx, { jobName: "Washington Village", wallType: "S6B", height: "15" })).toMatchObject({ kind: "refuse" });
  });
});
