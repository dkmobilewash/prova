import type { Buffer } from "node:buffer";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { openPlanPdf, titleBlockText } from "../plan-ingest/planPdf";
import { dimensionLabels } from "../plan-ingest/dimensionLabels";
import { standardScaleFromText } from "../takeoff-plan";
import { scaleFromDimensions } from "./scaleFromDimensions";

/**
 * AUDITING AUTOMATIC SCALE OVER A WHOLE BID PACKAGE, and the point is that the
 * package CHECKS ITSELF.
 *
 * ── WHY THIS EXISTS ──
 *
 * `scaleFromDimensions` was built against ONE real CAD export, and the thing
 * tuned on it is the riskiest part: the rule that a dimension label sits centred
 * on the line it measures, within a fixed distance of it. That is how one
 * program draws dimensions. Revit, AutoCAD, Vectorworks and ArchiCAD each place
 * the text a little differently, and if one of them puts it further off the line
 * the feature DECLINES on every sheet from that program — which looks like
 * nothing rather than like a bug.
 *
 * So the measurement has to be cheap to repeat, on whatever files turn up. One
 * command over a folder, and it stays true when a new program appears in a year.
 *
 * ── THE ANSWER KEY IS ALREADY ON THE SHEET, AND COSTS NOTHING ──
 *
 * Most sheets print their scale in the title block. That makes two INDEPENDENT
 * readings of one fact: the characters an architect lettered, and the geometry
 * this module derives. Agreement across forty sheets is real evidence; a
 * disagreement names exactly which sheet to open.
 *
 * And it needs no model and no spend. `titleBlockText` already extracts that
 * region, and `standardScaleFromText` already matches a printed scale NAME onto
 * the standard table — it is what `calibrationNotices` uses for its
 * title-block-disagreement warning. This reuses both rather than paying a
 * `plan-title-block` call per page.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ──
 *
 * It writes nothing, stores nothing and sends nothing anywhere. The files it
 * reads are real customer bid packages: *"never use real customer files in tests
 * or fixtures"*, so this is a tool pointed at them rather than anything that
 * takes a copy. Nothing it reads enters the repo.
 *
 * `NO_TITLE_SCALE` is not a failure of either side. A sheet can simply not print
 * its scale — the export this feature was built from does not, which is worth
 * knowing before reading a column of them as a problem.
 */

/**
 * THE PDFs UNDER A SET OF PATHS, and it lives here rather than in the eval so
 * that "you pointed me at nothing" is a tested behaviour.
 *
 * A mutation is why: removing the eval's own `files.length > 0` assertion left
 * everything green, because a path matching no PDF produces a run with no pages,
 * no disagreements and a clean summary — which reads exactly like a good result.
 * A typo in a folder name is the whole of what it takes. That is this repo's
 * most expensive recurring shape, and `agreementRate` returning null for an
 * unmeasurable run is the other half of the same defence.
 *
 * `~` is expanded because a shell does not expand it inside a quoted variable,
 * and the obvious invocation puts it in one.
 */
export function planFilesUnder(targets: readonly string[], home = process.env.HOME ?? ""): string[] {
  const out: string[] = [];
  for (const raw of targets) {
    const path = raw.startsWith("~/") && home ? join(home, raw.slice(2)) : raw;
    let info;
    try {
      info = statSync(path);
    } catch {
      // A path that does not exist contributes nothing, and the caller's count
      // check is what turns that into a visible refusal.
      continue;
    }
    if (!info.isDirectory()) {
      if (path.toLowerCase().endsWith(".pdf")) out.push(path);
      continue;
    }
    // One level deep: a bid package is a flat folder of sheets.
    for (const name of readdirSync(path).sort()) {
      if (name.toLowerCase().endsWith(".pdf")) out.push(join(path, name));
    }
  }
  return out;
}

/** Splits what the operator typed into paths. Commas and newlines, because a
 *  pasted list arrives as either. */
