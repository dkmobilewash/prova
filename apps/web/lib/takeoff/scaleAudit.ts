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
export function classifyOutcome(derived: string | null, printed: string | null): AuditOutcome {
  if (derived === null) return printed === null ? "DECLINED" : "MISSED";
  if (printed === null) return "NO_TITLE_SCALE";
  return derived === printed ? "AGREES" : "DISAGREES";
}

export type AuditPage = {
  file: string;
  pageNumber: number;
  outcome: AuditOutcome;
  /** What the geometry said, if anything. */
  derived: string | null;
  /** What the title block printed, if anything. */
  printed: string | null;
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
 * A scale name out of title-block text.
 *
 * The title block is a flattened run of its region's strings, so the scale sits
 * among sheet numbers, dates and a firm's address. This finds the
 * `<something> = <something>` shape and hands each candidate to
 * `standardScaleFromText`, which is the existing matcher and knows about the
 * prime-mark variants.
 *
 * Returns the first that MATCHES a standard scale rather than the first that
 * looks like one, because a title block carrying `AS NOTED` and a real scale
 * should yield the real one — and `standardScaleFromText` already answers null
 * for `AS NOTED`, which is what makes that work.
 */
export function printedScaleFromTitleBlock(text: string | null): string | null {
  if (!text) return null;
  // `1/4" = 1'-0"`, `1/4"=1'0"`, `3/32" = 1'-0"`, and the prime-mark variants
  // `standardScaleFromText` normalises.
  // The quote class must carry the TRUE PRIME MARKS as well as the ASCII and
  // curly ones — `′` and `″`, which is what a CAD title block actually
  // letters a scale with. `standardScaleFromText` normalises them, but it never
  // sees a candidate this pattern did not find first, and a first version of
  // this omitted them: `1/4″ = 1′-0″` came back null.
  const QUOTES = "\"'’“”′″";
  const candidates =
    text.match(new RegExp(`[0-9][0-9/\\-\\s]*[${QUOTES}]?\\s*=\\s*[0-9][0-9\\s${QUOTES}-]*`, "g")) ?? [];
  for (const candidate of candidates) {
    const match = standardScaleFromText(candidate.trim());
    if (match !== null) return match.name;
  }
  return null;
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
        const block = titleBlockText(text);
        const printed = printedScaleFromTitleBlock(block?.text ?? null);

        if (!verdict.ok) {
          out.push({
            file,
            pageNumber,
            outcome: classifyOutcome(null, printed),
            derived: null,
            printed,
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
          outcome: classifyOutcome(verdict.scaleName, printed),
          derived: verdict.scaleName,
          printed,
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
