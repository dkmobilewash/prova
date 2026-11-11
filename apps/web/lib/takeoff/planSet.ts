import { ownsFloorPlan } from "@/lib/takeoff/takeoffSheet";
import { takeoffRank } from "@/lib/takeoff/sheetSuitability";
import type { ScalePrefill } from "@/lib/takeoff-plan-view";
import { effectiveSheetNumber, effectiveTitle, type SheetRow } from "@/lib/plan-ingest/sheetIndex";

/**
 * ── THE SET, SORTED, WITH EACH SHEET'S SCALE AND HOW SURE IT IS ──
 *
 * The guided flow's Plans and Scale steps (Phase 2). Built only from what the
 * inventory and the scale reader already stored: the title block's number,
 * title and page type, and the scale reading per page. No model is asked
 * anything here.
 *
 * Confidence, in the reader's own terms:
 *   - set      — a person (or Confirm scales) has saved a scale on it;
 *   - high     — read off dimensions printed on the drawing, which agreed;
 *   - printed  — only the title block's scale, nothing on the sheet confirms
 *                it (or it is a reduced print whose correction must be read);
 *   - none     — nothing read.
 */
export type SheetCategory = "floor" | "demolition" | "rcp" | "elevations" | "details" | "schedules" | "cover" | "other";
export const CATEGORY_ORDER: readonly SheetCategory[] = ["floor", "demolition", "rcp", "elevations", "details", "schedules", "cover", "other"];
export const CATEGORY_LABEL: Record<SheetCategory, string> = {
  floor: "Floor plans",
  demolition: "Demolition",
  rcp: "Reflected ceiling plans",
  elevations: "Elevations",
  details: "Details and sections",
  schedules: "Schedules",
  cover: "Cover and index",
  other: "Other sheets",
};

export function sheetCategory(number: string | null, title: string | null, pageType: string | null): SheetCategory {
  const t = title ?? "";
  if (/\bDEMO(LITION)?\b|\bDEMOLISH/i.test(t) || /^AD[-.\s]?\d/i.test(number ?? "")) return "demolition";
  if (/REFLECTED\s+CEILING|\bRCP\b|CEILING\s+PLANS?\b/i.test(t)) return "rcp";
  if (ownsFloorPlan(number, title)) return "floor";
  if (/\bCOVER\b|TITLE\s+SHEET|\bINDEX\b/i.test(t) || pageType === "COVER") return "cover";
  if (/\bSCHED(ULES?)?\b/i.test(t) || pageType === "SCHEDULE") return "schedules";
  if (/\bELEV(ATIONS?)?\b/i.test(t) || pageType === "ELEVATION") return "elevations";
  if (/\bDETAILS?\b|\bSECTIONS?\b/i.test(t) || pageType === "DETAIL" || pageType === "SECTION") return "details";
  const score = takeoffRank(number, title).score;
  // A title that says nothing scores only the A-series tie-break (5). When the
  // title block's reader called the page OTHER, that is not a floor plan: on
  // ELEVEN03 it put 51 code, UL, ANSI, ADA and TAS sheets in the scale step's
  // "80 floor plans", so the step could never finish (29 were real).
  if (pageType === "OTHER" && score <= 5) return "other";
  // ── A KEYLESS TITLE THAT NAMES NO PLAN IS NOT A FLOOR PLAN ──
  // With plan reading off nothing reads the page type, and the A-series tie-break
  // alone made "GUARDRAIL ATTACHMENT", "OFFICE 7 - NORTH" and "SKYLIGHT PERFORMANCE"
  // floor plans to scale, so the step never finished (walk, 2026-11-08, E Street and
  // Green Bay with AI off). A title that says nothing about a plan, a floor, a level,
  // a unit, a suite, a wing or an enlarged part ("UNIT D1" is a residential plan) is
  // evidence it is not one; NO title is no evidence, and stays a floor plan.
  if (pageType === null && t.trim() !== "" && score <= 5 && !/\b(?:PLANS?|FLOORS?|LEVELS?|UNITS?|SUITES?|WINGS?|ENLARGED)\b/i.test(t)) return "other";
  if (score > 0 || (pageType === "PLAN" && score >= 0)) return "floor";
  return "other";
}

export type ScaleConfidence = "set" | "high" | "printed" | "none";

export type PlanSetRow = {
  pageNumber: number;
  number: string | null;
  title: string | null;
  category: SheetCategory;
  confidence: ScaleConfidence;
  /** The scale read, or printed, when there is one. */
  scaleName: string | null;
  /** The mark in words: why it is that sure. */
  why: string;
  /** "Use the printed scale" is a one-click fix on this sheet. */
  printedFix: boolean;
  /**
   * A floor plan the takeoff needs (`floorPlansOfTheWork`: one plan per floor). False for a
   * floor plan it does not (Baker's A100 overall beside A101); absent when not known. The
   * summary, the "still to do" list and the step's done-ness count only these, so the plan
   * set never says "0 of 33 floor plans" while the stepper says "Scale 8" (Topeka, 2026-11-11).
   */
  needed?: boolean;
};

