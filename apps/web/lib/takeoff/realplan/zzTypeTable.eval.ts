import { Buffer } from "node:buffer";
import { appendFileSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { excludedSheetReason, heldOutReason } from "../heldOutSets";
import { readLegendFromText } from "../legendText";
import { legendPages } from "../legendPages";
import { readPartitionAssembly } from "../partitionAssembly";
import { typeSource } from "../postingGate";
import { plainTag } from "../planTextTags";
import { pageLines } from "../planTextRead";
import { productDetection, sampledSheetsFor, vocabularyFor } from "../productDetection";
import { sheetStrokes } from "../sheetStrokes";
import { groupsForStage } from "../stageGroups";
import { tagSymbols } from "../tagSymbols";
import { defaultWallTypeFromNotes } from "../wallNotes";
import type { MatchableWallType } from "../wallTypeMatch";

/**
 * ── THE TYPES TABLE: ONE ROW PER (WALL GROUP x CANDIDATE CODE) ──
 *
 * What the learned type scorer trains on (METHOD v2, C). Each type-keyed sheet goes through the
 * product's own path — `productDetection`, then `groupsForStage` with the set's legend, then
 * `typeSource` (today's rule chain) — and every group gets one row per code it could be: the
 * stage's tag vocabulary. Each row carries the signals that tie that code to that group: where
 * the code is printed and how (in a symbol or bare, how far, a leader), whether the legend has it,
 * its legend thickness against the group's, the sheet's U.N.O. note, how often the set's other
 * pages print it, hatch, nearby room words, and what today's chain answered.
 *
 * The legend is the KEYLESS read (`readLegendFromText` on every page `legendPages` ranks 0-2,
 * richest lines per code), so no model is called and both arms see the same codes.
 *
 * Labels are NOT written here: `scripts/type-model/type_loso.py` takes them from the answer key with
 * the canonical type matcher, so the label and the scorer are one piece of code.
 *
 * Run: scripts/type-model/table.sh <out.jsonl>; scripts/type-model/measure.py compares two tables
 * (legend read gate off vs on: candidate recall, and today's chain). TT_HELD=1: held-out sets only.
 */
const DIRS = (process.env.REAL_PLAN_DIR ?? "").split(":").filter((d) => d !== "");
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const OUT = process.env.TT_OUT ?? "";
const HELD = process.env.TT_HELD === "1";
const flat = (s: string) => s.replace(/\.pdf$/i, "").replace(/[^a-z0-9]+/gi, "").toUpperCase();
const normCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
const WET = /\b(?:TOILET|RESTROOM|SHOWER|LOCKER|JANITOR|JAN\.?|MOP|KITCHEN|LAB|WOMEN|MEN|BATH)\b/i;
const CORRIDOR = /\b(?:CORR(?:IDOR)?|HALL(?:WAY)?|EXIT|STAIR|LOBBY|VESTIBULE)\b/i;
const RATED = /\b(?:\d\s*HR|RATED|FIRE|SMOKE)\b/i;

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

type Pt = { x: number; y: number };
type Line = { x1: number; y1: number; x2: number; y2: number };
const toSeg = (p: Pt, s: Line) => {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.y - s.y1) * dy) / l));
  return Math.hypot(p.x - s.x1 - t * dx, p.y - s.y1 - t * dy);
};

type Saved = { page: number; feetPerUnit: number; sheet?: string; verdicts?: { verdict: string; wallType?: string | null }[]; traced?: { wallType?: string | null }[] };

