import { describe, expect, it, vi } from "vitest";
import { pageInventoryWork, type PageInventoryDeps, type SheetTextRow, type ScaleReadingRow } from "./pageInventory";
import { planSetPdf, scannedSheet, sheetWithTitleBlock } from "./planFixtures";
import { openPlanPdf } from "./planPdf";
import type { ClaimedTask } from "./runner";
import type { StageCtx } from "./stages";

/**
 * `PAGE_INVENTORY`, WITH NO DATABASE AND NO NETWORK.
 *
 * Every port is injected, so these tests drive the real stage over real PDFs — the
 * fixtures are genuine files read by the pdfjs the app ships — while the fetch and
 * the write are fakes. The 10-line `ports()` harness in `runner.test.ts` is the
 * same idea one level up, and it is why this file needs no `vi.mock` of prisma.
 *
 * THE TEST THAT MATTERS MOST IS "opens the document once", because it is the only
 * evidence for the architectural decision this stage exists to implement. Doing the
 * PDF work in `TITLE_BLOCK` instead meant a model call paced every page, so a
 * 5-second slice fitted one or two pages and refetched 15MB for each pair — two to
 * four gigabytes of egress for one 300-page set. If the open stops being cached,
 * nothing else in this suite goes red and the bill is the first thing that notices.
 */

const CTX: StageCtx = {
  planId: "plan_1",
  companyId: "co_1",
  ingestJobId: "job_1",
  jobId: "cjob_1",
  startedByUserId: "user_1",
};

function task(pageNumber: number): ClaimedTask {
  return { id: `t${pageNumber}`, pageNumber, stage: "PAGE_INVENTORY", attempts: 1 };
}

function deps(over: Partial<PageInventoryDeps> = {}) {
  const saved: SheetTextRow[] = [];
  const scales: ScaleReadingRow[] = [];
  const bytes = planSetPdf([
    sheetWithTitleBlock({ sheetNumber: "A-101", title: "FIRST FLOOR PLAN" }),
    sheetWithTitleBlock({ sheetNumber: "A-102", title: "SECOND FLOOR PLAN", rotation: 90 }),
    scannedSheet(),
  ]);
  const openPdf = vi.fn(openPlanPdf);
  const base: PageInventoryDeps = {
    readPlanBytes: vi.fn(async () => ({ ok: true as const, bytes })),
    openPdf,
    saveSheetText: async (row) => {
      saved.push(row);
    },
    saveScaleReading: async (row) => {
      scales.push(row);
    },
  };
  return { deps: { ...base, ...over }, saved, scales, openPdf, readPlanBytes: base.readPlanBytes };
}

describe("reading what each page says", () => {
  it("records the title block, its size and its rotation", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);

    expect(await work(task(1))).toEqual({ ok: true });
    const first = d.saved[0]!;
    expect(first.pageNumber).toBe(1);
    expect(first.hasTextLayer).toBe(true);
    expect(first.titleBlockText).toContain("A-101");
    expect(first.wholePageFallback).toBe(false);
    expect(first.rotation).toBe(0);
    // 2592pt / 72 = 36 inches, the ARCH D width.
    expect(first.widthPt / 72).toBe(36);
  });

  it("reports a rotated sheet's DISPLAYED size, not its MediaBox", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(2));
    const second = d.saved[0]!;
    expect(second.rotation).toBe(90);
    // Swapped, which is the evidence the viewport transform was applied at all —
    // and the same sheet's number still comes out, which is the evidence the
    // region filter followed it round. See `planPdf.test.ts` for the mutation.
    expect(second.widthPt / 72).toBe(24);
    expect(second.titleBlockText).toContain("A-102");
  });

  it("SUCCEEDS on a sheet with no text layer, and says so", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    // The crux: a scan is a fact this stage records, not a failure of it. As a
    // refusal it would spend three attempts and leave a Retry that can never
    // succeed — on every scanned page of the set.
    expect(await work(task(3))).toEqual({ ok: true });
    expect(d.saved[0]!.hasTextLayer).toBe(false);
    // Null rather than "", so "scanned" and "read but blank" stay distinguishable.
    expect(d.saved[0]!.titleBlockText).toBeNull();
  });

  it("OPENS THE DOCUMENT ONCE for many pages — the whole economics of this stage", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    await work(task(2));
    await work(task(3));
    expect(d.saved).toHaveLength(3);
    expect(d.openPdf, "the PDF must be parsed once per invocation, not once per page").toHaveBeenCalledTimes(1);
    expect(d.readPlanBytes, "and fetched once — this is the 2-4GB-per-set decision").toHaveBeenCalledTimes(1);
  });
});

