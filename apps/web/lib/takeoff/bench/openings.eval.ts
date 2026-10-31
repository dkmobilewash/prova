import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import type { ProposedOpening } from "../openingProposals";
import { allSheets, buildKey, displayMap, primsForCase, sheetForVariant, variantsFor, VARIANTS, type Variant } from "./cases";
import { findWalls } from "./harness";
import { HOLDOUT_SEEDS, holdoutPlan } from "./holdout";
import { openingsIn, type Opening, type Pt } from "./model";
import type { Printer } from "./run";
import { sheetBuilders, type Sheet } from "./sheets";
import { writePdf, writeSvg } from "./writers";

/**
 * ── HOW MANY OF THE DRAWN DOORS AND WINDOWS THE DETECTOR PROPOSES ──
 *
 *     TAKEOFF_OPENINGS=1 pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/bench/openings.eval.ts
 *
 * The bench MODEL places every opening — its host wall, its centre and its
 * width — so this has an exact key without reading the PDF, the same standard
 * the wall footage is graded to. It runs the product's own finder
 * (`findWalls` → `findWallsOnSheet`) on the bench's PDFs, then
 * reads the `proposedOpenings` it attached to the runs it returned, and matches each proposal to a
 * key opening by POSITION and WIDTH. A count alone would pass a detector that
 * found the right number of openings in the wrong places.
 *
 * Writes nothing. The PDFs are rebuilt in memory exactly as `runCase` builds
 * them, so this cannot disturb the committed bench reports.
 *
 * ── WHAT A MATCH IS ──
 *
 * Same kind (a door is `door`/`pair`/`sidelite`, a window `window`/`relite`),
 * centre within a foot, width within half a foot. A storefront and a cased
 * opening draw nothing in the gap, so the detector does not propose them by
 * design; they are counted separately rather than as misses, so the recall
 * figure says what it means.
 */

const RUN = Boolean(process.env.TAKEOFF_OPENINGS);

const NEAR_FT = 1;
const WIDTH_FT = 0.5;

type KeyOpening = { mark: string; kind: Opening["kind"]; widthFt: number; x: number; y: number; wall: string };
type Score = { key: number; drawnNothing: number; proposed: number; matched: number; wrongKind: number; notCounted: number; widthErrs: number[]; byKind: Record<string, [number, number]> };
const DEBUG = process.env.TAKEOFF_OPENINGS_DEBUG ?? "";

function doorish(kind: Opening["kind"]): boolean {
  return kind === "door" || kind === "pair" || kind === "sidelite";
}
function windowish(kind: Opening["kind"]): boolean {
  return kind === "window" || kind === "relite";
}

