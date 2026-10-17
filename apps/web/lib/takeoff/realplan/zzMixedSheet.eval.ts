import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { findWallsOnSheet, inPageWidthUnits, type SheetTextItem } from "../findWallsOnSheet";
import {
  excludedViews,
  primaryView,
  sheetViews,
  viewRegions,
  viewBoxes,
  viewsInRegions,
  wallsPerView,
} from "../sheetViews";
import { leftOutSummary } from "../viewKind";
import {
  oneFacePerLine,
  wallFromPair,
  type StrokeSegment,
  type WallCandidate,
} from "../wallVectors";

/**
 * ── WHAT IS ON A MIXED SHEET, AND WHICH VIEW EACH FOUND WALL CAME FROM ──
 *
 *     REAL_PLAN_DIR="/path/to/sets" REAL_PLAN_SHEET="Camp Bow Wow:15" \
 *       pnpm --filter @prova/web exec vitest run \
 *         --config vitest.eval.config.mts lib/takeoff/realplan/zzMixedSheet.eval.ts
 *
 * A120 is "RESTROOM PLANS & ELEVATIONS": one enlarged PLAN, eight interior
 * ELEVATIONS, and an accessories SCHEDULE table. Detection marked walls on all
 * three kinds. This asks, of the sheet as the product reads it today:
 *
 *   - what views are found, and what each one's caption says;
 *   - how many found walls fall inside each view, and how much footage;
 *   - the ANGLE distribution of those walls, because the complaint names big
 *     diagonal X patterns and a diagonal wall is rare on a restroom plan;
 *   - for the diagonals, whether a third parallel stroke sits beside them at a
 *     whole number of steps, which is what `inAHatchSeries` tests.
 *
 * It asserts nothing about quality. It prints, because the rule to write
 * depends on what these strokes actually are, and three plausible rules were
 * already written in this repo for defects nobody had measured.
 *
 * NOTHING FROM THE DRAWING IS WRITTEN ANYWHERE. Counts, angles, lengths and
 * view captions only — the same bar `realSheets.eval.ts` holds itself to.
 */

const DIR = process.env.REAL_PLAN_DIR ?? "";
const WANT = process.env.REAL_PLAN_SHEET ?? "Camp Bow Wow:15";

function findSet(dir: string, fragment: string): string | null {
  for (const name of readdirSync(dir)) {
    if (name.toLowerCase().endsWith(".pdf") && name.includes(fragment)) return join(dir, name);
  }
  return null;
}

