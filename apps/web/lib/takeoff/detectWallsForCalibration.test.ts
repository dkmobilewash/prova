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

vi.mock("@/lib/plan-ingest/planBytes", () => ({
  readPlanBytes: (planId: string, companyId: string) => readPlanBytes(planId, companyId),
}));
vi.mock("@/lib/plan-ingest/planPdf", () => ({ openPlanPdf: (bytes: unknown) => openPlanPdf(bytes) }));
vi.mock("@prova/db", () => ({
  prisma: { takeoffWallProposal: { createMany: (args: unknown) => createMany(args) } },
}));
// `after()` throws outside a request scope, which is the documented behaviour
// `detectWallsAfterResponse` relies on. These tests call the inner function
// directly, so nothing here needs it — but importing the module must not throw.
vi.mock("next/server", () => ({ after: (fn: () => unknown) => fn() }));

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
