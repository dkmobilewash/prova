import { prisma } from "@prova/db";
import { readPlanBytes } from "./planBytes";
import { hasTextLayer, openPlanPdf, titleBlockText, type PlanPdf, type PlanPageText } from "./planPdf";
import { dimensionLabels } from "./dimensionLabels";
import { scaleFromDimensions } from "../takeoff/scaleFromDimensions";
import { scaleFromPrinted } from "../takeoff/scaleFromPrinted";
import { printedScalesOnPage } from "../takeoff/scaleAudit";
import type { StageCtx, StageWork } from "./stages";

/**
 * `PAGE_INVENTORY` — WHAT EACH PAGE OF THE SET SAYS. No model call, ever.
 *
 * `plan-ingest.prisma` has described this stage as "it exists, and does it have
 * selectable text" since it was written, and it shipped doing nothing because the
 * server was believed unable to open a plan PDF at all. That belief was wrong
 * (see `planPdf.ts`), so this is the stage catching up with its own description
 * rather than a new one invented beside it.
 *
 * WHY THE PDF WORK BELONGS HERE AND NOT IN `TITLE_BLOCK`, which is where a first
 * draft put it. A stage that both parses a 15MB PDF and calls a model is paced by
 * the model: about two and a half seconds a page, so a 5-second Server Action
 * slice fits ONE OR TWO pages and re-fetches the whole file for each pair. Over a
 * 300-page set that is 150-odd fetches — two to four gigabytes of egress for one
 * ingestion. Making no model call, this stage runs at the full budget instead:
 * text extraction is a fraction of a second a page, so one fetch serves ten to
 * twenty pages on a browser slice and around a hundred on a cron tick. The
 * expensive stage then reads ROWS, which is also what makes its retries cheap.
 *
 * WHAT IT WRITES IS EVIDENCE, NOT AN ANSWER. `PlanSheetText` holds the words off
 * the title block so that `TITLE_BLOCK`'s `proposedReason` can be checked against
 * them, and so a reviewer can see what a proposal was made from. Nothing here
 * proposes anything.
 */

/** Everything this stage touches that is not pure, injected so the stage can be
 *  tested with no network, no database and no PDF. */
export type PageInventoryDeps = {
  /** The plan's bytes, or a sentence saying why not. */
  readPlanBytes: (planId: string, companyId: string) => Promise<ReadPlanBytes>;
  /** Open a document for reading. */
  openPdf: (bytes: Buffer) => Promise<PlanPdf>;
  /** Record what one page says. Idempotent — see `PlanSheetText`'s header. */
  saveSheetText: (row: SheetTextRow) => Promise<void>;
  /**
   * Record the scale the sheet declares about itself. Idempotent, same key.
   *
   * A SEPARATE PORT from `saveSheetText` because the two can fail
   * independently and only one of them is what the stage is named for: a sheet
   * whose text was recorded and whose scale could not be told has been read
   * SUCCESSFULLY, and must not lose the first write to the second.
   */
  saveScaleReading: (row: ScaleReadingRow) => Promise<void>;
};

export type ScaleReadingRow = {
  planId: string;
  pageNumber: number;
  scaleName: string | null;
  /**
   * `DIMENSIONS` or `PRINTED` — see the column's own comment. It is not
   * inferable from which fields are null, because a PRINTED reading stores a
   * line too (the sheet's own width), so it has to travel explicitly.
   */
  source: string;
  /** In page-width units — `sheet-geometry.ts`'s box, so the prefill is a copy
   *  rather than a conversion. */
  x1: number | null;
  y1: number | null;
  x2: number | null;
  y2: number | null;
  declaredDistanceFeet: number | null;
  declaredText: string | null;
  agreedText: string | null;
  consideredCount: number;
  inheritedError: number | null;
  declineReason: string | null;
};

export type ReadPlanBytes = { ok: true; bytes: Buffer } | { ok: false; error: string };

export type SheetTextRow = {
  planId: string;
  pageNumber: number;
  hasTextLayer: boolean;
  titleBlockText: string | null;
  wholePageFallback: boolean;
  widthPt: number;
  heightPt: number;
  rotation: number;
};

/**
 * A page that is not in the file.
 *
 * The page count a run is created with comes from the browser and is bounded but
 * not verified (`startPlanIngest`), so a job can legitimately hold tasks for pages
 * the document does not have. That is a fact about the run, not a transient fault:
 * retrying cannot make page 400 of a 320-page set exist. It is reported as a
 * failure because there is nothing to record about it, and the sentence says the
 * set is shorter rather than implying something broke.
 */
