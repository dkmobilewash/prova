import { Buffer } from "node:buffer";
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { readLegendFromText, textLines } from "../legendText";
import { legendPages } from "../legendPages";
import { pageLines } from "../planTextRead";
import { vocabularyFor } from "../productDetection";
import { sheetStrokes } from "../sheetStrokes";
import { tagSymbols } from "../tagSymbols";

/**
 * ── WHY A KEY CODE IS NOT A CANDIDATE: THE KEYLESS LEGEND READ'S RECALL, PER CODE ──
 *
 * For every type-keyed training sheet (C3): the key's codes, the keyless legend read (every page
 * `legendPages` ranks 0-2, as `zzTypeTable.eval.ts`), the sheet's tag vocabulary, and for each key
 * code where the set prints it — exactly as a text item, or inside a longer one — on which pages and
 * at what legend rank, and how many types those pages read. `scripts/type-model/recall.py` weights
 * the codes by key feet and names the cause. Writes JSON lines to LR_OUT; no model is called.
 */
const DIRS = (process.env.REAL_PLAN_DIR ?? "").split(":").filter((d) => d !== "");
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.LR_OUT ?? "";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");

function findPdf(dir: string): string | null {
  const walk = (d: string): string | null => {
    for (const n of readdirSync(d)) {
      const full = join(d, n);
      if (statSync(full).isDirectory()) { const hit = walk(full); if (hit !== null) return hit; }
      else if (n.toLowerCase().endsWith(".pdf") && flat(n) === flat(dir)) return full;
    }
    return null;
  };
  for (const root of DIRS) { const hit = walk(root); if (hit !== null) return hit; }
  return null;
}

type Saved = { page: number; feetPerUnit: number; verdicts?: { wallType?: string | null }[]; traced?: { wallType?: string | null }[] };

describe.skipIf(DIRS.length === 0 || LABELS === "" || OUT === "")("legend candidate recall", () => {
  it("writes, per type-keyed sheet, where each key code is printed and what the read made of it", { timeout: 7_200_000 }, async () => {
    const seen: string[] = [];
    for (const dir of readdirSync(LABELS).sort()) {
      if (process.env.TT_ONLY !== undefined && !dir.includes(process.env.TT_ONLY)) continue;
      seen.push(dir);
      if (heldOutReason(dir) !== null) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      const sheets = names
        .map((n) => ({ sheet: n.slice(0, -5), saved: JSON.parse(readFileSync(join(LABELS, dir, n), "utf8")) as Saved }))
        .map((s) => ({ ...s, codes: [...new Set([...(s.saved.verdicts ?? []), ...(s.saved.traced ?? [])].map((v) => normCode(v.wallType ?? "")).filter((c) => c !== "" && c !== "U"))] }))
        .filter((s) => excludedSheetReason(dir, s.sheet) === null && s.codes.length > 0);
      if (sheets.length === 0) continue;
      const pdf = findPdf(dir);
      if (pdf === null) throw new Error(`${dir}: no PDF under REAL_PLAN_DIR`);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const want = new Set(sheets.flatMap((s) => s.codes));
      const legend = new Set<string>();
      const pages: { page: number; rank: number | null; read: string[]; exact: Record<string, number>; inside: Record<string, string[]> }[] = [];
      for (let p = 1; p <= doc.pageCount; p += 1) {
        let text;
        try { text = await doc.pageText(p); } catch { continue; }
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const rank = legendPages([{ page: p, title: null, lines: await pageLines(doc, p) }])[0]?.rank ?? null;
        let read: string[] = [];
        if (rank !== null && rank <= 2) {
          const strokes = await doc.pageStrokes(p);
          read = readLegendFromText({ items, widthPt: text.widthPt, heightPt: text.heightPt, symbols: tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 }) }).types.map((t) => normCode(t.code));
          read.forEach((c) => legend.add(c));
        }
        const exact: Record<string, number> = {};
        const inside: Record<string, string[]> = {};
        for (const i of items) { const k = normCode(i.str); if (want.has(k)) exact[k] = (exact[k] ?? 0) + 1; }
        // Inside a longer line: "TYPE 1SF3", "1SF3/4", "S6B (1 HR)". The line's words around it, cut short.
        for (const l of textLines(items)) {
          const words = l.text.toUpperCase().split(/[^A-Z0-9-]+/).map(normCode);
          for (const c of want) if (normCode(l.text) !== c && words.includes(c)) (inside[c] ??= []).length < 3 && inside[c]!.push(l.text.slice(0, 50));
        }
        pages.push({ page: p, rank, read, exact, inside });
      }
      for (const { sheet, saved, codes } of sheets) {
        const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
        const items = (await doc.pageText(saved.page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const vocabulary = vocabularyFor({ wallTypes: [], legendCodes: legend.size > 0 ? [...legend] : null, textItems: items, segments: strokes?.segments ?? [] }).map(normCode);
        appendFileSync(OUT, JSON.stringify({
          set: dir, sheet, page: saved.page, legend: [...legend], vocabulary,
          codes: Object.fromEntries(codes.map((c) => [c, {
            inLegend: legend.has(c), inVocabulary: vocabulary.includes(c),
            pages: pages.filter((p) => (p.exact[c] ?? 0) > 0 || (p.inside[c] ?? []).length > 0)
              .map((p) => ({ page: p.page, rank: p.rank, readTypes: p.read.length, exact: p.exact[c] ?? 0, inside: p.inside[c] ?? [], sheet: p.page === saved.page })),
          }])),
        }) + "\n");
      }
      await doc.close();
    }
    expect(seen.length).toBeGreaterThan(0);
  });
});
