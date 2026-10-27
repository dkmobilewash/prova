import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pageInventoryWork, type PageInventoryDeps, type SheetTextRow, type ScaleReadingRow, type SheetProposalRow } from "./pageInventory";
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
  const proposals: SheetProposalRow[] = [];
  const bytes = planSetPdf([
    sheetWithTitleBlock({ sheetNumber: "A-101", title: "FIRST FLOOR PLAN", titleSize: 18 }),
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
    saveSheetProposal: async (row) => {
      proposals.push(row);
    },
    planTextReadOn: async () => true,
  };
  return { deps: { ...base, ...over }, saved, scales, proposals, openPdf, readPlanBytes: base.readPlanBytes };
}

describe("naming the sheet without a model", () => {
  it("proposes nothing while the company has not opted into plan-text reading", async () => {
    const d = deps({ planTextReadOn: async () => false });
    const work = pageInventoryWork(CTX, d.deps);
    expect(await work(task(1))).toEqual({ ok: true });
    expect(d.proposals).toEqual([]);
    expect(d.saved).toHaveLength(1);
  });

  it("proposes the corner's designation and the title block's title, HIGH, and nothing for a scan", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    expect(await work(task(1))).toEqual({ ok: true });
    expect(await work(task(2))).toEqual({ ok: true });
    expect(await work(task(3))).toEqual({ ok: true });
    // Page 1 letters its title at 18pt over 9pt boilerplate, so the title is
    // believed; page 2 letters everything at 9pt, so only its NUMBER is — a
    // title at the block's own size is boilerplate until a model reads it.
    expect(d.proposals.map((p) => [p.pageNumber, p.sheetNumber, p.title, p.confidence])).toEqual([
      [1, "A-101", "FIRST FLOOR PLAN", "HIGH"],
      [2, "A-102", null, "HIGH"],
    ]);
    expect(d.proposals[0].ingestJobId).toBe(CTX.ingestJobId);
    expect(d.proposals[0].reason).toMatch(/without a model/);
  });
});

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

  it("INVENTS NO SCALE FROM THE DIMENSIONS when there are none to vote on", async () => {
    // These fixtures carry a title block and no dimension strings, so the
    // dimension reader has nothing and must say so. It used to end there, and
    // this test asserted a null scale.
    //
    // IT NO LONGER DOES, and the change is the feature rather than a regression:
    // `planFixtures.ts:215` prints `SCALE: 1/4" = 1'-0"` in the block, so the
    // PRINTED fallback reads it — which is exactly what it is for. What must
    // still hold is that the DIMENSIONS reader produced nothing and that the row
    // says where its scale came from.
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    const row = d.scales[0]!;
    expect(row.source).toBe("PRINTED");
    expect(row.scaleName).toBe('1/4" = 1\'-0"');
    // No dimension agreed, because none could be read — so no evidence list, and
    // no error band, because there is no measured distance from anything.
    expect(row.agreedText).toBeNull();
    expect(row.inheritedError).toBeNull();
    expect(row.consideredCount).toBe(0);
    expect(row.declineReason).toBeNull();
  });

  it("falls back ONLY where the dimensions declined, never over an answer", async () => {
    // The ordering is the safety of the whole path: a dimension-derived reading
    // can be checked against the drawing and a printed one cannot, so the
    // printed scale must never displace one. Proved by a fixture that HAS
    // readable dimensions — its reading must stay `DIMENSIONS` even though its
    // title block prints a scale too.
    const d = deps();
    const work = pageInventoryWork(CTX, {
      ...d.deps,
      openPdf: async (bytes) => {
        const pdf = await openPlanPdf(bytes);
        return {
          ...pdf,
          // A page whose dimensions DO agree: six 1/8"-scale dimensions, drawn
          // the way `scaleFromDimensions.test.ts` builds them.
          pageText: async (n: number) => {
            const page = await pdf.pageText(n);
            const items = [...page.items];
            for (let i = 0; i < 6; i += 1) {
              const feet = 8 + i * 2;
              const lenPt = feet * 9;
              items.push({ str: `${feet}' - 0"`, x: 200 + lenPt / 2 - 15, y: 200 + i * 300 - 4, width: 30, height: 10 });
            }
            return { ...page, items };
          },
          pageStrokes: async (n: number) => {
            const strokes = await pdf.pageStrokes(n);
            const segments = [...strokes.segments];
            for (let i = 0; i < 6; i += 1) {
              const feet = 8 + i * 2;
              const lenPt = feet * 9;
              segments.push({ x1: 200, y1: 200 + i * 300, x2: 200 + lenPt, y2: 200 + i * 300 });
            }
            return { ...strokes, segments };
          },
        };
      },
    });
    await work(task(1));
    const row = d.scales[0]!;
    expect(row.source).toBe("DIMENSIONS");
    expect(row.scaleName).toBe('1/8" = 1\'-0"');
    // And NOT the 1/4" its title block prints — the dimensions won.
    expect(row.agreedText).toBeTruthy();
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

/**
 * THE PRINTED SCALE, AS A FALLBACK ONLY.
 *
 * The ordering is the safety: a reading off a dimension printed on the drawing
 * can be checked against the drawing, and one off the title block cannot. So the
 * printed scale must never be reached while the dimensions have an answer, and
 * `source` must say which happened — a PRINTED reading stores a line too (the
 * sheet's own width), so nothing downstream can infer it.
 */
describe("the scale printed on the sheet", () => {
  it("reads the fixture's printed scale, which is the fallback doing its job", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    expect(d.scales[0]!.source).toBe("PRINTED");
    expect(d.scales[0]!.scaleName).toBe('1/4" = 1\'-0"');
  });

  it("STORES THE SHEET'S OWN WIDTH AS THE LINE, inventing no dimension", async () => {
    // The whole reason this path keeps #623's rule in substance: the line is a
    // fact about the file, not a figure read off a dimension that is not there.
    // A full-width span is also the longest line available, so the geometry is
    // the least error-prone there is.
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    const row = d.scales[0]!;
    expect(row.x1).toBe(0);
    expect(row.x2).toBe(1);
    expect(row.declaredDistanceFeet).not.toBeNull();
    // ARCH D in the fixture at 1/4" = 1'-0": 36in x 4ft/in = 144ft.
    expect(row.declaredDistanceFeet).toBeCloseTo(144, 2);
  });

  it("records `DIMENSIONS` on a scan, which never reaches either reader", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(3));
    expect(d.scales[0]!.source).toBe("DIMENSIONS");
    expect(d.scales[0]!.declineReason).toMatch(/is a scan/);
  });

  it("STILL STORES EXACTLY ONE ROW PER PAGE whichever reader answered", async () => {
    // The fallback must not become a second write. A page with two rows would
    // make "which scale does this sheet have" a question with two answers.
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    await work(task(2));
    expect(d.scales).toHaveLength(2);
    expect(d.scales.map((r) => r.pageNumber)).toEqual([1, 2]);
  });

  it("keeps the page's TEXT write whatever either reader did", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, d.deps);
    await work(task(1));
    expect(d.saved).toHaveLength(1);
    expect(d.saved[0]!.hasTextLayer).toBe(true);
  });
});