describe.skipIf(DIRS.length === 0 || LABELS === "" || OUT === "")("wall types table", () => {
  it("writes one row per wall group and candidate code", { timeout: 7_200_000 }, async () => {
    const seen: string[] = [];
    for (const dir of readdirSync(LABELS).sort()) {
      if (process.env.TT_ONLY !== undefined && !dir.includes(process.env.TT_ONLY)) continue;
      seen.push(dir);
      // Training sets, or with TT_HELD=1 the held-out sets ONLY (C3's one-shot test, run by the original).
      if ((heldOutReason(dir) !== null) !== HELD) continue;
      let names: string[] = [];
      try { names = readdirSync(join(LABELS, dir)).filter((n) => n.endsWith(".json")); } catch { continue; }
      // Only sheets whose key names a legend CODE (not just U): nothing else can be scored.
      const sheets = names
        .map((n) => ({ sheet: n.slice(0, -5), saved: JSON.parse(readFileSync(join(LABELS, dir, n), "utf8")) as Saved }))
        .filter(({ sheet, saved }) => excludedSheetReason(dir, sheet) === null && [...(saved.verdicts ?? []), ...(saved.traced ?? [])].some((v) => (v.wallType ?? "U").toUpperCase() !== "U" && (v.wallType ?? "") !== ""));
      if (sheets.length === 0) continue;
      const pdf = findPdf(dir);
      if (pdf === null) throw new Error(`${dir}: no PDF under REAL_PLAN_DIR`);
      const bytes = () => Buffer.from(readFileSync(pdf));
      const doc = await openPlanPdf(bytes());

      // ── THE SET, ONCE: the keyless legend, and which codes each page prints ──
      const richest = new Map<string, { code: string; lines: string[] }>();
      const uno: { code: string; note: string }[] = [];
      const printedOn = new Map<number, Set<string>>();
      for (let p = 1; p <= doc.pageCount; p += 1) {
        let text;
        try { text = await doc.pageText(p); } catch { continue; }
        const items = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        printedOn.set(p, new Set(items.map((i) => normCode(i.str)).filter((c) => c !== "" && c.length <= 7)));
        const rank = legendPages([{ page: p, title: null, lines: await pageLines(doc, p) }])[0]?.rank;
        if (rank === undefined || rank > 2) continue;
        const strokes = await doc.pageStrokes(p);
        const read = readLegendFromText({ items, widthPt: text.widthPt, heightPt: text.heightPt, symbols: tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 }) });
        for (const t of read.types) {
          const k = normCode(t.code);
          if ((richest.get(k)?.lines.length ?? -1) < t.lines.length) richest.set(k, { code: t.code, lines: t.lines });
        }
        uno.push(...read.uno);
      }
      const legendTypes: MatchableWallType[] = [...richest.values()].map((t) => {
        const r = readPartitionAssembly({ lines: t.lines, where: "text" }).read;
        const thicknessIn = r.studWidthIn === null ? null : r.studWidthIn + 2 * (r.layersPerSide ?? 1) * (r.boardThicknessIn ?? 0);
        return { id: t.code, code: t.code, name: t.code, hasParts: true, thicknessIn, unoNote: uno.find((u) => normCode(u.code) === normCode(t.code))?.note ?? null };
      });
      const legendCodes = legendTypes.map((t) => t.code);

      for (const { sheet, saved } of sheets) {
        const page = saved.page, fpu = saved.feetPerUnit;
        const strokes = await sheetStrokes(bytes(), page);
        if (strokes === null || strokes.segments.length < 50) continue;
        const W = strokes.widthPt;
        const items = (await doc.pageText(page)).items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
        const sampledSheets = await sampledSheetsFor({ pageCount: doc.pageCount, pageNumber: page, own: strokes, read: (p) => doc.pageStrokes(p) });
        const base = { segments: strokes.segments, textItems: items, pageSize: { widthPt: W, heightPt: strokes.heightPt }, feetPerUnit: fpu, wallTypes: legendTypes, legendCodes: legendCodes.length > 0 ? legendCodes : null, scanned: false, sampledSheets };
        const vocabulary = vocabularyFor(base);
        // As the WALLS stage: the finder pairs without the types' thicknesses; the grouping has them.
        const found = productDetection({ ...base, pairWithThicknesses: false }).found;
        const staged = groupsForStage({ found, segmentsPt: strokes.segments, textItems: items, widthPt: W, feetPerUnit: fpu, wallTypes: legendTypes, legendCodes: vocabulary.length === 0 ? null : vocabulary, sibling: null, midSpan: legendCodes.length === 0 });
        const note = defaultWallTypeFromNotes(items, legendTypes);
        const symbols = tagSymbols({ segments: strokes.segments, text: items, unitsPerPaperInch: 72 });

        // Every printed occurrence of a vocabulary code, page-width units, with how it is printed.
        const vocabKeys = new Map(vocabulary.map((c) => [normCode(c), c]));
        const prints = items
          .filter((i) => vocabKeys.has(normCode(i.str)))
          .map((i) => {
            const cx = i.x + i.width / 2, cy = i.y - i.height / 2;
            const sym = symbols.find((s) => Math.hypot(s.x - cx, s.y - cy) <= s.radius + 1);
            const reach = Math.max(sym?.radius ?? 0, i.height) * 1.5;
            // A leader: a stroke that starts at the tag and ends away from it; its far ends, page-width units.
            const ends: Pt[] = [];
            for (const s of strokes.segments) {
              const a = Math.hypot(s.x1 - cx, s.y1 - cy) <= reach, b = Math.hypot(s.x2 - cx, s.y2 - cy) <= reach;
              if (a === b) continue;
              const far = a ? { x: s.x2, y: s.y2 } : { x: s.x1, y: s.y1 };
              if (Math.hypot(far.x - cx, far.y - cy) > 2 * reach) ends.push({ x: far.x / W, y: far.y / W });
            }
            return { key: normCode(i.str), x: cx / W, y: cy / W, inSymbol: sym === undefined ? 0 : 1, ends };
          });
        const onSheet = new Map<string, number>();
        for (const p of prints) onSheet.set(p.key, (onSheet.get(p.key) ?? 0) + 1);
        const words = items.map((i) => ({ str: i.str, x: (i.x + i.width / 2) / W, y: (i.y - i.height / 2) / W }));
        const nearestWord = (runs: readonly Line[], re: RegExp) => {
          let d = Infinity;
          for (const w of words) if (re.test(w.str)) for (const r of runs) d = Math.min(d, toSeg(w, r) * fpu);
          return Number.isFinite(d) ? Math.min(d, 999) : 999;
        };

        const groups = staged.groups.map((g) => {
          const chain = typeSource(g);
          const tagged = g.source.kind === "TAG" ? normCode(plainTag(g.source.tag)) : "";
          const thick = g.inches;
          const atThickness = legendTypes.filter((t) => t.thicknessIn !== null && Math.abs(t.thicknessIn - thick) <= 0.5).length;
          const hatchedFt = g.runs.filter((r) => staged.hatched.has(r)).reduce((n, r) => n + r.lengthFeet, 0);
          const ctx = { wet: nearestWord(g.runs, WET), corridor: nearestWord(g.runs, CORRIDOR), rated: nearestWord(g.runs, RATED) };
          const cands = vocabulary.map((code) => {
            const key = normCode(code);
            let dist = 999, distSym = 999, leader = 0, within5 = 0, within15 = 0, otherDist = 999;
            for (const p of prints) {
              let d = Infinity;
              for (const r of g.runs) d = Math.min(d, toSeg(p, r) * fpu);
              if (p.key !== key) { otherDist = Math.min(otherDist, d); continue; }
              dist = Math.min(dist, d);
              if (p.inSymbol === 1) distSym = Math.min(distSym, d);
              if (d <= 5) within5 += 1;
              if (d <= 15) within15 += 1;
              if (leader === 0 && p.ends.some((e) => g.runs.some((r) => toSeg(e, r) * fpu <= Math.max(1, r.thicknessFeet)))) leader = 1;
            }
            const lt = legendTypes.find((t) => normCode(t.code) === key);
            const otherPages = [...printedOn].filter(([p, set]) => p !== page && set.has(key)).length;
            return {
              code,
              f: [
                tagged === key ? 1 : 0,
                tagged !== "" && tagged !== key ? 1 : 0,
                Math.min(dist, 999), Math.min(distSym, 999), Math.min(otherDist, 999), leader, within5, within15,
                onSheet.get(key) ?? 0, (onSheet.get(key) ?? 0) / Math.max(1, prints.length),
                lt === undefined ? 0 : 1, lt?.thicknessIn == null ? 0 : 1, lt?.thicknessIn == null ? -1 : Math.abs(lt.thicknessIn - thick), atThickness,
                note !== null && normCode(note.type.code) === key ? 1 : 0, note === null ? 0 : 1,
                Math.min(otherPages, 50),
                chain !== null && normCode(chain.type.code) === key ? 1 : 0,
              ],
              chainSource: chain !== null && normCode(chain.type.code) === key ? chain.source : null,
            };
          });
          return {
            feet: g.feet, inches: thick, runs: g.runs.map((r) => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, lengthFt: r.lengthFeet, thicknessIn: r.thicknessFeet * 12 })),
            g: [g.feet, g.runs.length, thick, g.feet === 0 ? 0 : hatchedFt / g.feet, g.source.kind === "TAG" ? 1 : 0, ctx.wet, ctx.corridor, ctx.rated, legendCodes.length, vocabulary.length],
            chain: chain === null ? null : { code: chain.type.code, source: chain.source },
            cands,
          };
        });
        appendFileSync(OUT, JSON.stringify({ set: dir, sheet, page, feetPerUnit: fpu, legend: legendCodes, groups }) + "\n");
      }
      await doc.close();
    }
    // The label folder resolved: a mistyped TAKEOFF_LABEL_DIR or TT_ONLY must not read as a set with no types.
    expect(seen.length).toBeGreaterThan(0);
  });
});