describe("when the file cannot be read", () => {
  it("refuses with the sentence it was given, and does not cache the failure", async () => {
    let attempt = 0;
    const d = deps({
      readPlanBytes: vi.fn(async () => {
        attempt += 1;
        return attempt === 1
          ? { ok: false as const, error: "The plan file could not be fetched just now." }
          : { ok: true as const, bytes: planSetPdf([sheetWithTitleBlock({ sheetNumber: "A-1", title: "T" })]) };
      }),
    });
    const work = pageInventoryWork(CTX, d.deps);

    const first = await work(task(1));
    expect(first).toEqual({ ok: false, error: "The plan file could not be fetched just now." });

    // A FAILED OPEN IS NOT A PERMANENT VERDICT. Cached, a blob-store hiccup on the
    // first page of a slice would refuse every remaining page of that slice with a
    // stale sentence, spending an attempt on each.
    expect(await work(task(1))).toEqual({ ok: true });
  });

  it("refuses a page the document does not have, naming the real length", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    const out = await work(task(9));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    // The run's page count comes from the browser and is bounded, not verified, so
    // a job can legitimately hold tasks for pages that do not exist. Retrying
    // cannot make page 9 of a 3-sheet set appear, so the sentence says the set is
    // shorter rather than implying something broke.
    expect(out.error).toContain("3 sheets");
    expect(out.error).toContain("no sheet 9");
    expect(d.saved).toHaveLength(0);
  });
});


/**
 * THE SCALE READING, which rides this stage because this stage already has the
 * document open — and because it is the only place it CAN ride: pdfjs detaches
 * the buffer it is handed, so a second stage opening the same bytes throws.
 */
describe("the scale a sheet declares about itself", () => {
  it("records a reading for every page, including one it cannot read", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    expect(await work(task(1))).toEqual({ ok: true });
    expect(await work(task(2))).toEqual({ ok: true });
    expect(await work(task(3))).toEqual({ ok: true });

    // ONE ROW PER PAGE AND NEVER A MISSING ONE: a page with no reading and a
    // page nobody has read are different states, and only a stored row can tell
    // them apart. The same reason `PlanSheetText.hasTextLayer` exists.
    expect(d.scales).toHaveLength(3);
    expect(d.scales.map((r) => r.pageNumber)).toEqual([1, 2, 3]);
  });

  it("says a SCAN is a scan rather than attempting it", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    // The third fixture sheet has no text layer.
    await work(task(3));
    const row = d.scales[0]!;
    expect(row.scaleName).toBeNull();
    expect(row.declineReason).toMatch(/is a scan/);
    expect(row.consideredCount).toBe(0);
  });

  it("DECLINES the title-block fixtures rather than inventing a scale for them", async () => {
    // These fixtures carry a title block and no dimension strings, so there is
    // nothing to vote on. A reader that produced a scale here would be producing
    // one from nothing, which is the failure this whole module is shaped to
    // avoid — and it is worth a test, because "no dimensions" is the common case
    // on a cover sheet or a schedule page.
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    const row = d.scales[0]!;
    expect(row.scaleName).toBeNull();
    expect(row.declineReason).toBeTruthy();
    expect(row.x1).toBeNull();
    expect(row.declaredDistanceFeet).toBeNull();
  });

  it("still records the page's TEXT when the scale cannot be told", async () => {
    // The ordering that matters: a surprise in the geometry must not lose the
    // write this stage is named for.
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]!.hasTextLayer).toBe(true);
    expect(d.scales).toHaveLength(1);
  });

  it("reports success even when the geometry read throws, and stores the reason", async () => {
    // A page pdfjs will not hand an operator list for must not spend the task's
    // three attempts or lose the text write.
    const d = deps();
    const work = pageInventoryWork(CTX, {
      ...d.deps,
      openPdf: async (bytes) => {
        const pdf = await openPlanPdf(bytes);
        return {
          ...pdf,
          pageStrokes: async () => {
            throw new Error("no operator list");
          },
        };
      },
    });
    expect(await work(task(1))).toEqual({ ok: true });
    expect(d.scales[0]!.declineReason).toMatch(/could not be read: no operator list/);
  });
});