// SKIPS WITHOUT THE FOLDER, loudly, rather than printing an empty report — the
// bar `harness.test.ts` holds every keyless eval to.
describe.skipIf(DIR === "")("a mixed sheet, as the product reads it", () => {
  it(
    "reports every view and where the found walls sit",
    async () => {
      const [fragment, pageText] = WANT.split(":");
      const page = Number(pageText);
      const matches = readdirSync(DIR).filter(
        (name) => name.toLowerCase().endsWith(".pdf") && name.includes(fragment),
      );
      // ── THE INPUT RESOLVED TO SOMETHING ──
      //
      // A mistyped REAL_PLAN_SHEET would otherwise print an empty report and
      // pass, which is the vacuous green this whole directory exists to end.
      expect(
        matches.length,
        `no pdf in REAL_PLAN_DIR matching "${fragment}"`,
      ).toBeGreaterThan(0);
      const file = findSet(DIR, fragment);

      const pdf = await openPlanPdf(readFileSync(file as string));
      const text = await pdf.pageText(page);
      const strokes = await pdf.pageStrokes(page);
      const segments = strokes.segments as StrokeSegment[];
      const size = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
      const textItems: SheetTextItem[] = text.items.map((i) => ({
        str: i.str,
        x: i.x,
        y: i.y,
        width: i.width,
        height: i.height,
      }));

      // ── A: THE CAPTIONS, BEFORE ANY REGION INTERSECTION ──
      //
      // Separating two failures that look identical downstream: "no caption was
      // matched to a scale" and "the captions were found and the regions
      // collapsed them into one".
      const named = sheetViews(textItems, size.widthPt);
      console.log(`\n=== ${fragment} p${page} — ${segments.length} strokes ===`);
      console.log(`A. sheetViews names ${named.length} view(s) BEFORE regions:`);
      for (const view of named) {
        console.log(
          `   "${view.name}"  scale=${view.scaleName ?? "none"}  ` +
            `caption at ${view.captionX.toFixed(3)},${view.captionY.toFixed(3)}`,
        );
      }

      // ── B: THE REGIONS THE GUTTERS PRODUCE ──
      const regions = viewRegions(segments, size);
      console.log(`\nB. viewRegions finds ${regions.length} region(s):`);
      for (const region of regions) {
        console.log(
          `   x=${region.from.toFixed(3)}..${region.to.toFixed(3)}  ` +
            `y=${region.fromY.toFixed(3)}..${region.toY.toFixed(3)}`,
        );
      }

      const views = viewsInRegions(named, regions);
      console.log(`\nC. after the intersection: ${views.length} view(s)`);
      for (const view of views) {
        console.log(
          `   "${view.name}"  scale=${view.scaleName ?? "none"}  ` +
            `x=${view.from.toFixed(3)}..${view.to.toFixed(3)}  y=${view.fromY.toFixed(3)}..${view.toY.toFixed(3)}`,
        );
      }

      // ── D: EVERY SCALE CAPTION PRINTED ON THE SHEET ──
      //
      // Whatever the view finder did with them. If the elevations' own
      // `3/8" = 1'-0"` is on the page and not in A, the pairing is the defect;
      // if it is not on the page at all, the sheet does not caption them.
      const scaleish = textItems.filter((item) => /=\s*1['’]?\s*-?\s*0/.test(item.str));
      console.log(`\nD. ${scaleish.length} scale-looking text item(s) on the page:`);
      for (const item of scaleish.slice(0, 20)) {
        console.log(
          `   "${item.str.trim()}" at ${(item.x / size.widthPt).toFixed(3)},${(item.y / size.widthPt).toFixed(3)}`,
        );
      }

      // ── E: THE TITLES THAT NAME AN ELEVATION OR A SCHEDULE ──
      const titleish = textItems.filter((item) =>
        /ELEV|SECTION|DETAIL|SCHEDULE|PLAN|DIAGRAM/i.test(item.str),
      );
      console.log(`\nE. ${titleish.length} title-looking item(s):`);
      for (const item of titleish.slice(0, 24)) {
        console.log(
          `   "${item.str.trim()}" at ${(item.x / size.widthPt).toFixed(3)},${(item.y / size.widthPt).toFixed(3)}`,
        );
      }

      // ── F: THE PRODUCT PATH — THE SPLIT, EXACTLY AS TakeoffPlanViewer RUNS IT ──
      // ── THE SHEET'S OWN SCALE, NOT A GUESS ──
      //
      // This was hardcoded to A120's 1/2" caption, which is wrong on every
      // other sheet and wrong in a way that does not look wrong: the "long
      // line" floor is in FEET, so an eight-times error changes which lines
      // are candidates at all. A102 reported 200 candidates at A120's scale.
      const captioned = views
        .map((one) => one.feetPerInch)
        .filter((n): n is number => n !== null && n > 0);
      const feetPerInch = captioned.length > 0 ? Math.min(...captioned) : 2;
      const feetPerUnit = (size.widthPt / 72) * feetPerInch;
      console.log(`\n   measuring at ${feetPerInch} ft per paper inch`);
      const wholeSheet = findWallsOnSheet({
        segments,
        textItems,
        pageSize: size,
        feetPerUnit,
        wallTypes: [],
        sampledSheets: null,
      });
      console.log(
        `\nF. whole sheet, no split: ${wholeSheet.walls.length} runs, ` +
          `${wholeSheet.walls.reduce((n, w) => n + w.lengthFeet, 0).toFixed(0)} ft`,
      );

      const measured = wallsPerView({
        segments,
        textItems,
        pageSize: size,
        views,
        wallTypes: [],
        feetPerUnit,
        sampledSheets: null,
      });
      const picked = primaryView(measured);
      console.log(`\n   views MEASURED: ${measured.length}`);
      for (const one of measured) {
        console.log(
          `     "${one.view.name}" ${one.view.scaleName ?? "?"} — ` +
            `${one.walls.length} runs, ${one.lengthFeet.toFixed(0)} ft`,
        );
      }
      console.log(
        `   primary: ${picked.primary ? `"${picked.primary.view.name}" ${picked.primary.lengthFeet.toFixed(0)} ft` : "NONE"}`,
      );
      const leftOut = excludedViews(views);
      console.log(`   left out (${leftOut.length}): ${leftOutSummary(leftOut.map((e) => e.reason))}`);
      for (const one of leftOut) console.log(`     "${one.name}" — ${one.reason}`);

      // ── G: THE RUNS THAT SURVIVE, AND WHETHER ANY IS STILL A DIAGONAL ──
      const walls = picked.primary?.walls ?? [];
      const deg = (w: { x1: number; y1: number; x2: number; y2: number }) => {
        const a = (Math.atan2(w.y2 - w.y1, w.x2 - w.x1) * 180) / Math.PI;
        return ((a % 180) + 180) % 180;
      };
      const isDiagonal = (w: WallCandidate) => {
        const d = deg(w);
        return !(d < 5 || d > 175) && Math.abs(d - 90) >= 5;
      };
      const diag = walls.filter(isDiagonal);
      console.log(
        `\nG. the measured plan: ${walls.length} runs, ` +
          `${walls.reduce((n, w) => n + w.lengthFeet, 0).toFixed(0)} ft, ` +
          `of which ${diag.length} diagonal runs / ${diag.reduce((n, w) => n + w.lengthFeet, 0).toFixed(0)} ft`,
      );

      // ── H: COVERAGE OF EVERY SURVIVING RUN ──
      //
      // The measurement that produced the hatch rule, re-run on what is left:
      // how much of each run's own length actually has a stroke along it.
      const strokesIn = picked.primary?.found.inUnits ?? [];
      const lenOf = (s2: { x1: number; y1: number; x2: number; y2: number }) =>
        Math.hypot(s2.x2 - s2.x1, s2.y2 - s2.y1);
      const angleOfSeg = (s2: { x1: number; y1: number; x2: number; y2: number }) =>
        Math.atan2(s2.y2 - s2.y1, s2.x2 - s2.x1);
      const parallelGap = (a: number, b: number) =>
        Math.abs(((a - b + Math.PI / 2) % Math.PI) - Math.PI / 2);
      const coverage = (wall: WallCandidate) => {
        const dir = angleOfSeg(wall);
        const len = lenOf(wall);
        if (len === 0) return 1;
        const ux = (wall.x2 - wall.x1) / len;
        const uy = (wall.y2 - wall.y1) / len;
        const nx = -(wall.y2 - wall.y1) / len;
        const ny = (wall.x2 - wall.x1) / len;
        const halfThick = wall.thicknessFeet / feetPerUnit / 2;
        const spans: [number, number][] = [];
        for (const seg of strokesIn) {
          if (lenOf(seg) === 0) continue;
          if (parallelGap(angleOfSeg(seg), dir) > 0.05) continue;
          const m1x = seg.x1 - wall.x1;
          const m1y = seg.y1 - wall.y1;
          const m2x = seg.x2 - wall.x1;
          const m2y = seg.y2 - wall.y1;
          const acrossMid = Math.abs(((m1x + m2x) / 2) * nx + ((m1y + m2y) / 2) * ny);
          if (acrossMid > halfThick * 1.3) continue;
          const a = m1x * ux + m1y * uy;
          const b = m2x * ux + m2y * uy;
          spans.push([Math.min(a, b), Math.max(a, b)]);
        }
        if (spans.length === 0) return 0;
        spans.sort((q, r) => q[0] - r[0]);
        let covered = 0;
        let at = -Infinity;
        for (const [from, to] of spans) {
          const lo = Math.max(from, at, 0);
          const hi = Math.min(to, len);
          if (hi > lo) covered += hi - lo;
          at = Math.max(at, to);
        }
        return covered / len;
      };
      const rows = walls
        .map((wall) => ({ wall, cover: coverage(wall), diagonal: isDiagonal(wall) }))
        .sort((a, b) => a.cover - b.cover);
      console.log("\nH. runs by coverage (lowest first)");
      console.log("      ft     in    deg   cover");
      for (const row of rows.slice(0, 14)) {
        console.log(
          `  ${row.wall.lengthFeet.toFixed(1).padStart(6)} ${(row.wall.thicknessFeet * 12).toFixed(1).padStart(6)} ` +
            `${deg(row.wall).toFixed(0).padStart(6)} ${row.cover.toFixed(2).padStart(7)}  ${row.diagonal ? "DIAGONAL" : ""}`,
        );
      }
      const stat = (list: typeof rows) => {
        const v = list.map((r) => r.cover).sort((a, b) => a - b);
        if (v.length === 0) return "none";
        return `min ${v[0].toFixed(2)} median ${v[Math.floor(v.length / 2)].toFixed(2)} max ${v.at(-1)!.toFixed(2)}`;
      };
      console.log(`\n  diagonals (${rows.filter((r) => r.diagonal).length}): ${stat(rows.filter((r) => r.diagonal))}`);
      console.log(`  orthogonal (${rows.filter((r) => !r.diagonal).length}): ${stat(rows.filter((r) => !r.diagonal))}`);

      // ── HOW MUCH A REVIEWER IS BEING ASKED TO DECIDE ──
      //
      // The same two populations `candidatesFromLastDetect` builds in the
      // viewer: every run the detector reported, plus the long faces it could
      // not pair at all. Counted here so a review can be SIZED before somebody
      // sits down to it, and so the effect of a detection change on that
      // workload is a number rather than an impression.
      const planBoxes = measured.flatMap((one) => viewBoxes(one.view));
      const onAPlan = (ax1: number, ay1: number, ax2: number, ay2: number) => {
        if (planBoxes.length === 0) return true;
        const cx = (ax1 + ax2) / 2;
        const cy = (ay1 + ay2) / 2;
        return planBoxes.some(
          (box) => cx >= box.from && cx < box.to && cy >= box.fromY && cy < box.toY,
        );
      };
      const detected = picked.primary?.walls ?? [];
      // The scale the PRIMARY view was actually measured at, which is what
      // its candidates must be judged in.
      const sheetFeetPerUnit = picked.primary?.view.feetPerInch
        ? (size.widthPt / 72) * picked.primary.view.feetPerInch
        : feetPerUnit;
      const allFaces: StrokeSegment[] = oneFacePerLine(
        segments,
        sheetFeetPerUnit / size.widthPt,
      ).map(inPageWidthUnits(size.widthPt));
      const coveredByWall = (f: { x1: number; y1: number; x2: number; y2: number }) => {
        const cx = (f.x1 + f.x2) / 2;
        const cy = (f.y1 + f.y2) / 2;
        return detected.some((w) => {
          const dx = w.x2 - w.x1;
          const dy = w.y2 - w.y1;
          const len2 = dx * dx + dy * dy;
          const t =
            len2 === 0 ? 0 : Math.max(0, Math.min(1, ((cx - w.x1) * dx + (cy - w.y1) * dy) / len2));
          return Math.hypot(cx - (w.x1 + t * dx), cy - (w.y1 + t * dy)) * sheetFeetPerUnit <= 1.5;
        });
      };
      const pairOpts = { feetPerPoint: sheetFeetPerUnit };
      const unclaimed = allFaces.filter(
        (f) =>
          Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * sheetFeetPerUnit >= 12 &&
          onAPlan(f.x1, f.y1, f.x2, f.y2) &&
          !coveredByWall(f) &&
          !allFaces.some((other) => other !== f && wallFromPair(f, other, pairOpts) !== null),
      );
      console.log(
        `\nCANDIDATES a reviewer would see: ${detected.length + unclaimed.length}` +
          `  (${detected.length} detected runs + ${unclaimed.length} unclaimed long lines)`,
      );

      await pdf.close();
    },
    600_000,
  );
});
