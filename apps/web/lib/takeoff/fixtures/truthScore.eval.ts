import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { dimensionLabels, metricDimensionLabels } from "../../plan-ingest/dimensionLabels";
import { readSheetScale } from "../scaleFromDimensions";
import { findWallsOnSheet, type SheetTextItem } from "../findWallsOnSheet";
import { sheetViews, viewRegions, viewsInRegions, wallsPerView, primaryView } from "../sheetViews";
import type { StrokeSegment, WallCandidate } from "../wallVectors";

/**
 * ── THE TWENTY SHEETS, AGAINST THE GEOMETRY THEY WERE DRAWN FROM ──
 *
 *     pnpm --filter @prova/web exec vitest run \
 *       --config vitest.eval.config.mts lib/takeoff/fixtures/truthScore.eval.ts
 *
 * ── WHY THIS EXISTS WHEN `keyScore.eval.ts` ALREADY DID ──
 *
 * It did not. `expected/` holds keys read off each drawing's TEXT LAYER, and
 * those deliberately carry no wall length — `expected.test.ts` fails the build
 * if one ever appears, because measuring a drawing with the detector under test
 * turns a key into an echo. That guard is untouched and still right.
 *
 * `truth/` is a different thing: the generator's OWN geometry, exported when
 * the sheets were drawn. Nobody measured it and no detector produced it. The
 * PDFs in `plans/` were confirmed byte-identical to the generator's output, 20
 * of 20, before any of this was written.
 *
 * ── THE WALL BETWEEN THE KEY AND THE ENGINE ──
 *
 * Only a scorer may read `truth/`. `truthWall.test.ts` fails the build if
 * anything under `lib/takeoff` outside this directory imports it, because a
 * detector that can see the answers stops being evidence of anything.
 *
 * ── THE MEASUREMENT RULES, FROM `generator/README.md` ──
 *
 *   - length is along the CENTRELINE;
 *   - at an L-corner the centrelines meet at the corner point, so nothing is
 *     counted twice;
 *   - at a T the branch stops at the centreline of the wall it meets;
 *   - GROSS ignores openings; NET subtracts every door and window width.
 */
const PLANS = join(import.meta.dirname, "plans");
const TRUTH = join(import.meta.dirname, "truth");

type TruthWall = {
  id: string;
  start_ft: [number, number];
  end_ft: [number, number];
  length_ft: number;
  net_length_ft: number;
  thickness_in: number;
  type: string;
  exterior: boolean;
};
type Truth = {
  id: string;
  kind: string;
  scale_text: string | null;
  totals: {
    wall_lf_gross: number;
    wall_lf_net: number;
    wall_lf_exterior_gross: number;
    wall_lf_interior_gross: number;
  };
  walls: TruthWall[];
};

const pct = (found: number, want: number): number => (want === 0 ? (found === 0 ? 0 : 100) : (found / want - 1) * 100);
const f1 = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1);

/** Feet of one candidate, from its own centreline. */
const lenOf = (w: WallCandidate) => w.lengthFeet;

/**
 * Line up the page with the generator's own coordinates.
 *
 * ── SOLVED FROM THE TWO BOUNDING BOXES, NOT ASSUMED ──
 *
 * The key is in feet of building from the generator's origin; a found run is
 * in page-width units with y running DOWN, because `planPdf` composes the
 * viewport's flip in. Nothing in either file records the offset between them.
 *
 * Both describe the same building, so their bounding boxes are the same
 * rectangle and the offset falls out of aligning them. That is only sound
 * while most of the building is found — which is exactly the thing in doubt —
 * so the fit is REPORTED with its own error, and a sheet whose boxes disagree
 * in SIZE by more than a few percent has its per-wall list suppressed rather
 * than printed wrong.
 */
type Fit = { feetPerUnit: number; offsetX: number; offsetY: number; sizeError: number };

function fitToKey(
  found: readonly WallCandidate[],
  truth: readonly TruthWall[],
  feetPerUnit: number,
): Fit | null {
  if (found.length === 0 || truth.length === 0) return null;
  const fx = found.flatMap((w) => [w.x1 * feetPerUnit, w.x2 * feetPerUnit]);
  const fy = found.flatMap((w) => [-w.y1 * feetPerUnit, -w.y2 * feetPerUnit]);
  const kx = truth.flatMap((w) => [w.start_ft[0], w.end_ft[0]]);
  const ky = truth.flatMap((w) => [w.start_ft[1], w.end_ft[1]]);
  const span = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  const wF = span(fx);
  const hF = span(fy);
  const wK = span(kx);
  const hK = span(ky);
  if (!(wK > 0) || !(hK > 0)) return null;
  const sizeError = Math.max(Math.abs(wF / wK - 1), Math.abs(hF / hK - 1));
  return {
    feetPerUnit,
    offsetX: Math.min(...kx) - Math.min(...fx),
    offsetY: Math.min(...ky) - Math.min(...fy),
    sizeError,
  };
}

