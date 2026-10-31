import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ── THE DEADLINE, WHICH IS THE WHOLE POINT OF THIS FILE ──
 *
 * Detection was being KILLED by the platform on a real 52-sheet bid set, and a
 * kill is silent: no proposals and no log line, which is byte-for-byte what a
 * sheet with no walls on it produces. Two very different facts, one appearance.
 *
 * So the budget is injected — `runner.ts`'s pattern, and for its stated reason:
 * a deadline read from `Date.now()` can only be tested by waiting for it. These
 * run in a millisecond.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED HERE: that 60 seconds is enough, or that the
 * platform honours `maxDuration`. Neither is observable from vitest. The page's
 * own comment says where that proof lives — the production log after a save.
 */

const readPlanBytes = vi.fn();
const openPlanPdf = vi.fn();
const createMany = vi.fn(async (_args: unknown) => ({ count: 0 }));
/** The page's user exclusions; none unless a test says so. */
const exclusionRows = vi.fn(async (_args: unknown): Promise<{ kind: string; xs: number[]; ys: number[] }[]> => []);

vi.mock("@/lib/plan-ingest/planBytes", () => ({
  readPlanBytes: (planId: string, companyId: string) => readPlanBytes(planId, companyId),
}));
vi.mock("@/lib/plan-ingest/planPdf", () => ({ openPlanPdf: (bytes: unknown) => openPlanPdf(bytes) }));
// No scanned sheets here: every page reads its strokes and text from the file.
vi.mock("@/lib/plan-ingest/raster", () => ({ storedRasterFor: async () => null }));
vi.mock("@prova/db", () => ({
  prisma: {
    takeoffWallProposal: { createMany: (args: unknown) => createMany(args) },
    // The job's items, for matching groups into conditions: none here.
    takeoffPlan: { findUnique: async () => null },
    takeoffItem: { findMany: async () => [] },
    takeoffSheetExclusion: { findMany: (args: unknown) => exclusionRows(args) },
  },
}));
// `after()` throws outside a request scope, which is the documented behaviour
// `detectWallsAfterResponse` relies on. These tests call the inner function
// directly, so nothing here needs it — but importing the module must not throw.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));
// The per-company switch. Off is the default for every company (an opt-in),
// so the test turns it on by hand for the one case that needs it.
const planTextOn = { value: false };
vi.mock("@/lib/ai/settings", () => ({
  aiGate: async () => (planTextOn.value ? { ok: true, model: "test-model" } : { ok: false, error: "off" }),
}));

const legendForPlan = vi.fn(async () => null);
const doorScheduleForPlan = vi.fn(async () => null);
const writeSheetResult = vi.fn();
vi.mock("./planTextRead", () => ({
  legendForPlan: (...args: unknown[]) => legendForPlan(...(args as [])),
  doorScheduleForPlan: (...args: unknown[]) => doorScheduleForPlan(...(args as [])),
  doorsOnSheet: () => ({ placed: [], unplaced: [], rowsTotal: 0 }),
  typedFeetOf: () => ({ taggedFeet: 0, propagatedFeet: 0, noteFeet: 0, untypedFeet: 0 }),
  writeSheetResult: (result: unknown) => writeSheetResult(result),
}));
const { detectWallsForCalibration } = await import("./detectWallsForCalibration");

/** A document that reads instantly and carries nothing. The pages are empty on
 *  purpose: these tests are about WHICH pages get read, not what is on them. */
function fakeDoc(pageCount: number) {
  const pagesRead: number[] = [];
  return {
    pagesRead,
    doc: {
      pageCount,
      pageStrokes: vi.fn(async (pageNumber: number) => {
        pagesRead.push(pageNumber);
        return { pageNumber, widthPt: 1224, heightPt: 792, rotation: 0, segments: [], pathOperators: 0 };
      }),
      pageText: vi.fn(async () => ({ items: [] })),
      close: vi.fn(async () => {}),
    },
  };
}

const target = {
  pageId: "page-1",
  calibrationId: "cal-1",
  planId: "plan-1",
  companyId: "company-1",
  pageNumber: 1,
  // 1224pt wide at 1/8" = 1'-0" is 136 ft across.
  feetPerUnit: 136,
  wallTypes: [],
};

/** A clock that advances by a fixed amount on every reading, so "time passes
 *  while sampling" needs no timers and no real delay. */
