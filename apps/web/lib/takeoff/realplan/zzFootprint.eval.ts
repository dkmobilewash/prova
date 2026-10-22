import { Buffer } from "node:buffer";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";
import { insideView, primaryView, sheetViews, wallsPerView } from "../sheetViews";

/**
 * ── KEEP ONLY WHAT IS IN THE DRAWING THAT PRICES THE JOB ──
 *
 * 6,573 ft of the finder's extra footage on the training sheets is OUTSIDE the
 * floor plan, and the reviewer rejected every foot of it on purpose. Broken
 * down, 2,824 ft of that is other views and details — another plan, an RCP, a
 * section, an elevation — all of it line work that looks exactly like a wall
 * because it IS a wall, drawn somewhere this takeoff must not count.
 *
 * No new detector is needed for that. `wallsPerView` already splits a sheet
 * into its captioned views and measures each at its own scale, and
 * `primaryView` already picks the one that prices the job rather than the one
 * with the most line work — its own comment records a lighting plan beating a
 * partition plan on footage, which is why it ranks captions instead.
 *
 * ── THE CAPTION ROUTE ALONE REMOVES NOTHING, MEASURED ──
 *
 * The first version of this filter was exactly that: keep what is inside the
 * primary view. It removed ZERO feet of junk on all eighteen sheets, because
 * `sheetViews` reports ONE view on sixteen of them and a single view owns the
 * whole page — so `insideView` keeps everything. Camp Bow Wow A101 carries
 * 1,472 ft of junk and reports one view, while its own crops show a detail
 * band and site work on the same sheet. The captions those other drawings
 * have are not being found.
 *
 * So the filter under test is GEOMETRIC, and the primary view is kept only as
 * a cross-check: a candidate survives when its midpoint is inside the
 * FOOTPRINT — the densest connected blob of paired-wall footage on the sheet,
 * which is the floor plan, because the floor plan is where the walls are.
 *
 * The blob is found on a coarse grid rather than by clustering every pair,
 * because a floor plan is a contiguous area and a detail band is not attached
 * to it. Cells are 4% of the sheet width; a cell joins the blob when it holds
 * at least a tenth of the fullest cell's footage; the blob is the largest
 * 8-connected group, and its box is padded by one cell so a wall on the
 * outside face of the footprint is not clipped.
 *
 * ── MEASURED AS A TRADE, PER BUILDING, NEVER AS A TOTAL ──
 *
 * Junk removed is worth nothing without the real footage it cost, and a total
 * hides a building where the filter is wrong. Both are reported per building,
 * because the known hard cases are buildings: a sheet carrying two floor plans
 * (Crosslines) and a plan sharing a sheet with its RCP (Murray).
 *
 * TRAINING SHEETS ONLY. `heldOutReason` refuses the test buildings, because
 * choosing a filter by what it does to a held-out sheet is tuning on the test
 * key whatever the filter looks like afterwards.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";

type Saved = {
  set: string;
  sheet: string;
  page: number;
  feetPerUnit: number;
  verdicts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet: number;
    verdict: string;
  }[];
};

const len = (a: { x1: number; y1: number; x2: number; y2: number }) =>
  Math.hypot(a.x2 - a.x1, a.y2 - a.y1);

function offLine(
  a: { x1: number; y1: number; x2: number; y2: number },
  px: number,
  py: number,
  fpu: number,
): number {
  const L = len(a);
  if (L === 0) return Math.hypot(px - a.x1, py - a.y1) * fpu;
  const num = Math.abs((a.x2 - a.x1) * (a.y1 - py) - (a.x1 - px) * (a.y2 - a.y1));
  return (num / L) * fpu;
}

function parallel(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const la = len(a);
  const lb = len(b);
  if (la === 0 || lb === 0) return false;
  const dot =
    ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb);
  return Math.abs(dot) > 0.985;
}

/** The scorer's own thickness-aware band, in feet. */
function band(
  w: { thicknessFeet: number },
  k: { thicknessFeet: number },
): number {
  return Math.min(3, Math.max(1.5, Math.max(w.thicknessFeet, k.thicknessFeet) / 2 + 0.5));
}