/**
 * Which key walls nothing found, and which found runs are on no key wall.
 *
 * Matched by POSITION — a found run is the same physical wall as a key wall
 * when it lies along it. Not by length: two 12 ft partitions in one house are
 * the same length and are not the same wall, and a total that matches while
 * both halves are wrong is the failure this repo keeps paying for.
 */
function matchWalls(
  found: readonly WallCandidate[],
  truth: readonly TruthWall[],
  fit: Fit,
): { missed: TruthWall[]; extras: WallCandidate[]; pairs: { key: TruthWall; got: number; pieces: number }[] } {
  const toFeet = (w: WallCandidate) => ({
    ax: w.x1 * fit.feetPerUnit + fit.offsetX,
    ay: -w.y1 * fit.feetPerUnit + fit.offsetY,
    bx: w.x2 * fit.feetPerUnit + fit.offsetX,
    by: -w.y2 * fit.feetPerUnit + fit.offsetY,
  });
  /** How far the midpoint of one lies from the other's segment, in feet. */
  const gap = (w: WallCandidate, k: TruthWall): number => {
    const { ax, ay, bx, by } = toFeet(w);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const kx = k.end_ft[0] - k.start_ft[0];
    const ky = k.end_ft[1] - k.start_ft[1];
    const len2 = kx * kx + ky * ky;
    if (len2 === 0) return Number.POSITIVE_INFINITY;
    let t = ((mx - k.start_ft[0]) * kx + (my - k.start_ft[1]) * ky) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(mx - (k.start_ft[0] + kx * t), my - (k.start_ft[1] + ky * t));
  };
  /** Parallel within about 15 degrees. */
  const aligned = (w: WallCandidate, k: TruthWall): boolean => {
    const { ax, ay, bx, by } = toFeet(w);
    const wx = bx - ax;
    const wy = by - ay;
    const kx = k.end_ft[0] - k.start_ft[0];
    const ky = k.end_ft[1] - k.start_ft[1];
    const lw = Math.hypot(wx, wy);
    const lk = Math.hypot(kx, ky);
    if (lw === 0 || lk === 0) return false;
    return Math.abs((wx * kx + wy * ky) / (lw * lk)) > 0.96;
  };

  // ── EVERY RUN ALONG A KEY WALL, NOT THE BEST ONE ──
  //
  // A 1:1 match reported S08's 56 ft W6 as "5.1 ft found" while the other
  // fragments of the same wall sat in a pile labelled "extras". That is a
  // fragmentation report wearing an under-measurement's clothes. A wall is
  // under-measured when EVERYTHING lying along it adds up short, so that is
  // what is summed.
  const used = new Set<number>();
  const missed: TruthWall[] = [];
  const pairs: { key: TruthWall; got: number; pieces: number }[] = [];
  for (const want of truth) {
    let got = 0;
    let pieces = 0;
    for (let i = 0; i < found.length; i += 1) {
      if (used.has(i)) continue;
      if (!aligned(found[i], want)) continue;
      if (gap(found[i], want) > 2.5) continue;
      used.add(i);
      got += found[i].lengthFeet;
      pieces += 1;
    }
    if (pieces === 0) missed.push(want);
    else pairs.push({ key: want, got, pieces });
  }
  return { missed, extras: found.filter((_, i) => !used.has(i)), pairs };
}