function pastTheEnd(pageNumber: number, pageCount: number): string {
  return (
    `This set has ${pageCount} ${pageCount === 1 ? "sheet" : "sheets"}, so there is no sheet ${pageNumber} to read. ` +
    `Nothing about it was saved.`
  );
}

/**
 * The stage, bound to one run.
 *
 * THE DOCUMENT IS OPENED ONCE PER INVOCATION and held in this closure, which is
 * the whole economic point of the stage. `claimPorts` takes `work` as an injected
 * value and both call sites build it per invocation, so the cache's lifetime is
 * exactly one Server Action slice or one cron tick — long enough to amortise the
 * fetch over many pages, short enough that nothing has to invalidate it.
 *
 * It is not explicitly destroyed, and that is deliberate rather than overlooked.
 * The legacy pdfjs build spawns no worker in Node, so an open document is ordinary
 * heap; when the invocation ends this closure becomes unreachable and it is
 * collected with it. Adding a disposer would mean threading a teardown through
 * `runIngest`, which exists to know nothing about what a stage does. If a
 * long-lived container ever shows this holding memory, the fix is that disposer —
 * not a re-open per page, which is the cost this design exists to avoid.
 */
export function pageInventoryWork(ctx: StageCtx, deps: PageInventoryDeps = realDeps): StageWork {
  let opened: Promise<ReadPlanBytes | { ok: true; pdf: PlanPdf }> | null = null;

  async function document(): Promise<{ ok: true; pdf: PlanPdf } | { ok: false; error: string }> {
    if (!opened) {
      opened = (async () => {
        const read = await deps.readPlanBytes(ctx.planId, ctx.companyId);
        if (!read.ok) return read;
        return { ok: true as const, pdf: await deps.openPdf(read.bytes) };
      })();
    }
    const result = await opened;
    if (!result.ok) {
      // A failed open is NOT cached as a permanent verdict: the next slice builds a
      // new closure and tries again, which is what makes a blob store hiccup cost a
      // retry rather than the run.
      opened = null;
      return result;
    }
    return result as { ok: true; pdf: PlanPdf };
  }

  return async (task) => {
    const doc = await document();
    if (!doc.ok) return { ok: false, error: doc.error };

    if (task.pageNumber < 1 || task.pageNumber > doc.pdf.pageCount) {
      return { ok: false, error: pastTheEnd(task.pageNumber, doc.pdf.pageCount) };
    }

    const page = await doc.pdf.pageText(task.pageNumber);
    const readable = hasTextLayer(page);
    const block = readable ? titleBlockText(page) : null;

    // ── THE SCALE THE SHEET DECLARES ABOUT ITSELF ──
    //
    // Here rather than in a stage of its own, because this stage already has
    // the document open and that is its whole economic point. It is also the
    // only place it CAN be: pdfjs detaches the buffer it is given, so a second
    // stage opening the same bytes throws — see `openPlanPdf`'s own comment and
    // `PlanPdf.pageStrokes`, which exists for this.
    //
    // No model, no spend, no network. Deterministic geometry off the vectors
    // the file already contains.
    const scaleRow = await readScaleFromSheet(doc.pdf, page, ctx.planId, task.pageNumber, readable);

    await deps.saveSheetText({
      planId: ctx.planId,
      pageNumber: task.pageNumber,
      hasTextLayer: readable,
      // Null rather than an empty string when there is nothing to read, so
      // "scanned" and "read but blank" stay distinguishable downstream.
      titleBlockText: block?.text.trim() ? block.text : null,
      wholePageFallback: block?.source === "whole-page",
      widthPt: page.widthPt,
      heightPt: page.heightPt,
      rotation: page.rotation,
    });

    // AFTER the text write and never instead of it: a page whose scale cannot
    // be told has still been inventoried, and the sentence saying why is worth
    // storing. See `declineReason`.
    await deps.saveScaleReading(scaleRow);

    // SUCCESS EVEN WITH NO TEXT LAYER. A scanned sheet is a fact this stage has
    // just recorded, not a failure of it — see `PlanSheetText.hasTextLayer`. A
    // refusal here would spend three attempts and leave a Retry button that can
    // never succeed, on every scanned page of the set.
    return { ok: true };
  };
}

/**
 * One page's scale reading, ready to store.
 *
 * NEVER THROWS. A sheet is inventoried for its text first, and a surprise in
 * the geometry — a page pdfjs will not give an operator list for, a font that
 * upsets it — must not lose that write or spend the task's three attempts. The
 * caught sentence is stored as a decline, which is a fact about the page rather
 * than a failure of the stage.
 */