function tickingClock(msPerRead: number) {
  let t = 0;
  return () => {
    const at = t;
    t += msPerRead;
    return at;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  readPlanBytes.mockResolvedValue({ ok: true, bytes: Buffer.from("") });
});

describe("detection stops itself instead of being stopped", () => {
  it("gives up after the download when the budget is already gone, and says so", async () => {
    const { doc, pagesRead } = fakeDoc(10);
    openPlanPdf.mockResolvedValue(doc);
    const log = vi.spyOn(console, "info").mockImplementation(() => {});

    const outcome = await detectWallsForCalibration(target, { now: tickingClock(1_000), budgetMs: 1 });

    expect(outcome).toBe("out-of-time");
    // The expensive read already happened; nothing after it was attempted.
    expect(pagesRead).toEqual([]);
    expect(createMany).not.toHaveBeenCalled();
    // THE LINE THAT MAKES A KILL DISTINGUISHABLE FROM AN EMPTY SHEET.
    expect(log).toHaveBeenCalledWith("[takeoff] detection ran out of time", expect.objectContaining({ planId: "plan-1" }));
    log.mockRestore();
  });

  it("does NOT give up when the budget runs out while sampling — it drops the template pass", async () => {
    // The control and the case differ in ONE thing: how fast the clock runs.
    const generous = fakeDoc(10);
    openPlanPdf.mockResolvedValue(generous.doc);
    const whole = await detectWallsForCalibration(target, { now: tickingClock(0), budgetMs: 45_000 });

    const pressed = fakeDoc(10);
    openPlanPdf.mockResolvedValue(pressed.doc);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const cut = await detectWallsForCalibration(target, { now: tickingClock(400), budgetMs: 1_000 });
    vi.restoreAllMocks();

    // The sheet somebody is looking at is read in both runs.
    expect(pressed.pagesRead[0]).toBe(1);
    // The control proves the sampling loop reads more than one page, so the
    // comparison below is measuring something. Without this the case could pass
    // on a loop that never ran.
    expect(generous.pagesRead.length).toBeGreaterThan(1);
    expect(pressed.pagesRead.length).toBeLessThan(generous.pagesRead.length);

    // AND THE OUTCOME IS NOT "out-of-time". Losing the template filter is the
    // fail-safe direction `sheetTemplate.ts` states — "cannot tell" must not
    // mean "drop it" — so detection still ran and simply found nothing on these
    // empty pages.
    expect(cut).toBe("nothing-found");
    expect(whole).toBe("nothing-found");
  });

  it("reports an unreadable plan file as itself, not as a timeout", async () => {
    readPlanBytes.mockResolvedValue({ ok: false, error: "gone" });
    expect(await detectWallsForCalibration(target, { now: tickingClock(0), budgetMs: 45_000 })).toBe("unreadable");
    expect(openPlanPdf).not.toHaveBeenCalled();
  });

  it("reports a page that is not in the document as itself", async () => {
    const { doc } = fakeDoc(3);
    openPlanPdf.mockResolvedValue(doc);
    const outcome = await detectWallsForCalibration({ ...target, pageNumber: 9 }, { now: tickingClock(0), budgetMs: 45_000 });
    expect(outcome).toBe("no-such-page");
    expect(doc.close).toHaveBeenCalled();
  });
});

describe("PLAN_TEXT_READ (the per-company opt-in)", () => {
  beforeEach(() => {
    legendForPlan.mockClear();
    doorScheduleForPlan.mockClear();
    writeSheetResult.mockClear();
    planTextOn.value = false;
  });

  it("off (the default): reads no legend, no schedule, writes no result — the detection is what it was", async () => {
    const { doc } = fakeDoc(3);
    openPlanPdf.mockResolvedValue(doc);
    await detectWallsForCalibration(target, { now: tickingClock(0), budgetMs: 45_000 });
    expect(legendForPlan).not.toHaveBeenCalled();
    expect(doorScheduleForPlan).not.toHaveBeenCalled();
    expect(writeSheetResult).not.toHaveBeenCalled();
  });

  it("on: reads the legend once, joins the schedule, and writes the sheet's result", async () => {
    planTextOn.value = true;
    legendForPlan.mockResolvedValueOnce({ page: 25, codes: ["A", "B"] } as never);
    const { doc } = fakeDoc(3);
    openPlanPdf.mockResolvedValue(doc);
    await detectWallsForCalibration(target, { now: tickingClock(0), budgetMs: 45_000 });
    expect(legendForPlan).toHaveBeenCalledTimes(1);
    expect(doorScheduleForPlan).toHaveBeenCalledTimes(1);
    expect(writeSheetResult).toHaveBeenCalledWith(
      expect.objectContaining({ planId: "plan-1", pageNumber: 1, legend: { page: 25, codes: ["A", "B"] }, doors: null }),
    );
  });
});

