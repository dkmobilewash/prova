import { after } from "next/server";
import { prisma } from "@prova/db";
import { readPlanBytes } from "@/lib/plan-ingest/planBytes";
import { openPlanPdf } from "@/lib/plan-ingest/planPdf";
import { pagesToSample } from "./sheetTemplate";
import { findWallsOnSheet, inPageWidthUnits, type SheetTextItem } from "./findWallsOnSheet";
import { SheetTooDenseError, type StrokeSegment } from "./wallVectors";
import type { MatchableWallType } from "./wallTypeMatch";
import { proposalRowsFor } from "./wallProposal";

/**
 * FINDING THE WALLS THE MOMENT A SCALE IS ACCEPTED, so the groups are waiting
 * when the estimator looks at the sheet instead of sitting behind a button.
 *
 * ── IT MUST NEVER FAIL THE SAVE ──
 *
 * This runs AFTER the response has gone out, and every path out of it is
 * caught. A calibration that succeeded and then reported failure because a
 * courtesy job threw is a worse bug than no detection at all: the estimator
 * would retype a scale that is already stored, and the second save is the one
 * that would look broken.
 *
 * So the contract is one-way. It writes proposals or it writes nothing, and
 * either way the browser has already been answered.
 *
 * ── WHY A SAVED CALIBRATION IS THE ONLY TRIGGER ──
 *
 * One answer to "why did this run", which is what makes it debuggable. It is
 * also the first moment detection is POSSIBLE — wall geometry in page-width
 * units is not a length until something says how big the sheet is — and the
 * moment it is most wanted, because somebody has just said which sheet they
 * care about.
 */

export type DetectTarget = {
  pageId: string;
  calibrationId: string;
  planId: string;
  companyId: string;
  /** 1-based, the way the viewer and the title block both count. */
  pageNumber: number;
  /** Feet per page WIDTH unit, from the calibration this is keyed to. */
  feetPerUnit: number;
  wallTypes: MatchableWallType[];
};

export async function detectWallsForCalibration(target: DetectTarget): Promise<void> {
  // SCOPED BY COMPANY in the read itself, not by a check afterwards — this runs
  // detached from the request, so there is no context left to trust.
  const read = await readPlanBytes(target.planId, target.companyId);
  if (!read.ok) return;

  // ONE DOCUMENT FOR BOTH LAYERS. `openPlanPdf` hands the bytes to pdfjs as a
  // VIEW and pdfjs DETACHES the buffer behind it, so a second open on the same
  // Buffer throws `Cannot perform Construct on a detached ArrayBuffer` — the
  // trap `PlanPdf.pageStrokes` documents.
  const doc = await openPlanPdf(read.bytes);
  try {
    if (target.pageNumber < 1 || target.pageNumber > doc.pageCount) return;

    const strokes = await doc.pageStrokes(target.pageNumber);
    const text = await doc.pageText(target.pageNumber);

    // BASELINE `y`, HANDED OVER UNSHIFTED. `findWallsOnSheet` moves each word
    // to its top edge itself — see `fromBaseline`. Shifting here as well would
    // put every text box one glyph height out, and nothing would throw: the
    // lettering filter would simply stop covering the lettering.
    const textItems: SheetTextItem[] = text.items.map((item) => ({
      str: item.str,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
    }));

    // THE SET'S OWN TEMPLATE, read off other sheets. The frame, the title block
    // and the logo are the only geometry at the same page position on every
    // sheet of a set; a wall is not. Each sampled sheet is converted in ITS OWN
    // page width, which is what makes two sheets comparable at all.
    const sampledSheets: StrokeSegment[][] = [];
    let sampleFailed = false;
    for (const pageNumber of pagesToSample(doc.pageCount, target.pageNumber)) {
      try {
        const other = await doc.pageStrokes(pageNumber);
        sampledSheets.push(other.segments.map(inPageWidthUnits(other.widthPt)));
      } catch {
        // ONE BAD PAGE MUST NOT COST THE SHEET IN FRONT OF SOMEBODY. The
        // fail-safe direction is "no template filter", never "no walls", so a
        // partial read is discarded rather than used — and `null` is how the
        // pipeline is told to skip the pass entirely.
        sampleFailed = true;
        break;
      }
    }

    const found = findWallsOnSheet({
      segments: strokes.segments,
      textItems,
      pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
      feetPerUnit: target.feetPerUnit,
      wallTypes: target.wallTypes,
      sampledSheets: sampleFailed ? null : sampledSheets,
    });

    // NOTHING FOUND IS NOT A FAILURE AND WRITES NOTHING. A sheet with no walls
    // on it — a schedule, a detail page, a site plan — is a fact about the
    // drawing, and a row saying "no walls" would be indistinguishable from
    // never having looked.
    if (found.groups.length === 0) return;

    // APPEND-ONLY, so there is nothing to delete first. A second run under the
    // same calibration writes a second set; the reader takes the newest
    // `createdAt`, and `createMany` gives every row of one run the same one.
    await prisma.takeoffWallProposal.createMany({
      data: proposalRowsFor(found.groups, {
        pageId: target.pageId,
        calibrationId: target.calibrationId,
      }),
    });
  } catch (error) {
    // `SheetTooDenseError` IS A FACT ABOUT THE DRAWING rather than a failure: a
    // sheet with more geometry than the pairing budget allows is refused by
    // design, and the viewer says so in its own words when somebody opens it.
    // Logged at info, not error, so it does not read as a fault in the alerting.
    if (error instanceof SheetTooDenseError) {
      console.info("[takeoff] sheet too dense to detect", {
        planId: target.planId,
        pageNumber: target.pageNumber,
      });
      return;
    }
    console.error(
      "[takeoff] wall detection after calibration failed",
      { planId: target.planId, pageNumber: target.pageNumber },
      error,
    );
  } finally {
    // pdfjs holds per-document state, which `PlanPdf.close` exists for.
    await doc.close().catch(() => {});
  }
}

/**
 * The same work, started once the response has gone out.
 *
 * `after()` keeps the function alive for it; a bare `void` would not, which is
 * what `floatingPromiseCensus` is for. Outside a request — a database test, a
 * script — `after()` THROWS and there is nothing to outlive, so nothing runs:
 * detection is a courtesy to the person who just pressed Save, not a job queue.
 * Modelled on `runAgentAfterResponse`, which carries the same reasoning.
 *
 * NOTHING HERE CAN REACH THE CALLER. The inner work catches its own errors and
 * this catches `after()` itself, so an action that calls it cannot be made to
 * fail by anything detection does.
 */
export function detectWallsAfterResponse(target: DetectTarget): void {
  try {
    after(() =>
      detectWallsForCalibration(target).catch((error) => {
        // Unreachable in practice — the function above catches everything — and
        // kept because "unreachable" is a claim about today's code.
        console.error("[takeoff] detection after response failed", { planId: target.planId }, error);
      }),
    );
  } catch {
    // Not in a request scope. See above.
  }
}
