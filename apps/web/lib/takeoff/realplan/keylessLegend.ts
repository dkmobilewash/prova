import type { PlanPdf } from "../../plan-ingest/planPdf";
import { readLegendFromText } from "../legendText";
import { legendPages } from "../legendPages";
import { readPartitionAssembly } from "../partitionAssembly";
import { pageLines } from "../planTextRead";
import { tagSymbols } from "../tagSymbols";
import type { MatchableWallType } from "../wallTypeMatch";

const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The set's wall legend read from the pages' text with no model: `readLegendFromText` on every page
 * `legendPages` ranks 0-2, the richest read of each code kept, the legend's U.N.O. notes carried on
 * their types. The same read as `zzTypeTable.eval.ts` and the WALL_LEGEND stage's text fallback;
 * `lines` kept so a type's height rule can be read (`typeHeightRule`).
 */
export async function keylessLegend(doc: PlanPdf): Promise<{ types: (MatchableWallType & { lines: string[] })[]; codes: string[] }> {
  const richest = new Map<string, { code: string; lines: string[] }>();
  const uno: { code: string; note: string }[] = [];
  for (let p = 1; p <= doc.pageCount; p += 1) {
    let text;
    try { text = await doc.pageText(p); } catch { continue; }
    const rank = legendPages([{ page: p, title: null, lines: await pageLines(doc, p) }])[0]?.rank;
    if (rank === undefined || rank > 2) continue;
    const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
    const strokes = await doc.pageStrokes(p);
    const read = readLegendFromText({ items, widthPt: text.widthPt, heightPt: text.heightPt, symbols: tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 }) });
    for (const t of read.types) {
      const k = normCode(t.code);
      if ((richest.get(k)?.lines.length ?? -1) < t.lines.length) richest.set(k, { code: t.code, lines: t.lines });
    }
    uno.push(...read.uno);
  }
  const types = [...richest.values()].map((t) => {
    const r = readPartitionAssembly({ lines: t.lines, where: "text" }).read;
    const thicknessIn = r.studWidthIn === null ? null : r.studWidthIn + 2 * (r.layersPerSide ?? 1) * (r.boardThicknessIn ?? 0);
    return { id: t.code, code: t.code, name: t.code, hasParts: true, thicknessIn, unoNote: uno.find((u) => normCode(u.code) === normCode(t.code))?.note ?? null, lines: t.lines };
  });
  return { types, codes: types.map((t) => t.code) };
}