describe("THE STAGE POSTS THE VIEWER'S LIST, NOT THE FINDER'S", () => {
  // 1224 pt wide at 136 ft across is 9 pt per foot. A 60 x 40 ft room of
  // 6 in walls, and 60 ft to its right a 30 ft wall with "(E) WALL" written
  // a foot above it — the one set-aside a synthetic sheet can carry with no
  // legend, no frame and no dash pattern.
  const T = 4.5;
  const seg = (x1: number, y1: number, x2: number, y2: number) => ({ x1, y1, x2, y2, width: 1 });
  const strokes = [
    seg(200, 150, 740, 150), seg(200, 150 + T, 740, 150 + T),
    seg(200, 510, 740, 510), seg(200, 510 - T, 740, 510 - T),
    seg(200, 150, 200, 510), seg(200 + T, 150, 200 + T, 510),
    seg(740, 150, 740, 510), seg(740 - T, 150, 740 - T, 510),
    seg(800, 300, 1070, 300), seg(800, 300 + T, 1070, 300 + T),
  ];
  const tag = { str: "(E) WALL", x: 900, y: 290, width: 50, height: 8 };
  const sheet = (items: { str: string; x: number; y: number; width: number; height: number }[]) => ({
    pageCount: 1,
    pageStrokes: vi.fn(async () => ({ pageNumber: 1, widthPt: 1224, heightPt: 792, rotation: 0, segments: strokes, pathOperators: strokes.length })),
    pageText: vi.fn(async () => ({ items })),
    close: vi.fn(async () => {}),
  });
  type StoredRun = { x1: number; y1: number; x2: number; y2: number };
  const postedRuns = (): StoredRun[] => {
    const call = createMany.mock.calls.at(-1)?.[0] as { data: { runs: StoredRun[] }[] } | undefined;
    return (call?.data ?? []).flatMap((row) => row.runs);
  };
  // The tagged wall's centreline, page-width units: y = (300 + T/2) / 1224.
  const onTaggedWall = (run: StoredRun) => Math.abs(run.y1 - (300 + T / 2) / 1224) < 1e-3 && Math.abs(run.y2 - run.y1) < 1e-3 && run.x1 > 0.6;

  it("without the tag every wall is posted — the control that proves the fixture is read", async () => {
    openPlanPdf.mockResolvedValue(sheet([]));
    expect(await detectWallsForCalibration(target, { now: tickingClock(0), budgetMs: 45_000 })).toBe("written");
    const runs = postedRuns();
    expect(runs).toHaveLength(5);
    expect(runs.some(onTaggedWall)).toBe(true);
  });

  it("THE USER'S WORK AREA REACHES THE ESTIMATE: a WORK_AREA row round the room leaves the wall outside it unposted", async () => {
    // The room spans x 200..740 pt; the box covers x 150..780, y 100..560 in page-width units (1224 pt wide).
    exclusionRows.mockResolvedValueOnce([{ kind: "WORK_AREA", xs: [150 / 1224, 780 / 1224, 780 / 1224, 150 / 1224], ys: [100 / 1224, 100 / 1224, 560 / 1224, 560 / 1224] }]);
    openPlanPdf.mockResolvedValue(sheet([]));
    expect(await detectWallsForCalibration(target, { now: tickingClock(0), budgetMs: 45_000 })).toBe("written");
    const runs = postedRuns();
    expect(runs).toHaveLength(4);
    expect(runs.some(onTaggedWall)).toBe(false);
    expect(exclusionRows).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ pageId: "page-1" }) }));
  });

  it("A SET-ASIDE LINE NEVER REACHES THE ESTIMATE: tagged (E) WALL, the wall is left out of what is posted and the room's four stay", async () => {
    openPlanPdf.mockResolvedValue(sheet([tag]));
    expect(await detectWallsForCalibration(target, { now: tickingClock(0), budgetMs: 45_000 })).toBe("written");
    const runs = postedRuns();
    expect(runs).toHaveLength(4);
    expect(runs.some(onTaggedWall)).toBe(false);
  });
});
