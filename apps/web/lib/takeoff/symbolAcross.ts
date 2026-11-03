import { sheetNumberFrom } from "@/lib/plan-ingest/sheetNumber";
import { nameSheet } from "./realplan/nameSheet";
import { printedScalesOnPage } from "./printedScales";
import { scaleFromPrinted } from "./scaleFromPrinted";
import { findSymbolsFrom, scaleSymbolTemplate, type SymbolTemplate } from "./symbolSignature";
import { isLegendSheet, sheetInScope, type SheetScope } from "./symbolScope";
import type { StrokeSegment } from "./wallVectors";

/** The template a count was boxed with, as Find on all sheets carries it from sheet to sheet. */
export type AcrossTemplate = { made: SymbolTemplate; widthPt: number; fpu: number | null; number: string | null };
export type AcrossSheet = {
  number: string | null;
  count: number;
  scaling: string;
  xs: number[];
  ys: number[];
  /** A legend sheet: listed, never counted. */
  legend?: boolean;
};

/**
 * One sheet of Find on all sheets: null when the sheet is outside the scope, else
 * its count. Words and segments in points, as the page reads them. Pure, so the
 * viewer and a test run the same code.
 */
export function acrossSheet(input: {
  tpl: AcrossTemplate;
  scope: SheetScope;
  pageNumber: number;
  words: readonly { str: string; x: number; y: number; width: number; height: number }[];
  segments: readonly StrokeSegment[];
  widthPt: number;
  heightPt: number;
}): AcrossSheet | null {
  const { tpl, words, widthPt: W, heightPt: H } = input;
  const number = sheetNumberFrom({ pageNumber: input.pageNumber, widthPt: W, heightPt: H, rotation: 0, items: words } as never).sheetNumber;
  if (!sheetInScope(input.scope, tpl.number, number)) return null;
  const named = nameSheet(words, { widthPt: W, heightPt: H });
  if (isLegendSheet(named.distinct ? named.title : null)) return { number, count: 0, scaling: "legend", xs: [], ys: [], legend: true };
  const segs = input.segments.map((s) => ({ ...s, x1: s.x1 / W, y1: s.y1 / W, x2: s.x2 / W, y2: s.y2 / W }));
  const text = words.map((w) => ({ x: w.x / W, y: (w.y - w.height) / W, width: w.width / W, height: w.height / W, str: w.str }));
  const paper = scaleSymbolTemplate(tpl.made, tpl.widthPt / W);
  let best = { matches: findSymbolsFrom(segs, text, paper).matches, scaling: "paper" };
  const printed = scaleFromPrinted(printedScalesOnPage(words as never), W, H)?.declaredDistanceFeet ?? null;
  if (tpl.fpu !== null && printed !== null && Math.abs(tpl.fpu / printed - 1) > 0.05) {
    const model = findSymbolsFrom(segs, text, scaleSymbolTemplate(tpl.made, (tpl.widthPt / W) * (tpl.fpu / printed))).matches;
    if (model.length > best.matches.length) best = { matches: model, scaling: `at this sheet's scale (x${(tpl.fpu / printed).toFixed(2)})` };
  }
  return {
    number,
    count: best.matches.length,
    scaling: best.scaling,
    xs: best.matches.map((m) => (m.box.x1 + m.box.x2) / 2),
    ys: best.matches.map((m) => (m.box.y1 + m.box.y2) / 2),
  };
}
