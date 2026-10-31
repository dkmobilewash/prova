import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rasterizeSheet } from "../raster/rasterizeSheet";
import { findSymbols, type Box } from "../symbolSignature";

/**
 * ── "COUNT LIKE THIS" ON A SCAN: the same template over the stored raster lines ──
 *
 *     REAL_PLAN_DIR=… SR_SET=… SR_PAGE=… SR_BOX=x1,y1,x2,y2 [SR_KEY=…/labels-symbols/<set>/<name>.json] [SR_DPI=200] \
 *       npx vitest run --config vitest.eval.config.mts lib/takeoff/realplan/symbolRaster.eval.ts
 *
 * A vector training sheet is rasterised the way the RASTER stage rasterises a
 * scan (200 dpi, contour lines, Tesseract words) and the boxed symbol is
 * counted on THOSE lines, so the vector key for the same box says what a
 * scanned sheet would lose. No model. Training sets only.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const SET = process.env.SR_SET ?? "";
const PAGE = Number(process.env.SR_PAGE ?? "0");
const BOX = (process.env.SR_BOX ?? "").split(",").map(Number);
const KEY = process.env.SR_KEY ?? "";
const DPI = Number(process.env.SR_DPI ?? "200");
type Key = { points: { x: number; y: number }[]; reach: number; feetPerUnit: number; region?: { x0: number; y0: number; x1: number; y1: number } };

describe.skipIf(DIR === "" || SET === "" || PAGE === 0 || BOX.length !== 4)("count like this on a rasterised sheet", () => {
  it("counts the boxed symbol on the raster's lines", { timeout: 1_800_000 }, async () => {
    const path = join(DIR, SET);
    expect(existsSync(path)).toBe(true);
    const bytes = new Uint8Array(readFileSync(path));
    const raster = await rasterizeSheet(bytes, PAGE, { dpi: DPI, cachePath: join(tmpdir(), "tess") });
    expect(raster.lines.length).toBeGreaterThan(0);
    const W = raster.widthPt;
    const segs = raster.lines.map((l) => ({ x1: l.x1 / W, y1: l.y1 / W, x2: l.x2 / W, y2: l.y2 / W, width: l.width }));
    const text = raster.text.map((t) => ({ x: t.x / W, y: (t.y - t.height) / W, width: t.width / W, height: t.height / W, str: t.str }));
    const template: Box = { x1: BOX[0]!, y1: BOX[1]!, x2: BOX[2]!, y2: BOX[3]! };
    const t0 = performance.now();
    const found = findSymbols(segs, text, template);
    const ms = performance.now() - t0;
    console.log(`\nSR ${SET} p${PAGE} at ${DPI} dpi: ${raster.lines.length} lines, ${raster.text.length} words (raster ${(raster.ms.total / 1000).toFixed(0)} s); template ${found.template?.count ?? 0} strokes radius ${found.template ? (found.template.radius * 1000).toFixed(2) : "-"}‰; ${found.matches.length} matches in ${Math.round(ms)} ms; label ${found.label ?? "none"}, tag ${found.tag ?? "none"}`);
    if (KEY && existsSync(KEY)) {
      const key = JSON.parse(readFileSync(KEY, "utf8")) as Key;
      const r = key.region;
      const inside = r ? found.matches.filter((m) => { const x = (m.box.x1 + m.box.x2) / 2, y = (m.box.y1 + m.box.y2) / 2; return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }) : found.matches;
      const reach = key.reach / key.feetPerUnit;
      const used = new Set<number>();
      let foundN = 0;
      for (const p of key.points) {
        let best = -1, bd = Infinity;
        inside.forEach((m, i) => { if (used.has(i)) return; const d = Math.hypot((m.box.x1 + m.box.x2) / 2 - p.x, (m.box.y1 + m.box.y2) / 2 - p.y); if (d <= reach && d < bd) { bd = d; best = i; } });
        if (best >= 0) { used.add(best); foundN++; }
      }
      console.log(`   KEY ${key.points.length}: found ${foundN}, missed ${key.points.length - foundN}, false ${inside.length - used.size}`);
    }
  });
});