async function chromiumPrinter(): Promise<Printer | null> {
  try {
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    const page = await browser.newPage();
    return {
      pdfFromSvg: async (svg, widthIn, heightIn) => {
        await page.setContent(
          `<!doctype html><html><head><style>@page{size:${widthIn}in ${heightIn}in;margin:0}html,body{margin:0;padding:0}svg{display:block}</style></head><body>${svg}</body></html>`,
        );
        return Buffer.from(await page.pdf({ width: `${widthIn}in`, height: `${heightIn}in`, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" }, preferCSSPageSize: true, pageRanges: "1" }));
      },
      close: () => browser.close(),
    };
  } catch {
    return null;
  }
}

async function scoreCase(sheet: Sheet, variant: Variant, printer: Printer | null): Promise<Score | null> {
  const prims = primsForCase(sheet, variant);
  const key = buildKey(sheet, variant);
  let bytes: Buffer;
  if (variant.producer === "skia") {
    if (!printer) return null;
    bytes = await printer.pdfFromSvg(writeSvg(sheet, prims), sheet.widthPt / 72, sheet.heightPt / 72);
  } else {
    bytes = writePdf(sheet, prims, { compress: true, ...(variant.pdf?.(sheet) ?? {}) });
  }
  const dm = displayMap(sheet, variant);
  const score: Score = { key: 0, drawnNothing: 0, proposed: 0, matched: 0, wrongKind: 0, notCounted: 0, widthErrs: [], byKind: {} };
  let any = false;
  for (const view of sheet.views) {
    const level = view.level;
    if (!level) continue;
    const inView = key.walls.filter((w) => w.view === view.name && w.display);
    const counted = inView.filter((w) => w.count);
    if (counted.length === 0) continue;
    any = true;
    const fpu = counted[0].trueFeetPerUnit;
    const toUnits = (pt: Pt) => {
      const d = dm.map({ x: view.origin.x + pt.x * view.ptPerFt, y: view.origin.y + pt.y * view.ptPerFt });
      return { x: d.x / dm.widthPt, y: d.y / dm.widthPt };
    };
    const keyOpenings: KeyOpening[] = [];
    const elsewhere: KeyOpening[] = [];
    for (const k of inView) {
      const wall = level.walls.find((w) => w.id === k.id);
      if (!wall) continue;
      for (const op of openingsIn(wall, level)) {
        // Inside the part of the wall this view (and any clip) shows.
        const at = toUnits(op.at);
        const d = k.display!;
        const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
        const along = ((at.x - d.x1) * (d.x2 - d.x1) + (at.y - d.y1) * (d.y2 - d.y1)) / L;
        // Beyond the shown part of the wall (a viewport clip), the opening is
        // still drawn in the PDF — `sheetStrokes` ignores clipping — so a
        // proposal there is real, not false.
        (k.count && along >= 0 && along <= L ? keyOpenings : elsewhere).push({ mark: op.mark, kind: op.kind, widthFt: op.widthFt, x: at.x, y: at.y, wall: k.id });
      }
    }
    const found = await findWalls(bytes, fpu);
    const c0 = dm.map({ x: view.origin.x + view.box[0] * view.ptPerFt, y: view.origin.y + view.box[1] * view.ptPerFt });
    const c1 = dm.map({ x: view.origin.x + view.box[2] * view.ptPerFt, y: view.origin.y + view.box[3] * view.ptPerFt });
    const box = [Math.min(c0.x, c1.x) / dm.widthPt, Math.min(c0.y, c1.y) / dm.widthPt, Math.max(c0.x, c1.x) / dm.widthPt, Math.max(c0.y, c1.y) / dm.widthPt];
    // THE PRODUCT'S OWN OUTPUT: `findWallsOnSheet` attaches these to each run,
    // so this grades what the screen is handed rather than a second call.
    const placed: { p: ProposedOpening; x: number; y: number }[] = [];
    for (const run of found.walls) {
      for (const p of run.proposedOpenings ?? []) {
        const x = run.x1 + (run.x2 - run.x1) * p.at;
        const y = run.y1 + (run.y2 - run.y1) * p.at;
        if (x < box[0] || x > box[2] || y < box[1] || y > box[3]) continue;
        placed.push({ p, x, y });
      }
    }
    const drawsSomething = keyOpenings.filter((o) => doorish(o.kind) || windowish(o.kind));
    score.key += drawsSomething.length;
    score.drawnNothing += keyOpenings.length - drawsSomething.length;
    score.proposed += placed.length;
    const used = new Set<number>();
    for (const o of drawsSomething) {
      const tally = (score.byKind[o.kind] ??= [0, 0]);
      tally[0] += 1;
      let best = -1;
      let bestD = Infinity;
      placed.forEach((q, j) => {
        if (used.has(j)) return;
        const d = Math.hypot(q.x - o.x, q.y - o.y) * fpu;
        if (d <= NEAR_FT && Math.abs(q.p.widthFt - o.widthFt) <= WIDTH_FT && d < bestD) {
          best = j;
          bestD = d;
        }
      });
      if (best < 0) {
        if (DEBUG && key.caseId === DEBUG) {
          const host = found.walls.filter((r) => {
            const L = Math.hypot(r.x2 - r.x1, r.y2 - r.y1);
            const t = ((o.x - r.x1) * (r.x2 - r.x1) + (o.y - r.y1) * (r.y2 - r.y1)) / (L * L);
            const px = r.x1 + t * (r.x2 - r.x1);
            const py = r.y1 + t * (r.y2 - r.y1);
            return t > 0 && t < 1 && Math.hypot(px - o.x, py - o.y) * fpu < 1;
          });
          const near = placed.filter((q) => Math.hypot(q.x - o.x, q.y - o.y) * fpu < 3).map((q) => `${q.p.kind} ${q.p.widthFt.toFixed(2)}`);
          console.log(`  MISS ${o.mark} ${o.kind} ${o.widthFt} on ${o.wall}: host runs ${host.map((r) => `${r.lengthFeet.toFixed(1)}ft@${(r.thicknessFeet * 12).toFixed(2)}in`).join(",") || "NONE"} near ${near.join(";")}`);
        }
        continue;
      }
      used.add(best);
      const q = placed[best];
      const kindOk = (q.p.kind === "door" && doorish(o.kind)) || (q.p.kind === "window" && windowish(o.kind));
      if (kindOk) {
        score.matched += 1;
        tally[1] += 1;
        score.widthErrs.push(Math.abs(q.p.widthFt - o.widthFt));
      } else score.wrongKind += 1;
    }
    // A proposal on a wall the key does not count (outside a viewport clip,
    // say) is a real opening on a real drawing, not a false one.
    placed.forEach((q, j) => {
      if (used.has(j)) return;
      if (elsewhere.some((o) => Math.hypot(q.x - o.x, q.y - o.y) * fpu <= NEAR_FT)) {
        used.add(j);
        score.notCounted += 1;
      }
    });
    if (DEBUG && key.caseId === DEBUG) {
      placed.forEach((q, j) => {
        if (!used.has(j)) console.log(`  FALSE ${q.p.kind} ${q.p.widthFt.toFixed(2)} — ${q.p.evidence}`);
      });
    }
  }
  return any ? score : null;
}

function line(id: string, s: Score): string {
  const recall = s.key ? (100 * s.matched) / s.key : NaN;
  const precision = s.proposed - s.notCounted ? (100 * s.matched) / (s.proposed - s.notCounted) : NaN;
  const kinds = Object.entries(s.byKind).map(([k, [n, m]]) => `${k} ${m}/${n}`).join(" ");
  const worst = s.widthErrs.length ? Math.max(...s.widthErrs) : 0;
  return `${id.padEnd(30)} key ${String(s.key).padStart(3)} (+${s.drawnNothing} drawn-nothing)  proposed ${String(s.proposed).padStart(3)}  matched ${String(s.matched).padStart(3)}  wrong-kind ${s.wrongKind}  recall ${recall.toFixed(0)}%  precision ${precision.toFixed(0)}%  worst width err ${(worst * 12).toFixed(1)} in  on-uncounted ${s.notCounted}  [${kinds}]`;
}

describe.skipIf(!RUN)("openings proposed off the bench drawings", () => {
  it("scores every plan case against the model's own openings", async () => {
    const printer = await chromiumPrinter();
    const sheets = allSheets();
    expect(sheets.length).toBeGreaterThan(0);
    const blank = (): Score => ({ key: 0, drawnNothing: 0, proposed: 0, matched: 0, wrongKind: 0, notCounted: 0, widthErrs: [], byKind: {} });
    const total = blank();
    const held = blank();
    const fold = (into: Score, s: Score) => {
      into.key += s.key;
      into.drawnNothing += s.drawnNothing;
      into.proposed += s.proposed;
      into.matched += s.matched;
      into.wrongKind += s.wrongKind;
      into.notCounted += s.notCounted;
      for (const [k, [n, m]] of Object.entries(s.byKind)) {
        const t = (into.byKind[k] ??= [0, 0]);
        t[0] += n;
        t[1] += m;
      }
      into.widthErrs.push(...s.widthErrs);
    };
    let cases = 0;
    for (const base of sheets) {
      for (const vid of variantsFor(base.id)) {
        if (vid === "scan") continue;
        if (process.env.TAKEOFF_OPENINGS_ONLY && !`${base.id}__${vid}`.startsWith(process.env.TAKEOFF_OPENINGS_ONLY)) continue;
        const v = VARIANTS.find((x) => x.id === vid)!;
        const sheet = sheetForVariant(base.id, vid, sheets);
        const s = await scoreCase(sheet, v, printer);
        if (!s) continue;
        cases += 1;
        fold(total, s);
        console.log(line(`${base.id}__${vid}`, s));
      }
    }
    for (const seed of process.env.TAKEOFF_OPENINGS_ONLY ? [] : HOLDOUT_SEEDS) {
      const plan = holdoutPlan(seed);
      const v = VARIANTS.find((x) => x.id === plan.variant)!;
      const sheet = { ...sheetBuilders.floorPlanSheet(`H-${seed}`, plan.level, `HOLDOUT ${seed}`), id: `H-${seed}` };
      const s = await scoreCase(sheet, v, printer);
      if (!s) continue;
      fold(held, s);
      console.log(line(`holdout H-${seed}__${plan.variant}`, s));
    }
    await printer?.close();
    console.log(line("MAIN TOTAL", total));
    console.log(line("HOLDOUT TOTAL", held));
    // It measured something, or it says nothing.
    expect(cases).toBeGreaterThan(0);
    expect(total.key).toBeGreaterThan(0);
    if (!process.env.TAKEOFF_OPENINGS_ONLY) expect(held.key).toBeGreaterThan(0);
  }, 3_600_000);
});