describe.skipIf(!existsSync(PLANS) || !existsSync(TRUTH))("walls against the generator's own geometry", () => {
  it("scores gross, net and the exterior/interior split", async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `S${String(i + 1).padStart(2, "0")}`);
    const opened: string[] = [];
    const rows: string[] = [];
    let within2 = 0;
    let scored = 0;
    const missedAll: string[] = [];
    const shortAll: string[] = [];

    for (const id of ids) {
      const pdf = join(PLANS, `${id}.pdf`);
      const keyFile = join(TRUTH, `${id}.json`);
      if (!existsSync(pdf) || !existsSync(keyFile)) continue;
      const key = JSON.parse(readFileSync(keyFile, "utf8")) as Truth;

      if (key.kind !== "vector") {
        rows.push(`${id.padEnd(4)} ${"NOT SUPPORTED (scan)".padEnd(22)} key gross ${key.totals.wall_lf_gross.toFixed(0)}`);
        continue;
      }

      const doc = await openPlanPdf(readFileSync(pdf));
      try {
        opened.push(id);
        const text = await doc.pageText(1);
        const strokes = await doc.pageStrokes(1);
        const verdict = readSheetScale(text, strokes.segments, dimensionLabels(text), {}, metricDimensionLabels(text));
        if (!verdict.ok) {
          rows.push(`${id.padEnd(4)} ${"NO SCALE — declined".padEnd(22)} key gross ${key.totals.wall_lf_gross.toFixed(0)}`);
          continue;
        }
        const items: SheetTextItem[] = text.items.map((i) => ({
          str: i.str, x: i.x, y: i.y, width: i.width, height: i.height,
        }));
        const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
        const feetPerUnit = (text.widthPt / 72) * verdict.feetPerInch;
        const views = viewsInRegions(
          sheetViews(text.items, strokes.widthPt),
          viewRegions(strokes.segments as StrokeSegment[], pageSize),
        );
        const base = { segments: strokes.segments as StrokeSegment[], textItems: items, pageSize, wallTypes: [] as never[] };
        const f =
          views.length >= 2
            ? primaryView(wallsPerView({ ...base, views, feetPerUnit })).primary?.found ?? null
            : findWallsOnSheet({ ...base, feetPerUnit, sampledSheets: null });
        const walls = f?.walls ?? [];
        const gross = walls.reduce((n, w) => n + lenOf(w), 0);
        // HOW MANY OPENINGS THE MERGE ACTUALLY BRIDGED. `WallCandidate.openings`
        // is populated only when `mergeWalls` joined across one, so this is the
        // merge reporting on itself rather than being inferred from a total.
        const bridged = walls.reduce((n, w) => n + (w.openings?.length ?? 0), 0);
        const bridgedFt = walls.reduce(
          (n, w) => n + (w.openings ?? []).reduce((m, o) => m + (o.widthFt ?? 0), 0),
          0,
        );
        const keyOpenings = (key as unknown as { openings?: { width_ft: number }[] }).openings ?? [];
        const keyOpenFt = keyOpenings.reduce((n, o) => n + o.width_ft, 0);

        const wantGross = key.totals.wall_lf_gross;
        const wantNet = key.totals.wall_lf_net;
        const err = pct(gross, wantGross);
        const ok = Math.abs(err) <= 2;
        scored += 1;
        if (ok) within2 += 1;

        const fit = fitToKey(walls, key.walls, feetPerUnit);
        let missNote = "fit?";
        if (fit !== null && fit.sizeError < 0.08) {
          const { missed, extras, pairs } = matchWalls(walls, key.walls, fit);
          missNote = `${missed.length} missed / ${extras.length} extra`;
          // PER WALL, because a total that is 5% short with nothing missing is
          // not a missing-wall problem and the list of misses cannot say so.
          type Short = { id: string; want: number; got: number; n: number; lost: number };
          const short: Short[] = pairs
            .map((pr): Short => ({
              id: pr.key.id,
              want: pr.key.length_ft,
              got: pr.got,
              n: pr.pieces,
              lost: pr.key.length_ft - pr.got,
            }))
            .filter((r: Short) => Math.abs(r.lost) > 0.5)
            .sort((a: Short, b: Short) => b.lost - a.lost);
          if (short.length > 0) {
            shortAll.push(
              `${id}  ` +
                short
                  .slice(0, 6)
                  .map((r: Short) => `${r.id} ${r.got.toFixed(1)}/${r.want.toFixed(1)}${r.n > 1 ? `x${r.n}` : ""}`)
                  .join("  "),
            );
          }
          if (missed.length > 0) {
            const byLen = [...missed].sort((a, b) => b.length_ft - a.length_ft);
            missedAll.push(
              `${id}  ${missed.length} missed: ` +
                byLen
                  .slice(0, 8)
                  .map((m) => `${m.id} ${m.length_ft.toFixed(0)}ft ${m.thickness_in}in ${m.exterior ? "EXT" : "int"}`)
                  .join(", "),
            );
          }
        }

        rows.push(
          [
            id.padEnd(4),
            `${walls.length}`.padStart(4),
            gross.toFixed(0).padStart(7),
            wantGross.toFixed(0).padStart(7),
            f1(err).padStart(8),
            (ok ? "PASS" : "FAIL").padEnd(5),
            wantNet.toFixed(0).padStart(7),
            key.totals.wall_lf_exterior_gross.toFixed(0).padStart(6),
            key.totals.wall_lf_interior_gross.toFixed(0).padStart(6),
            "  " + missNote,
            `  bridged ${bridged}/${keyOpenings.length} openings = ${bridgedFt.toFixed(0)}/${keyOpenFt.toFixed(0)} ft`,
          ].join(" "),
        );
      } finally {
        await doc.close();
      }
    }

    console.log(
      [
        "",
        "id   runs   found  keyGro   err%   2%?   keyNet  keyExt keyInt",
        "---------------------------------------------------------------",
        ...rows,
        "",
        `GROSS WITHIN 2%: ${within2} of ${scored} vector plans scored.`,
        "",
        "── PER WALL: found/key (lost) ──",
        ...shortAll,
        "",
        "── WALLS IN THE KEY THAT NOTHING FOUND ──",
        ...missedAll,
      ].join("\n"),
    );
    expect(opened.length, "no fixture was opened").toBeGreaterThan(0);
  }, 300_000);
});