describe("a metric sheet", () => {
  /**
   * ── THE STAGE MUST ACTUALLY READ METRIC, NOT MERELY BE ABLE TO ──
   *
   * `metricDimensionLabels` and the two-pass fallback can both be correct while
   * the stage hands `readSheetScale` only the imperial labels — and a mutation
   * doing exactly that left every other test in the repo green. "Built and not
   * wired" is this codebase's most expensive recurring shape.
   *
   * So this drives the REAL stage over a REAL metric drawing: fixture S16,
   * which prints `1:100`, dimensions in bare millimetres, and declined with
   * "No printed dimensions were found on this sheet" until the fallback
   * existed.
   */
  it("records the scale the sheet is drawn to", async () => {
    const bytes = readFileSync(
      join(import.meta.dirname, "..", "takeoff", "fixtures", "plans", "S16.pdf"),
    );
    const d = deps({ readPlanBytes: vi.fn(async () => ({ ok: true as const, bytes })) });
    const work = pageInventoryWork(CTX, d.deps);
    expect(await work(task(1))).toEqual({ ok: true });

    const reading = d.scales.find((r) => r.pageNumber === 1);
    expect(reading, "the stage recorded no scale reading at all").toBeDefined();
    expect(reading?.scaleName).toBe("1:100");
  });
});