export function planSetRows(input: {
  pages: readonly number[];
  sheets: ReadonlyMap<number, { number: string | null; title: string | null; pageType: string | null }>;
  scaled: ReadonlySet<number>;
  prefill: Readonly<Record<number, ScalePrefill>>;
  printed: Readonly<Record<number, string>>;
  /** Pages carrying several drawings at several scales. */
  multiScale: ReadonlySet<number>;
  decline: Readonly<Record<number, string>>;
  /** Pages whose own drawings say FLOOR PLAN (`sureFloorPlans.ts`): a floor plan where nothing else names the sheet. */
  sure?: ReadonlySet<number>;
  /** The floor plans the takeoff needs; when given, each row says whether it is one. */
  needed?: ReadonlySet<number>;
}): PlanSetRow[] {
  const rows = input.pages.map((pageNumber): PlanSetRow => {
    const sheet = input.sheets.get(pageNumber) ?? { number: null, title: null, pageType: null };
    const offer = input.prefill[pageNumber];
    const named = sheetCategory(sheet.number, sheet.title, sheet.pageType);
    const base = {
      pageNumber,
      number: sheet.number,
      title: sheet.title,
      category: named === "other" && input.sure?.has(pageNumber) === true ? ("floor" as const) : named,
      ...(input.needed === undefined ? {} : { needed: input.needed.has(pageNumber) }),
    };
    if (input.scaled.has(pageNumber)) return { ...base, confidence: "set", scaleName: offer?.scaleName ?? input.printed[pageNumber] ?? null, why: "A scale is saved on this sheet", printedFix: false };
    if (offer && !offer.unconfirmed && offer.reducedPrintCaution === undefined) {
      return { ...base, confidence: "high", scaleName: offer.scaleName, why: `Matched ${offer.agreed.length} printed dimension${offer.agreed.length === 1 ? "" : "s"}`, printedFix: false };
    }
    if (offer) {
      return {
        ...base,
        confidence: "printed",
        scaleName: offer.scaleName,
        why: offer.reducedPrintCaution ?? "From the title block only: nothing on the sheet confirms it",
        printedFix: offer.reducedPrintCaution === undefined,
      };
    }
    if (input.multiScale.has(pageNumber)) return { ...base, confidence: "none", scaleName: null, why: "Several drawings at different scales: set the one you will measure", printedFix: false };
    // The title block's own word, when there is one, goes in the reason and not
    // the scale column: "No scale" beside a scale read as a contradiction.
    const said = input.printed[pageNumber];
    return { ...base, confidence: "none", scaleName: null, why: `${input.decline[pageNumber] ?? "No scale could be read"}${said ? ` (the title block says ${said})` : ""}`, printedFix: false };
  });
  return rows.sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) || a.pageNumber - b.pageNumber);
}

/** The Scale step is done when every floor plan has a scale; with none recognised, when any sheet has. */
export function scaleStepDone(rows: readonly Pick<PlanSetRow, "category" | "confidence" | "needed">[]): boolean {
  const floors = rows.filter((row) => row.category === "floor" && row.needed !== false);
  return floors.length > 0 ? floors.every((row) => row.confidence === "set") : rows.some((row) => row.confidence === "set");
}

/** The rows, from what the takeoff page has already loaded (`loadTakeoffWorkspace`). */
export function planSetFromLoaded(data: {
  sheets: readonly { pageNumber: number; calibration: unknown }[];
  sheetRows: readonly SheetRow[];
  scalePrefillByPage: Readonly<Record<number, ScalePrefill>>;
  printedScaleByPage: Readonly<Record<number, string>>;
  viewScalesByPage: Readonly<Record<number, readonly unknown[]>>;
  scaleDeclineByPage: Readonly<Record<number, string>>;
  sureFloorPlanPages?: readonly number[];
  floorPlansNeeded?: readonly number[];
}): PlanSetRow[] {
  const pages = [...new Set([...data.sheetRows.map((row) => row.pageNumber), ...data.sheets.map((sheet) => sheet.pageNumber)])].sort((a, b) => a - b);
  return planSetRows({
    pages,
    sheets: new Map(data.sheetRows.map((row) => [row.pageNumber, { number: effectiveSheetNumber(row), title: effectiveTitle(row), pageType: row.proposal?.pageType ?? null }])),
    scaled: new Set(data.sheets.filter((sheet) => sheet.calibration !== null).map((sheet) => sheet.pageNumber)),
    prefill: data.scalePrefillByPage,
    printed: data.printedScaleByPage,
    multiScale: new Set(Object.entries(data.viewScalesByPage).filter(([, views]) => views.length > 1).map(([page]) => Number(page))),
    decline: data.scaleDeclineByPage,
    sure: new Set(data.sureFloorPlanPages ?? []),
    // Only when the load knew them: an empty list must not make every floor plan unneeded.
    ...(data.floorPlansNeeded !== undefined && data.floorPlansNeeded.length > 0 ? { needed: new Set(data.floorPlansNeeded) } : {}),
  });
}