describe.skipIf(DIR === "" || LABELS === "")("the plan-footprint filter", () => {
  it("measures junk removed against real walls lost, per building", { timeout: 7_200_000 }, async () => {
    const plans = await prisma.takeoffPlan.findMany({ select: { fileName: true, fileUrl: true } });
    const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();

    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const here = join(LABELS, dir);
      if (!existsSync(here)) continue;
      for (const name of readdirSync(here)) {
        if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
      }
    }

    type Row = {
      sheet: string;
      junkBefore: number;
      junkAfter: number;
      realBefore: number;
      realAfter: number;
      views: number;
      primary: string;
    };
    const rows: Row[] = [];
    const read: string[] = [];

    for (const file of files) {
      if (heldOutReason(file.dir) !== null) continue;
      const saved = JSON.parse(
        readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8"),
      ) as Saved;
      const pdf =
        plans.find((p) => flat(p.fileName ?? "") === flat(file.dir))?.fileUrl?.replace(/^local:/, "") ??
        null;
      if (pdf === null) continue;
      const bytes = Buffer.from(readFileSync(join(DIR, pdf)));
      const strokes = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(bytes);
      const text = await doc.pageText(saved.page);
      const items = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));
      const input = {
        segments: strokes.segments,
        textItems: items,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      };
      const found = findWallsOnSheet(input);

      const views = sheetViews(items, strokes.widthPt);
      const measured = wallsPerView({
        views,
        segments: strokes.segments,
        textItems: items,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      const { primary } = primaryView(measured);

      // ── THE FOOTPRINT: THE DENSEST CONNECTED BLOB OF PAIRED WALLS ──
      const CELL = 0.04;
      const cells = new Map<string, number>();
      const paired = found.walls.filter((w) => w.thicknessFeet > 0);
      for (const w of paired) {
        const cx = Math.floor(((w.x1 + w.x2) / 2) / CELL);
        const cy = Math.floor(((w.y1 + w.y2) / 2) / CELL);
        const at = `${cx},${cy}`;
        cells.set(at, (cells.get(at) ?? 0) + w.lengthFeet);
      }
      // ── PERMISSIVE CELLS, THEN THE HEAVIEST COMPONENT ──
      //
      // A tenth of the fullest cell was far too strict: it kept only the
      // densest CORNER of the plan — Camp Bow Wow's box came out a fifth of
      // the sheet — and the filter then lost 8,029 ft of real wall to remove
      // 5,890 ft of junk, which is worse than not filtering at all.
      //
      // The floor plan is not the densest cell, it is the largest CONNECTED
      // AREA of paired walls. So any cell holding real paired footage is
      // live, and components are separated only by genuine gutters; the one
      // with the most FOOTAGE wins, not the one with the most cells, so a
      // sprawl of thin detail cells cannot outvote the plan.
      const live = new Set(
        [...cells.entries()].filter(([, ft]) => ft >= 1).map(([at]) => at),
      );
      // Largest 8-connected group of live cells.
      const seen = new Set<string>();
      let best: string[] = [];
      let bestWeight = 0;
      for (const start of live) {
        if (seen.has(start)) continue;
        const group: string[] = [];
        const queue = [start];
        seen.add(start);
        while (queue.length > 0) {
          const at = queue.pop() as string;
          group.push(at);
          const [gx, gy] = at.split(",").map(Number);
          for (let dx = -1; dx <= 1; dx += 1) {
            for (let dy = -1; dy <= 1; dy += 1) {
              const next = `${gx + dx},${gy + dy}`;
              if (live.has(next) && !seen.has(next)) {
                seen.add(next);
                queue.push(next);
              }
            }
          }
        }
        const weight = group.reduce((a, at) => a + (cells.get(at) ?? 0), 0);
        if (weight > bestWeight) {
          bestWeight = weight;
          best = group;
        }
      }
      const blob = new Set(best);
      const xs = best.map((at) => Number(at.split(",")[0]));
      const ys = best.map((at) => Number(at.split(",")[1]));
      const footprint =
        best.length === 0
          ? null
          : {
              x1: (Math.min(...xs) - 1) * CELL,
              y1: (Math.min(...ys) - 1) * CELL,
              x2: (Math.max(...xs) + 2) * CELL,
              y2: (Math.max(...ys) + 2) * CELL,
            };

      const fpu = saved.feetPerUnit;
      const realWalls = saved.verdicts.filter((v) => v.verdict === "wall" || v.verdict === "traced");
      const unsure = saved.verdicts.filter((v) => v.verdict === "unsure");

      const onKey = (w: { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number }) =>
        realWalls.some(
          (k) =>
            parallel(w, k) &&
            Math.max(offLine(w, k.x1, k.y1, fpu), offLine(w, k.x2, k.y2, fpu)) <= band(w, k),
        );
      const isUnsure = (w: { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number }) =>
        unsure.some(
          (u) =>
            parallel(w, u) &&
            Math.max(offLine(w, u.x1, u.y1, fpu), offLine(w, u.x2, u.y2, fpu)) <= band(w, u),
        );

      let junkBefore = 0;
      let junkAfter = 0;
      let realBefore = 0;
      let realAfter = 0;
      for (const w of found.walls) {
        if (isUnsure(w)) continue;
        const cx = (w.x1 + w.x2) / 2;
        const cy = (w.y1 + w.y2) / 2;
        // Inert rather than empty when no footprint is found: a filter that
        // keeps nothing would report a perfect junk score and no walls.
        // ── MEMBERSHIP, NOT A BOUNDING BOX ──
        //
        // The box of the heaviest component still lost 4,268 ft of real wall
        // against 3,978 ft of junk — about one for one, which is no filter at
        // all. A plan is rarely a rectangle: a box drawn round an L-shaped
        // footprint, or one split by a corridor gutter, clips real wall at
        // the corners while admitting whatever shares the rectangle.
        //
        // So a candidate survives when its own CELL is in the component, or
        // touches one that is — the one-cell skirt doing the same job the box
        // padding did, without the rectangle.
        const keep =
          footprint === null
            ? true
            : (() => {
                const gx = Math.floor(cx / CELL);
                const gy = Math.floor(cy / CELL);
                for (let dx = -1; dx <= 1; dx += 1) {
                  for (let dy = -1; dy <= 1; dy += 1) {
                    if (blob.has(`${gx + dx},${gy + dy}`)) return true;
                  }
                }
                return false;
              })();
        if (onKey(w)) {
          realBefore += w.lengthFeet;
          if (keep) realAfter += w.lengthFeet;
        } else {
          junkBefore += w.lengthFeet;
          if (keep) junkAfter += w.lengthFeet;
        }
      }

      // ── IS THE ESTIMATOR WRONG, OR IS THE JUNK NOT SEPARABLE? ──
      //
      // Three formulations all traded about one real foot per junk foot. That
      // is either a bad estimator of the plan's extent or a sheet where the
      // two overlap. The key's OWN box answers it — it uses the answer and so
      // can never be a filter, but as a yardstick it says how far off the
      // estimate is.
      const kb = realWalls.reduce(
        (b, k) => ({
          x1: Math.min(b.x1, k.x1, k.x2),
          y1: Math.min(b.y1, k.y1, k.y2),
          x2: Math.max(b.x2, k.x1, k.x2),
          y2: Math.max(b.y2, k.y1, k.y2),
        }),
        { x1: 1, y1: 1, x2: 0, y2: 0 },
      );
      console.log(
        `  ${file.dir.slice(0, 22).padEnd(22)}/${file.sheet.padEnd(7)} ` +
          `key box ${kb.x1.toFixed(2)}-${kb.x2.toFixed(2)} x ${kb.y1.toFixed(2)}-${kb.y2.toFixed(2)}  ` +
          `estimate ${footprint === null ? "none" : `${footprint.x1.toFixed(2)}-${footprint.x2.toFixed(2)} x ${footprint.y1.toFixed(2)}-${footprint.y2.toFixed(2)}`}  ` +
          `key area ${((kb.x2 - kb.x1) * (kb.y2 - kb.y1)).toFixed(3)} vs ` +
          `${footprint === null ? "-" : ((footprint.x2 - footprint.x1) * (footprint.y2 - footprint.y1)).toFixed(3)}`,
      );

      rows.push({
        sheet: `${file.dir.slice(0, 26)}/${file.sheet}`,
        junkBefore,
        junkAfter,
        realBefore,
        realAfter,
        views: measured.length,
        primary:
          footprint === null
            ? "NO FOOTPRINT — filter inert"
            : `${(primary === null ? "no caption" : primary.view.name).slice(0, 28)} · box ` +
              `${footprint.x1.toFixed(2)}-${footprint.x2.toFixed(2)} x ` +
              `${footprint.y1.toFixed(2)}-${footprint.y2.toFixed(2)}`,
      });
      read.push(`${file.dir}/${file.sheet}`);
    }

    // ── A RUN OVER NO SHEETS WOULD PRINT A PERFECT TRADE ──
    expect(
      read.length,
      "no training sheets were read, so every figure below would be a clean zero",
    ).toBeGreaterThan(0);

    console.log(`\n${read.length} training sheets\n`);
    console.log(
      `  ${"sheet".padEnd(34)} ${"junk".padStart(8)} ${"->".padStart(8)} ` +
        `${"real".padStart(8)} ${"->".padStart(8)} ${"views".padStart(5)}  primary view`,
    );
    const tot = { jb: 0, ja: 0, rb: 0, ra: 0 };
    for (const r of rows.sort((a, b) => b.junkBefore - b.junkAfter - (a.junkBefore - a.junkAfter))) {
      tot.jb += r.junkBefore;
      tot.ja += r.junkAfter;
      tot.rb += r.realBefore;
      tot.ra += r.realAfter;
      const lost = r.realBefore - r.realAfter;
      console.log(
        `  ${r.sheet.padEnd(34)} ${r.junkBefore.toFixed(0).padStart(8)} ` +
          `${r.junkAfter.toFixed(0).padStart(8)} ${r.realBefore.toFixed(0).padStart(8)} ` +
          `${r.realAfter.toFixed(0).padStart(8)} ${String(r.views).padStart(5)}  ` +
          `${lost > 1 ? `LOST ${lost.toFixed(0)} ft — ` : ""}${r.primary.slice(0, 40)}`,
      );
    }
    console.log(
      `\n  TOTAL junk ${tot.jb.toFixed(0)} -> ${tot.ja.toFixed(0)} ` +
        `(removed ${(tot.jb - tot.ja).toFixed(0)} ft) · ` +
        `real ${tot.rb.toFixed(0)} -> ${tot.ra.toFixed(0)} (LOST ${(tot.rb - tot.ra).toFixed(0)} ft)`,
    );
    console.log(
      "\nthe target is near-zero real footage lost; a building with a LOST figure is where this filter is wrong",
    );
  });
});