/**
 * ── A SHEET CARRYING SEVERAL DRAWINGS AT SEVERAL SCALES ──
 *
 * The case BOTH earlier steps refuse. The dimensions disagree, because they are
 * dimensions of different drawings; and `scaleFromPrinted` declines a page with
 * more than one printed scale on it, because it cannot tell which drawing each
 * belongs to.
 *
 * A page-wide scale would be wrong for every drawing but one, so none is
 * stored — what gets stored is the per-view answer, for the workspace to offer.
 * This asserts the column is actually written, which is the half a census
 * cannot see.
 */
describe("a sheet with two drawings at two scales", () => {
  /** A caption block at the offsets real sheets use — see `viewCaptionScale`. */
  function caption(name: string, scale: string, atX: number, atY: number, w: number) {
    return [
      { str: name, x: atX * w, y: atY * w, width: 60, height: 10 },
      { str: `SCALE: ${scale}`, x: (atX + 0.0202) * w, y: (atY + 0.006) * w, width: 60, height: 8 },
    ];
  }

  it("STORES EACH DRAWING'S OWN SCALE, and no scale for the page", async () => {
    const d = deps();
    const work = pageInventoryWork(CTX, {
      ...d.deps,
      openPdf: async (bytes) => {
        const pdf = await openPlanPdf(bytes);
        return {
          ...pdf,
          pageText: async (n: number) => {
            const page = await pdf.pageText(n);
            const w = page.widthPt;
            return {
              ...page,
              // Only the captions, so no dimension can be read and the printed
              // pass sees TWO scales and declines — which is the state this
              // path exists for.
              items: [
                ...caption("FLOOR PLAN", `1/8" = 1'-0"`, 0.1, 0.2, w),
                ...caption("ENLARGED RESTROOM PLAN", `1/2" = 1'-0"`, 0.6, 0.2, w),
              ],
            };
          },
          // Geometry in both halves, with a gutter between them: a caption over
          // empty paper is a legend, not a drawing, and must not become a view.
          pageStrokes: async (n: number) => {
            const strokes = await pdf.pageStrokes(n);
            const w = strokes.widthPt;
            const segments = [];
            for (let i = 0; i < 40; i += 1) {
              const y = (0.3 + i * 0.004) * w;
              segments.push({ x1: 0.08 * w, y1: y, x2: 0.35 * w, y2: y });
              segments.push({ x1: 0.58 * w, y1: y, x2: 0.85 * w, y2: y });
            }
            return { ...strokes, segments };
          },
        };
      },
    });

    expect(await work(task(1))).toEqual({ ok: true });
    const row = d.scales[0]!;
    // NO PAGE-WIDE SCALE. One would be wrong for every drawing but one, and a
    // calibration an estimator accepts is one they are taken to have checked.
    expect(row.scaleName).toBeNull();
    expect(row.declineReason).toMatch(/drawings at their own scales/);
    // …and the per-view answer IS stored.
    expect(row.viewScales, "nothing stored for a multi-scale sheet").toBeDefined();
    const names = (row.viewScales?.views ?? []).map((v) => v.scaleName).sort();
    expect(names).toEqual([`1/2" = 1'-0"`, `1/8" = 1'-0"`]);
    // Each carries its own region, which is what keeps the two scales from
    // competing — see `sheetScale.ts`.
    for (const view of row.viewScales?.views ?? []) {
      expect(view.to).toBeGreaterThan(view.from);
      expect(view.feetPerInch).toBeGreaterThan(0);
    }
  });

  it("stores NOTHING for an ordinary sheet, which is most of them", async () => {
    // The fixture reads its printed scale, so this path is never reached. A
    // column written on every sheet would be a column nobody could trust to
    // mean "this sheet is unusual".
    const d = deps();
    await pageInventoryWork(CTX, d.deps)(task(1));
    expect(d.scales[0]!.viewScales).toBeUndefined();
  });
});
