import { sheetNumberFrom } from "../../plan-ingest/sheetNumber";
import type { openPlanPdf } from "../../plan-ingest/planPdf";
import { demoEvidence, pairDemoWithNewPlan, type DemoPair } from "../pairDemoPlans";
import { oneFacePerLine, type StrokeSegment } from "../wallVectors";

type Doc = Awaited<ReturnType<typeof openPlanPdf>>;
export type Line = { x1: number; y1: number; x2: number; y2: number };

/** A page's long faces, page-width units: what `pairDemoWithNewPlan` votes with and raw comparison reads. */
export function longFaces(segments: readonly StrokeSegment[], widthPt: number, feetPerUnit: number): Line[] {
  return oneFacePerLine([...segments], feetPerUnit / widthPt)
    .map((f) => ({ x1: f.x1 / widthPt, y1: f.y1 / widthPt, x2: f.x2 / widthPt, y2: f.y2 / widthPt }))
    .filter((f) => Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * feetPerUnit >= 3);
}

/** The set's demolition-to-new pairs, from the one pairer. Lines are read once a set, for the pages it might vote on. */
export async function pairsForSet(doc: Doc, feetPerUnit: number): Promise<DemoPair[]> {
  const sheets = [];
  const lines = new Map<number, Line[]>();
  for (let page = 1; page <= doc.pageCount; page += 1) {
    const text = await doc.pageText(page);
    const reading = sheetNumberFrom(text);
    sheets.push({ pageNumber: page, sheetNumber: reading.sheetNumber, title: reading.regionText.slice(0, 200), demoCaption: demoEvidence(text.items) });
    if (/^(?:A|AD|D)/i.test(reading.sheetNumber ?? "")) {
      const s = await doc.pageStrokes(page);
      if (s.segments.length >= 100 && s.segments.length < 200_000) lines.set(page, longFaces(s.segments, s.widthPt, feetPerUnit));
    }
  }
  return pairDemoWithNewPlan(sheets, { lines, feetPerUnit });
}
