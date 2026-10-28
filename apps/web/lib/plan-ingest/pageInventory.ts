import { prisma } from "@prova/db";
import { sheetNumberFrom } from "./sheetNumber";
import { aiGate } from "../ai/settings";
import { nameSheet } from "../takeoff/realplan/nameSheet";
import { readPlanBytes } from "./planBytes";
import { hasTextLayer, openPlanPdf, titleBlockText, type PlanPdf, type PlanPageText } from "./planPdf";
import { dimensionLabels, metricDimensionLabels } from "./dimensionLabels";
import { readSheetScale } from "../takeoff/scaleFromDimensions";
import { sheetScale, type StoredViewScales } from "../takeoff/sheetScale";
import type { StrokeSegment } from "../takeoff/wallVectors";
import { scaleFromPrinted } from "../takeoff/scaleFromPrinted";
import { REPRODUCTION_SOURCE, reproductionReading } from "../takeoff/reproductionScale";
import { ARCHITECTURAL_SCALES } from "../takeoff/scaleFromDimensions";
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
/**
 * ── WHAT THE KEYLESS TITLE-BLOCK READER PROPOSES FOR A SHEET ──
 *
 * The TITLE_BLOCK stage names sheets with a model, one call per page, and
 * sits behind the company's AI switch; until it runs (or when it never does)
 * the rail reads "Sheet 5" and the scale form's label box is blank. This
 * stage already reads every page's text, and `sheetNumberFrom` finds the
 * designation in the title block's corner with no model at all — so it
 * proposes the number, and `nameSheet`'s title beside it, with a confidence
 * that says where the number came from: the CORNER is HIGH, the wider
 * region MEDIUM. A page with no designation proposes nothing. The model's
 * later proposal, being newer, still wins where it runs.
 */
