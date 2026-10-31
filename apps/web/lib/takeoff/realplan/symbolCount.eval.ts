import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { sheetStrokes } from "../sheetStrokes";
import { inPageWidthUnits } from "../findWallsOnSheet";
import { findSymbolsFrom, scaleSymbolTemplate, symbolTemplate, templateStrokes, withoutText, type Box } from "../symbolSignature";

/**
 * ── "FIND ALL LIKE THIS", SCORED AGAINST A HAND KEY ──
 *
 * One template box on one REAL training sheet; every match the signature
 * finds; a key of hand-placed points (from crops, outside git) scored as
 * found / missed / false, and the time the search took.
 *
 *     REAL_PLAN_DIR=… SC_SET=… SC_PAGE=… SC_BOX=x1,y1,x2,y2 (page-width units)
 *     SC_KEY=…/labels-symbols/<set>/<name>.json SC_OUT=… SC_NAME=…
 *     npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/symbolCount.eval.ts
 *
 * `SC_TPL_PAGE` takes the box off ANOTHER page of the set — a legend sheet's
 * swatch, or the sheet an across-the-set count started on — corrected for
 * the two pages' widths so the symbol keeps its size on paper; `SC_SCALE`
 * multiplies on top of that (2 for a 1/4" plan read with a 1/8" template
 * when the symbol is drawn in model space).
 *
 * A key file is `{ points: [{x, y, note?}], reach: feet, feetPerUnit }`;
 * without one the run prints the matches and writes them for the crop
 * renderer, which is how a key is built in the first place.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.SC_SET ?? "";
const PAGE = Number(process.env.SC_PAGE ?? "0");
const BOX = (process.env.SC_BOX ?? "").split(",").map(Number);
const KEY = process.env.SC_KEY ?? "";
const OUT = process.env.SC_OUT ?? "";
const NAME = process.env.SC_NAME ?? "symbols";
const COVER = process.env.SC_COVERAGE ? Number(process.env.SC_COVERAGE) : undefined;
const TPL_PAGE = Number(process.env.SC_TPL_PAGE ?? "0") || PAGE;
const SCALE = Number(process.env.SC_SCALE ?? "1") || 1;

type Key = { points: { x: number; y: number; note?: string }[]; reach: number; feetPerUnit: number; region?: { x0: number; y0: number; x1: number; y1: number } };

describe.skipIf(DIR === "" || SET === "" || PAGE === 0 || BOX.length !== 4 || BOX.some((n) => !Number.isFinite(n)))("find all like this", () => {
  it("counts the boxed symbol on the sheet", { timeout: 900_000 }, async () => {
    const bytes = Buffer.from(readFileSync(join(DIR, SET)));
    const read = await sheetStrokes(bytes, PAGE);
    expect(read).not.toBeNull();
    if (!read) return;
    const W = read.widthPt;
    const doc = await openPlanPdf(bytes);
    const text = await doc.pageText(PAGE);
    const textBoxes = text.items.map((i) => ({ x: i.x / W, y: (i.y - i.height) / W, width: i.width / W, height: i.height / W, str: i.str }));
    const segs = read.segments.map(inPageWidthUnits(W));
    expect(segs.length).toBeGreaterThan(0);
    const template: Box = { x1: BOX[0]!, y1: BOX[1]!, x2: BOX[2]!, y2: BOX[3]! };
    // The template's own page: this one, or the page named — read the same way.
    let made = null as ReturnType<typeof symbolTemplate>;
    if (TPL_PAGE === PAGE) made = symbolTemplate(segs, textBoxes, template);
    else {
      // From the OPEN document: pdfjs detached `bytes` when `doc` was opened.
      const tread = await doc.pageStrokes(TPL_PAGE);
      const TW = tread.widthPt;
      const ttext = await doc.pageText(TPL_PAGE);
      const tBoxes = ttext.items.map((i) => ({ x: i.x / TW, y: (i.y - i.height) / TW, width: i.width / TW, height: i.height / TW, str: i.str }));
      const raw = symbolTemplate(tread.segments.map(inPageWidthUnits(TW)), tBoxes, template);
      made = raw === null ? null : scaleSymbolTemplate(raw, (TW / W) * SCALE);
      console.log(`   template from p${TPL_PAGE}: ${raw?.strokes.length ?? 0} strokes, paper factor ${(TW / W).toFixed(3)} x ${SCALE}`);
    }
    const t0 = performance.now();
    const found = made === null ? { matches: [], template: null, candidates: 0, kept: 0, boxed: 0, label: null, offLabel: 0, tag: null, offTag: 0 } : findSymbolsFrom(segs, textBoxes, made, COVER === undefined ? {} : { coverage: COVER });
    const ms = performance.now() - t0;
    console.log(`\n${SET} p${PAGE} ${NAME}: ${segs.length} strokes, template ${found.template?.count ?? 0} strokes radius ${found.template ? (found.template.radius * 1000).toFixed(2) : "-"}‰; ${found.candidates} clusters, template ${found.boxed} boxed → ${found.kept} kept, ${found.matches.length} matches in ${ms.toFixed(0)} ms`);
    console.log(`   distances: ${found.matches.map((m) => m.distance.toFixed(2)).join(" ")}`);
    console.log(`   label ${found.label === null ? "none" : `"${found.label}"`}; ${found.offLabel} dropped for reading differently; tag ${found.tag === null ? "none" : `"${found.tag}"`}; ${found.offTag} dropped for a different tag beside`);
    if (process.env.SC_DEBUG === "1" && found.template) {
      const own = templateStrokes(withoutText(segs, textBoxes), template);
      const r = found.template.radius;
      console.log(`   template strokes / radius: ${own.map((o) => (Math.hypot(o.x2 - o.x1, o.y2 - o.y1) / r).toFixed(2)).sort((a, b) => Number(a) - Number(b)).join(" ")}`);
      console.log(`   text items inside the box: ${textBoxes.filter((t) => t.x >= template.x1 && t.x <= template.x2 && t.y >= template.y1 && t.y <= template.y2).length}; curved: ${own.filter((o) => o.curved).length}`);
    }
    let scored: { falsePositive: boolean }[] = found.matches.map(() => ({ falsePositive: false }));
    let keyPts: { x: number; y: number; missed: boolean }[] = [];
    if (KEY && existsSync(KEY)) {
      const key = JSON.parse(readFileSync(KEY, "utf8")) as Key;
      expect(key.points.length).toBeGreaterThan(0);
      // A key may cover one region of the sheet; matches outside it are neither found nor false.
      if (key.region) {
        const r = key.region;
        const inside = (m: { box: Box }) => { const x = (m.box.x1 + m.box.x2) / 2, y = (m.box.y1 + m.box.y2) / 2; return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; };
        const outside = found.matches.filter((m) => !inside(m)).length;
        found.matches = found.matches.filter(inside);
        scored = found.matches.map(() => ({ falsePositive: false }));
        console.log(`   region: ${outside} matches outside it set aside`);
      }
      const reach = key.reach / key.feetPerUnit;
      const used = new Set<number>();
      keyPts = key.points.map((p) => {
        let best = -1, bd = Infinity;
        found.matches.forEach((m, i) => {
          if (used.has(i)) return;
          const d = Math.hypot((m.box.x1 + m.box.x2) / 2 - p.x, (m.box.y1 + m.box.y2) / 2 - p.y);
          if (d <= reach && d < bd) { bd = d; best = i; }
        });
        if (best >= 0) used.add(best);
        return { x: p.x, y: p.y, missed: best < 0 };
      });
      scored = found.matches.map((_, i) => ({ falsePositive: !used.has(i) }));
      const foundN = keyPts.filter((k) => !k.missed).length;
      console.log(`   KEY ${key.points.length}: found ${foundN}, missed ${key.points.length - foundN}, false ${scored.filter((s) => s.falsePositive).length}`);
      console.log(`   false at: ${found.matches.map((m, i) => (scored[i]!.falsePositive ? `(${((m.box.x1 + m.box.x2) / 2).toFixed(3)},${((m.box.y1 + m.box.y2) / 2).toFixed(3)}) d${m.distance.toFixed(2)}` : null)).filter(Boolean).join(" ") || "none"}`);
      console.log(`   missed at: ${keyPts.filter((k) => k.missed).map((k) => `(${k.x.toFixed(3)},${k.y.toFixed(3)})`).join(" ") || "none"}`);
    }
    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, `${NAME}.json`), JSON.stringify({
        name: NAME, pdf: join(DIR, SET), page: PAGE, widthPt: W, heightPt: read.heightPt, template,
        matches: found.matches.map((m, i) => ({ ...m, falsePositive: scored[i]!.falsePositive })), keyPoints: keyPts, ms,
      }));
    }
  });
});