async function readScaleFromSheet(
  pdf: PlanPdf,
  page: PlanPageText,
  planId: string,
  pageNumber: number,
  readable: boolean,
): Promise<ScaleReadingRow> {
  const empty = {
    planId,
    pageNumber,
    scaleName: null,
    source: "DIMENSIONS",
    x1: null,
    y1: null,
    x2: null,
    y2: null,
    declaredDistanceFeet: null,
    declaredText: null,
    agreedText: null,
    consideredCount: 0,
    inheritedError: null,
  };

  // A SCAN HAS NOTHING TO READ, and says so rather than being attempted. Same
  // posture `PlanSheetText.hasTextLayer` takes: the page is never guessed at.
  if (!readable) {
    return {
      ...empty,
      declineReason: "This sheet is a scan, so there are no printed dimensions to read a scale from.",
    };
  }

  try {
    const strokes = await pdf.pageStrokes(pageNumber);
    const labels = dimensionLabels(page);
    const verdict = scaleFromDimensions(labels, strokes.segments);
    if (!verdict.ok) {
      // ── THE PRINTED SCALE, AND ONLY HERE ──
      //
      // A FALLBACK and never a first choice: a reading off a dimension printed
      // on the drawing can be CHECKED against the drawing, and one off the title
      // block cannot. So this runs only where the dimensions have already
      // declined, and `source` records which happened. See `scaleFromPrinted`
      // for why this is not the thing #623 declined, and what it costs.
      const printed = scaleFromPrinted(printedScalesOnPage(page.items), page.widthPt, page.heightPt);
      if (printed !== null) {
        return {
          planId,
          pageNumber,
          scaleName: printed.scaleName,
          source: "PRINTED",
          x1: printed.x1,
          y1: printed.y1,
          x2: printed.x2,
          y2: printed.y2,
          declaredDistanceFeet: printed.declaredDistanceFeet,
          declaredText: printed.declaredText,
          // No dimension agreed, because none could be read — so there is no
          // evidence list, and the screen says so rather than showing an empty
          // one as if it were a short one.
          agreedText: null,
          consideredCount: verdict.considered,
          // The error a dimension-derived line carries is its distance from the
          // scale the sheet voted for. There is no such distance here: the scale
          // IS the printed one. Null rather than zero, because zero would read
          // as "measured and perfect".
          inheritedError: null,
          declineReason: null,
        };
      }
      return { ...empty, consideredCount: verdict.considered, declineReason: verdict.reason };
    }

    // Into page-width units — both axes over the WIDTH, which is
    // `sheet-geometry.ts`'s contract and deliberately not a fraction of the
    // height. Storing it in the calibration's own convention is what makes the
    // prefill a copy.
    const w = page.widthPt;
    return {
      planId,
      pageNumber,
      scaleName: verdict.scaleName,
      source: "DIMENSIONS",
      x1: verdict.best.x1 / w,
      y1: verdict.best.y1 / w,
      x2: verdict.best.x2 / w,
      y2: verdict.best.y2 / w,
      declaredDistanceFeet: verdict.best.declaredFeet,
      declaredText: verdict.best.text,
      agreedText: verdict.agreed.join("\n"),
      consideredCount: verdict.considered,
      inheritedError: verdict.inheritedError,
      declineReason: null,
    };
  } catch (error) {
    return {
      ...empty,
      declineReason: `This sheet's lines could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** The real ports. Kept at the bottom so the stage above reads as logic. */
const realDeps: PageInventoryDeps = {
  // Shared with `startPlanIngest`, which counts the set's pages from the same
  // bytes — see `planBytes.ts` for why neither goes through the viewer's route.
  readPlanBytes,

  openPdf: openPlanPdf,

  saveSheetText: async (row) => {
    const { planId, pageNumber, ...rest } = row;
    await prisma.planSheetText.upsert({
      where: { planId_pageNumber: { planId, pageNumber } },
      create: { planId, pageNumber, ...rest },
      update: rest,
    });
  },

  // Same shape and same key as the text write: a second run over a set replaces
  // a page's reading rather than accumulating one per run, because the answer is
  // a property of the file and there is nothing to compare between runs.
  saveScaleReading: async (row) => {
    const { planId, pageNumber, ...rest } = row;
    await prisma.planSheetScaleReading.upsert({
      where: { planId_pageNumber: { planId, pageNumber } },
      create: { planId, pageNumber, ...rest },
      update: rest,
    });
  },
};