export type SheetProposalRow = {
  planId: string;
  ingestJobId: string;
  pageNumber: number;
  sheetNumber: string;
  title: string | null;
  /** The printed scale the sheet declares, when one was read — the rail's "confirm" chip. */
  printedScale: string | null;
  confidence: "HIGH" | "MEDIUM";
  reason: string;
};

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
  /** Record the keyless reader's sheet number and title. Idempotent per ingest job and page. */
  saveSheetProposal: (row: SheetProposalRow) => Promise<void>;
  /**
   * Whether this company has opted into reading its drawings' text
   * (PLAN_TEXT_READ). The keyless names are customer-visible — the rail, the
   * picker, the scale form's label — so they stay behind the same switch the
   * rest of plan-text reading sits behind, OFF until the owner turns it on.
   */
  planTextReadOn: (companyId: string) => Promise<boolean>;
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
  /**
   * The scales captioned under each drawing, for a sheet carrying several at
   * several scales — the case `scaleFromPrinted` refuses, because it cannot
   * tell which drawing a scale belongs to when there is more than one.
   *
   * Undefined on every ordinary sheet, which is most of them.
   */
  viewScales?: StoredViewScales;
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
  /** Counted only for a page with no text layer; see `scannedSheet.ts`. */
  pathOperators: number | null;
  imageOperators: number | null;
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
    // A page with no text layer is either a scan or a drawing with its
    // lettering outlined; the operator counts tell which (`isScannedSheet`).
    // Only then: for a normal sheet the operator list is the expensive read.
    const operators = readable ? null : await doc.pdf.pageStrokes(task.pageNumber);
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
      pathOperators: operators === null ? null : operators.pathOperators,
      imageOperators: operators === null ? null : operators.imageOperators,
    });

    // AFTER the text write and never instead of it: a page whose scale cannot
    // be told has still been inventoried, and the sentence saying why is worth
    // storing. See `declineReason`.
    await deps.saveScaleReading(scaleRow);

    // ── THE SHEET'S OWN NAME, WITH NO MODEL ──
    if (readable && (await deps.planTextReadOn(ctx.companyId))) {
      const read = sheetNumberFrom(page);
      if (read.sheetNumber !== null && read.source !== "none") {
        const named = nameSheet(page.items, { widthPt: page.widthPt, heightPt: page.heightPt });
        await deps.saveSheetProposal({
          planId: ctx.planId,
          ingestJobId: ctx.ingestJobId,
          pageNumber: task.pageNumber,
          sheetNumber: read.sheetNumber,
          title: named.distinct ? named.title.trim() || null : null,
          printedScale: scaleRow.source === "PRINTED" || scaleRow.source === "DIMENSIONS" ? scaleRow.scaleName : null,
          confidence: read.source === "corner" ? "HIGH" : "MEDIUM",
          reason:
            read.source === "corner"
              ? "the designation printed in the title block's corner, read without a model"
              : "the designation found in the title-block region, read without a model — check it",
        });
      }
    }

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
    // A METRIC SHEET DIMENSIONS IN BARE MILLIMETRES and the imperial pattern
    // requires feet, so it reads nothing at all. Read here and handed on;
    // `readSheetScale` uses it ONLY if the imperial pass declines, so no sheet
    // that already reads a scale can change.
    const metric = metricDimensionLabels(page);
    // THE FLOOR THE APP WILL ACTUALLY HONOUR. Without it the reader proposes
    // lines `calibrationNotices` then refuses as too short — which it did, on a
    // real sheet, leaving the estimator unable to finish. See `minLinePoints`.
    const verdict = readSheetScale(page, strokes.segments, labels, {}, metric);
    if (!verdict.ok) {
      // ── A REPRODUCTION: THE DIMENSIONS SAY TWICE OR HALF WHAT THE TITLE BLOCK PRINTS ──
      //
      // Read BEFORE the printed fallback, because the printed scale is exactly
      // the wrong answer on such a sheet. The dimensions' own vote is taken,
      // only when it is a clean factor of two off the one printed scale and a
      // majority of the labels that measured — `reproductionScale.ts` has the
      // rule and the sweep that found no training sheet meeting it.
      const printedNames = printedScalesOnPage(page.items);
      const printedOne = printedNames.length === 1 ? ARCHITECTURAL_SCALES.find((s) => s.name === printedNames[0]) ?? null : null;
      const reproduction = reproductionReading({ verdict, printed: printedOne === null ? null : { name: printedOne.name, feetPerInch: printedOne.feetPerInch } });
      if (reproduction !== null) {
        const paperInches = page.widthPt / 72;
        return {
          planId,
          pageNumber,
          scaleName: reproduction.scaleName,
          source: REPRODUCTION_SOURCE,
          // The sheet's own width at the dimensions' scale, as the printed
          // fallback stores it: two facts about the file, nothing invented.
          x1: 0,
          y1: page.heightPt / page.widthPt / 2,
          x2: 1,
          y2: page.heightPt / page.widthPt / 2,
          declaredDistanceFeet: paperInches * reproduction.feetPerInch,
          // The characters the title block printed, so the screen can say
          // what it disagreed with; the agreeing dimensions are the evidence.
          declaredText: reproduction.printedScaleName,
          agreedText: reproduction.agreed.join("\n"),
          consideredCount: verdict.considered,
          inheritedError: null,
          declineReason: null,
        };
      }
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
      // ── AND THE SHEET THAT CARRIES SEVERAL DRAWINGS AT SEVERAL SCALES ──
      //
      // Which is exactly what the step above refuses: `scaleFromPrinted`
      // declines a page with MORE THAN ONE printed scale on it, because it
      // cannot tell which drawing each belongs to. Reading them per VIEW is
      // how it can — each caption is read against the region its drawing
      // occupies, so the scales stop competing.
      //
      // The sheet itself still has NO scale, and that is recorded honestly: a
      // page-wide calibration would be wrong for every drawing but one. What
      // is stored is the per-view answer, for the workspace to offer.
      const perView = sheetScale({
        textItems: page.items,
        segments: strokes.segments as StrokeSegment[],
        pageSize: { widthPt: page.widthPt, heightPt: page.heightPt },
        fromDimensions: { ok: false, reason: verdict.reason },
        fromPrinted: null,
      });
      if (perView.kind === "VIEWS") {
        return {
          ...empty,
          consideredCount: verdict.considered,
          viewScales: { views: perView.views },
          declineReason:
            `This sheet carries ${perView.views.length} drawings at their own scales, so there is ` +
            `no one scale for the page. Each drawing can be measured at its own.`,
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

  planTextReadOn: async (companyId) => (await aiGate(companyId, "PLAN_TEXT_READ")).ok,

  saveSheetProposal: async (row) => {
    const proposal = {
      proposedSheetNumber: row.sheetNumber,
      proposedTitle: row.title,
      proposedScale: row.printedScale,
      proposedReason: row.reason,
      proposedConfidence: row.confidence,
      model: KEYLESS_MODEL,
      promptVersion: KEYLESS_PROMPT_VERSION,
    };
    await prisma.planSheetProposal.upsert({
      where: { ingestJobId_pageNumber: { ingestJobId: row.ingestJobId, pageNumber: row.pageNumber } },
      create: { ingestJobId: row.ingestJobId, planId: row.planId, pageNumber: row.pageNumber, ...proposal },
      update: proposal,
    });
  },
};

/** What the keyless proposals are filed under — not a model, and said so. */
export const KEYLESS_MODEL = "keyless title-block reader";
export const KEYLESS_PROMPT_VERSION = "keyless-title-block.1";
