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
  loadReviewQueue: vi.fn(),
  confirmSheetSuggestions: vi.fn(),
  startPlanIngest: vi.fn(),
  wallsSheetsFor: vi.fn(),
}));
vi.mock("@prova/db", () => ({ prisma: fake.prisma }));
vi.mock("@/lib/actions/planIngest", () => ({ startPlanIngest: fake.startPlanIngest }));
vi.mock("@/lib/actions/takeoffItems", () => ({ setWallGroupHeight: fake.setWallGroupHeight }));
vi.mock("@/lib/takeoff/reviewQueueQuery", () => ({ loadReviewQueue: fake.loadReviewQueue }));
vi.mock("@/lib/actions/wallGroupType", () => ({ confirmSheetSuggestions: fake.confirmSheetSuggestions }));
vi.mock("@/lib/plan-ingest/walls", () => ({
  wallsSheetsFor: fake.wallsSheetsFor,
  wallsTaskPages: (sheets: number[]) => sheets,
}));
vi.mock("../allowance", () => ({ allowanceSummary: async () => ({ planSheetsLeft: 1340 }) }));

const { runTakeoffCommand, postTakeoffToEstimateCommand, setWallHeightCommand, spokenFeet, acceptSheetSuggestionsCommand } = await import("./takeoff");

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

describe("accept_sheet_suggestions", () => {
  const run = { x1: 0, y1: 0, x2: 1, y2: 0 };
  const group = (key: string, page: number, sheet: string, suggested: { code: string; from: string; drawn?: true } | null, feet: number, ceiling: { kind: "ceiling"; feet: number; from: string } | null = null) =>
    ({ kind: "type", key, pageNumber: page, sheet, inches: 4.875, runs: [run], feet, suggested, ceiling }) as const;
  const items = [
    group("g1", 13, "A101", { code: "S6A", from: "printed tag S6A on A101", drawn: true }, 120),
    group("g2", 13, "A101", { code: "W2", from: "the legend", drawn: true }, 40, { kind: "ceiling", feet: 9, from: "the ceiling plan" }),
    group("g3", 13, "A101", { code: "W1", from: "thickness" }, 30),
    group("g4", 14, "A102", { code: "S6A", from: "printed tag S6A on A102", drawn: true }, 80),
    { kind: "price", key: "p1", lineItemId: "l1", description: "Board", quantity: "1", unit: "SF", askCost: false, costCategory: null },
  ];
  beforeEach(() => {
    fake.loadReviewQueue.mockReset().mockResolvedValue({ planId: "plan-1", items, heights: { S6A: { feet: 10, from: "the legend" } }, heightChoices: {}, codes: [] });
    fake.confirmSheetSuggestions.mockReset().mockResolvedValue({ ok: true, value: { accepted: 2, failed: [], undo: { moved: [], added: [], heights: [] } } });
  });

  it("is a T2 modify, DIRECT over #1020's confirmSheetSuggestions", () => {
    expect(acceptSheetSuggestionsCommand).toMatchObject({ mode: "DIRECT", core: "confirmSheetSuggestions", tier: "T2_MODIFY", capability: "VIEW_JOB_COSTS" });
  });

  it("takes only the groups the drawing named on that sheet, at the heights the queue pre-fills, and writes nothing while resolving", async () => {
    const card = await acceptSheetSuggestionsCommand.resolve(ctx, { jobName: "Washington Village", sheet: "a101" });
    if (card.kind !== "ready") throw new Error(`expected ready, got ${JSON.stringify(card)}`);
    expect(card.resolved).toMatchObject({ jobId: "job-1", sheet: "A101" });
    // The thickness guess (W1) and the other sheet's group stay out; W2 takes the ceiling.
    expect((card.resolved.groups as { code: string; heightFt: number | null; pageNumber: number }[]).map((g) => [g.code, g.heightFt, g.pageNumber])).toEqual([["S6A", 10, 13], ["W2", 9, 13]]);
    expect(card.preview.map((l) => l.value)).toEqual(expect.arrayContaining(["A101: 2 groups, 160 ft", "S6A at 10 ft · 120 ft", "W2 at 9 ft · 40 ft", "1 group the drawing does not name"]));
    expect(card.warnings.join(" ")).toMatch(/no Undo from here/);
    expect(fake.confirmSheetSuggestions).not.toHaveBeenCalled();
  });

  it("the tap hands the card's groups to the action and says what went in, naming any that did not", async () => {
    const card = await acceptSheetSuggestionsCommand.resolve(ctx, { jobName: "Washington Village", sheet: "A101" });
    if (card.kind !== "ready") throw new Error("expected ready");
    fake.confirmSheetSuggestions.mockResolvedValue({ ok: true, value: { accepted: 1, failed: ["W2: That group has no walls to type."], undo: { moved: [], added: [], heights: [] } } });
    const done = await acceptSheetSuggestionsCommand.execute(ctx, card.resolved);
    expect(fake.confirmSheetSuggestions).toHaveBeenCalledWith("job-1", card.resolved.groups);
    expect(done).toMatchObject({ ok: true, message: expect.stringMatching(/^Accepted 1 group on A101; not accepted: W2/) });
  });

  it("refuses a sheet with nothing to type, and a sheet whose groups the drawing does not name; asks for a missing sheet", async () => {
    expect(await acceptSheetSuggestionsCommand.resolve(ctx, { jobName: "Washington Village" })).toMatchObject({ kind: "need" });
    expect(await acceptSheetSuggestionsCommand.resolve(ctx, { jobName: "Washington Village", sheet: "A900" })).toMatchObject({ kind: "refuse", href: "/takeoff/job-1?open=review" });
    fake.loadReviewQueue.mockResolvedValue({ planId: "plan-1", items: [items[2]], heights: {}, heightChoices: {}, codes: [] });
    expect(await acceptSheetSuggestionsCommand.resolve(ctx, { jobName: "Washington Village", sheet: "A101" })).toMatchObject({ kind: "refuse", reason: expect.stringMatching(/None of the 1 groups/) });
  });
});