export function auditTargets(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** What the two readings did, per page. */
export type AuditOutcome =
  /** Derived a scale, and the title block says the same. The strong result. */
  | "AGREES"
  /** Derived a scale and the title block names a DIFFERENT one. The row to open. */
  | "DISAGREES"
  /** Derived a scale; the sheet prints no scale to check it against. */
  | "NO_TITLE_SCALE"
  /** Declined, and the title block does name a scale — so there WAS one to find. */
  | "MISSED"
  /** Declined, and the sheet names no scale either. Nothing was there. */
  | "DECLINED"
  /**
   * The sheet prints MORE THAN ONE scale — a plan and an enlarged detail, say.
   * Both are correct, so there is no single answer key, and picking the one that
   * matched would manufacture an `AGREES`. Excluded from the headline for the
   * same reason `NO_TITLE_SCALE` is.
   */
  | "MANY_PRINTED"
  /** The page could not be read at all. */
  | "ERROR";

/**
 * WHICH OUTCOME TWO READINGS MAKE, pulled out of `auditPlanFile` so it can be
 * tested without a PDF.
 *
 * It was inline, and a mutation proved why that was not good enough: flipping
 * `DISAGREES` to `AGREES` — the audit calling a wrong scale right, which is the
 * single thing it exists to notice — left the whole suite GREEN, because every
 * test reached the arithmetic and none reached the judgement. The same mutation
 * now reds.
 *
 * `MISSED` versus `DECLINED` is the distinction worth keeping straight: both
 * declined, but one had an answer printed on the sheet and did not find it. Only
 * the first is a shortfall, and `agreementRate` counts only the first.
 */
export function classifyOutcome(derived: string | null, printed: readonly string[]): AuditOutcome {
  // MORE THAN ONE PRINTED SCALE IS DECIDED HERE AND NOT IN THE CALLER, because a
  // mutation showed what happens when it is: cherry-picking the first of two
  // left the whole suite green, since every test reached
  // `printedScalesOnPage` and none reached the caller's choice. A sheet with a
  // plan and an enlarged detail prints two correct scales, and picking whichever
  // matched would manufacture an `AGREES` — the one outcome an audit must never
  // produce.
  if (printed.length > 1) return "MANY_PRINTED";
  const one = printed[0] ?? null;
  if (derived === null) return one === null ? "DECLINED" : "MISSED";
  if (one === null) return "NO_TITLE_SCALE";
  return derived === one ? "AGREES" : "DISAGREES";
}

export type AuditPage = {
  file: string;
  pageNumber: number;
  outcome: AuditOutcome;
  /** What the geometry said, if anything. */
  derived: string | null;
  /** The scale printed on the sheet, when exactly one is. */
  printed: string | null;
  /** Every distinct printed scale found, so a multi-view sheet is visible
   *  rather than reduced to whichever one happened to match. */
  printedAll: string[];
  /** Printed dimensions found, and how many agreed on the winner. */
  found: number;
  agreed: number;
  /** The error the proposed line carries, as a fraction. */
  inheritedError: number | null;
  /** Why it declined, when it did. */
  reason: string | null;
  widthPt: number;
  heightPt: number;
};

/**
 * EVERY STANDARD SCALE PRINTED ANYWHERE ON THE PAGE, distinct, in reading order.
 *
 * ── THIS LOOKED IN THE TITLE BLOCK ONLY, AND A REAL SHEET PROVED THAT WRONG ──
 *
 * The second export this was pointed at reported `NO_TITLE_SCALE` while printing
 * `1/4" = 1'-0"` in plain text — at x=958 on a 3,024pt page, under the drawing
 * rather than in the title-block corner. Its title block says **`SCALE: AS
 * NOTED`**, which is not a missing answer but the ordinary convention: each view
 * is captioned with its own scale beneath it, and the block defers to them.
 *
 * So the answer key was on the sheet and this function was looking past it,
 * which would have read as an unverifiable derivation forever. Whole page now.
 *
 * ── AND WHY IT RETURNS ALL OF THEM RATHER THAN THE FIRST ──
 *
 * A sheet carrying a plan and an enlarged detail prints TWO scales, both
 * correct. Taking the first would silently cherry-pick, and taking whichever
 * matched would turn an unverifiable page into a false `AGREES` — the one
 * outcome an audit must not manufacture. Several distinct scales is a fact about
 * the sheet, reported as such, and it is the same multi-scale sheet `#640`
 * already warns about.
 *
 * `standardScaleFromText` is what decides whether a candidate IS a scale, so
 * `AS NOTED`, `NTS` and a metric `1:100` all yield nothing — and that is reused
 * rather than re-decided here.
 */
export function printedScalesOnPage(items: readonly { str: string }[]): string[] {
  // The quote class must carry the TRUE PRIME MARKS as well as the ASCII and
  // curly ones — `′` and `″`, which is what a CAD title block actually
  // letters a scale with. `standardScaleFromText` normalises them, but it never
  // sees a candidate this pattern did not find first, and a first version of
  // this omitted them: `1/4″ = 1′-0″` came back null.
  const QUOTES = "\"'’“”′″";
  const pattern = new RegExp(`[0-9][0-9/\\-\\s]*[${QUOTES}]?\\s*=\\s*[0-9][0-9\\s${QUOTES}-]*`, "g");

  const found: string[] = [];
  for (const item of items) {
    // A PARAGRAPH IS NOT A CAPTION. One real sheet carries a disclaimer reading
    // "Do not scale dimensions from prints… not always drawn to scale" — which
    // this filter is not needed for, since it holds no `X = Y` figure. What it
    // IS needed for is the general note that does: "DETAILS ARE DRAWN AT
    // 1/2\" = 1'-0\" UNLESS NOTED OTHERWISE" is an ordinary sentence on an
    // ordinary sheet, and without this it becomes a second printed scale and
    // turns a checkable page into `MANY_PRINTED`.
    if (item.str.length > 60) continue;
    for (const candidate of item.str.match(pattern) ?? []) {
      const match = standardScaleFromText(candidate.trim());
      if (match !== null && !found.includes(match.name)) found.push(match.name);
    }
  }
  return found;
}

/**
 * Audits every page of one PDF.
 *
 * ONE OPEN DOCUMENT PER FILE, because pdfjs detaches the buffer it is handed —
 * see `openPlanPdf`. A second open from the same bytes throws, which is the
 * defect that cost an afternoon when this feature first wanted both layers.
 */
export async function auditPlanFile(file: string, bytes: Buffer, maxPages = 400): Promise<AuditPage[]> {
  const out: AuditPage[] = [];
  const doc = await openPlanPdf(bytes);
  try {
    const pages = Math.min(doc.pageCount, maxPages);
    for (let pageNumber = 1; pageNumber <= pages; pageNumber += 1) {
      try {
        const text = await doc.pageText(pageNumber);
        const strokes = await doc.pageStrokes(pageNumber);
        const labels = dimensionLabels(text);
        const verdict = scaleFromDimensions(labels, strokes.segments);
        // THE WHOLE PAGE, not the title block — see `printedScalesOnPage`. More
        // than one distinct scale means the sheet carries views at different
        // scales, which is ordinary drafting and not something to resolve by
        // picking one.
        const printedScales = printedScalesOnPage(text.items);
        const printed = printedScales.length === 1 ? printedScales[0] : null;

        if (!verdict.ok) {
          out.push({
            file,
            pageNumber,
            outcome: classifyOutcome(null, printedScales),
            derived: null,
            printed,
            printedAll: printedScales,
            found: verdict.considered,
            agreed: 0,
            inheritedError: null,
            reason: verdict.reason,
            widthPt: text.widthPt,
            heightPt: text.heightPt,
          });
          continue;
        }

        out.push({
          file,
          pageNumber,
          outcome: classifyOutcome(verdict.scaleName, printedScales),
          derived: verdict.scaleName,
          printed,
          printedAll: printedScales,
          found: verdict.considered,
          agreed: verdict.agreed.length,
          inheritedError: verdict.inheritedError,
          reason: null,
          widthPt: text.widthPt,
          heightPt: text.heightPt,
        });
      } catch (error) {
        out.push({
          file,
          pageNumber,
          outcome: "ERROR",
          derived: null,
          printed: null,
          printedAll: [],
          found: 0,
          agreed: 0,
          inheritedError: null,
          reason: error instanceof Error ? error.message : String(error),
          widthPt: 0,
          heightPt: 0,
        });
      }
    }
  } finally {
    await doc.close();
  }
  return out;
}

export type AuditSummary = Record<AuditOutcome, number> & { pages: number };

export function summarise(pages: readonly AuditPage[]): AuditSummary {
  const summary: AuditSummary = {
    pages: pages.length,
    AGREES: 0,
    DISAGREES: 0,
    NO_TITLE_SCALE: 0,
    MANY_PRINTED: 0,
    MISSED: 0,
    DECLINED: 0,
    ERROR: 0,
  };
  for (const page of pages) summary[page.outcome] += 1;
  return summary;
}

/**
 * THE NUMBER THE WHOLE AUDIT IS FOR.
 *
 * Of the pages where both readings exist — the only ones where agreement means
 * anything — what fraction agree. `NO_TITLE_SCALE` is excluded because there was
 * nothing to check against, and counting it either way would move this figure
 * for a reason that is not about accuracy.
 *
 * Null when no page had both, which is itself the result: a package whose sheets
 * print no scales cannot check this feature, and saying so beats reporting 100%
 * of nothing.
 */
export function agreementRate(pages: readonly AuditPage[]): number | null {
  const checkable = pages.filter((p) => p.outcome === "AGREES" || p.outcome === "DISAGREES" || p.outcome === "MISSED");
  if (checkable.length === 0) return null;
  return checkable.filter((p) => p.outcome === "AGREES").length / checkable.length;
}
