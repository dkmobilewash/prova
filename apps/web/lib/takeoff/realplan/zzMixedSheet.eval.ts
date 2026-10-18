import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SINGLE_LINE_COLOUR, VERDICT_COLOURS } from "../answerKeyReview";
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
import { classifySingleLines, worthOffering } from "../singleLines";
import { drawingRegions } from "../planRegion";
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
      // THE SAME CLIP THE PRODUCT APPLIES on a one-drawing sheet, so this
      // probe reports what a reviewer would be shown rather than what the
      // sheet happens to contain.
      const drawing = drawingRegions(regions, segments, size.widthPt);
      const planBoxes =
        measured.length > 1
          ? measured.flatMap((one) => viewBoxes(one.view))
          : drawing.map((r) => ({ from: r.from, to: r.to, fromY: r.fromY, toY: r.toY }));
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
      // ── WHAT THE EXISTING CLASSIFIER ALREADY SAYS ABOUT THEM ──
      //
      // `classifySingleLines` is called by the viewer and its verdict is shown
      // beside each candidate — and nothing filters on it, so a reviewer is
      // offered every line the classifier has already named as a grid line, a
      // fill or a symbol.
      const classed = classifySingleLines({
        unclaimed,
        faces: allFaces,
        segments: segments.map((one) => ({
          ...one,
          x1: one.x1 / size.widthPt,
          y1: one.y1 / size.widthPt,
          x2: one.x2 / size.widthPt,
          y2: one.y2 / size.widthPt,
        })),
        walls: detected,
        feetPerUnit: sheetFeetPerUnit,
      });
      const byKind = new Map<string, { n: number; feet: number }>();
      for (const one of classed) {
        const at = byKind.get(one.kind) ?? { n: 0, feet: 0 };
        at.n += 1;
        at.feet += one.lengthFeet;
        byKind.set(one.kind, at);
      }
      console.log("\n   the unclaimed lines, as the classifier already sees them:");
      for (const [kind, at] of [...byKind].sort((a, b) => b[1].n - a[1].n)) {
        console.log(`     ${String(at.n).padStart(4)}  ${at.feet.toFixed(0).padStart(6)} ft  ${kind}`);
      }

      const offered = classed.filter((one) => worthOffering(one.kind));
      const setAside = classed.filter((one) => !worthOffering(one.kind));
      console.log(
        `\nCANDIDATES a reviewer would see: ${detected.length + offered.length}` +
          `  (${detected.length} orange detected runs + ${offered.length} blue possible walls)` +
          `\n   set aside, with a reason: ${setAside.length}`,
      );

      // ── HOW MUCH GEOMETRY EACH REGION HOLDS ──
      //
      // `viewRegions` already separates the title-block strip and the
      // dimension column from the drawing; a single caption then absorbs all
      // three, because a region with no caption joins the nearest one (the
      // S05/S07 scar). The question for a rule is whether the DRAWING's region
      // is distinguishable by how much is drawn in it.
      console.log("\n   strokes per region:");
      for (const region of regions) {
        const inside = segments.filter((one) => {
          const mx = (one.x1 + one.x2) / 2 / size.widthPt;
          const my = (one.y1 + one.y2) / 2 / size.widthPt;
          return mx >= region.from && mx < region.to && my >= region.fromY && my < region.toY;
        });
        const words = textItems.filter((t) => {
          const tx = t.x / size.widthPt;
          const ty = t.y / size.widthPt;
          return tx >= region.from && tx < region.to && ty >= region.fromY && ty < region.toY;
        });
        console.log(
          `     x=${region.from.toFixed(3)}..${region.to.toFixed(3)}  ` +
            `${String(inside.length).padStart(6)} strokes  ${String(words.length).padStart(4)} words  ` +
            `width ${(region.to - region.from).toFixed(3)}`,
        );
      }

      // ── THE STRIPED BOX AT THE LEFT EDGE ──
      //
      // An orange run sits on it, so the pairer called hatching a wall and
      // `drawnCoverage` kept it — which it should, if the hatch lines are
      // continuous rather than ticks. This asks what the family there looks
      // like, so the right rule is written rather than the nearest one.
      const boxFamily = segments
        .map((one) => ({
          ...one,
          x1: one.x1 / size.widthPt,
          y1: one.y1 / size.widthPt,
          x2: one.x2 / size.widthPt,
          y2: one.y2 / size.widthPt,
        }))
        .filter((one) => {
          const mx = (one.x1 + one.x2) / 2;
          const my = (one.y1 + one.y2) / 2;
          if (mx < 0.08 || mx > 0.20 || my < 0.36 || my > 0.46) return false;
          const d = (Math.atan2(one.y2 - one.y1, one.x2 - one.x1) * 180) / Math.PI;
          const norm = ((d % 180) + 180) % 180;
          return norm > 20 && norm < 70;
        });
      const lens = boxFamily
        .map((one) => Math.hypot(one.x2 - one.x1, one.y2 - one.y1) * sheetFeetPerUnit)
        .sort((a, b) => a - b);
      console.log(
        `\n   the striped box: ${boxFamily.length} diagonal strokes at 20-70deg, ` +
          `lengths ${(lens[0] ?? 0).toFixed(1)}..${(lens.at(-1) ?? 0).toFixed(1)} ft, ` +
          `median ${(lens[Math.floor(lens.length / 2)] ?? 0).toFixed(1)} ft`,
      );
      // Their pitch, which is what makes a fill a fill.
      if (boxFamily.length > 1) {
        const a = boxFamily[0];
        const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
        const nx = -(a.y2 - a.y1) / len;
        const ny = (a.x2 - a.x1) / len;
        const offsets = boxFamily
          .map((b) => ((b.x1 + b.x2) / 2 - a.x1) * nx + ((b.y1 + b.y2) / 2 - a.y1) * ny)
          .sort((p1, p2) => p1 - p2);
        const gaps: number[] = [];
        for (let i = 0; i < offsets.length - 1; i += 1) {
          const g = offsets[i + 1] - offsets[i];
          if (g > 1e-9) gaps.push(g * sheetFeetPerUnit * 12);
        }
        gaps.sort((p1, p2) => p1 - p2);
        console.log(
          `     pitch inches: min ${(gaps[0] ?? 0).toFixed(2)} ` +
            `median ${(gaps[Math.floor(gaps.length / 2)] ?? 0).toFixed(2)} ` +
            `max ${(gaps.at(-1) ?? 0).toFixed(2)}`,
        );
      }

      // ── WHERE THE UNCLAIMED LINES COME FROM, AND WHAT THEY ARE ──
      //
      // The viewer builds candidates from the page's RAW segments, so they
      // skip every filter detection applies: the layer names, the set's own
      // template (frame, title block, logo) and the column-grid removal. This
      // measures what that costs and classifies what is left, so a rule is
      // written against what is actually on the sheet.
      const filtered: StrokeSegment[] = (picked.primary?.found.inUnits ?? []) as StrokeSegment[];
      const facesFiltered: StrokeSegment[] = oneFacePerLine(
        filtered.map((one) => ({
          ...one,
          x1: one.x1 * size.widthPt,
          y1: one.y1 * size.widthPt,
          x2: one.x2 * size.widthPt,
          y2: one.y2 * size.widthPt,
        })),
        sheetFeetPerUnit / size.widthPt,
      ).map(inPageWidthUnits(size.widthPt));
      const unclaimedFiltered = facesFiltered.filter(
        (f) =>
          Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * sheetFeetPerUnit >= 12 &&
          onAPlan(f.x1, f.y1, f.x2, f.y2) &&
          !coveredByWall(f) &&
          !facesFiltered.some(
            (other) => other !== f && wallFromPair(f, other, pairOpts) !== null,
          ),
      );
      console.log(
        `\n   unclaimed from RAW segments:      ${unclaimed.length}` +
          `\n   unclaimed from FILTERED strokes:  ${unclaimedFiltered.length}` +
          `   (layers, template and grid removed)`,
      );

      // ── WHERE THEY SIT, AGAINST THE BUILDING THE WALLS DESCRIBE ──
      const wallsBox = detected.reduce(
        (box, w) => ({
          x1: Math.min(box.x1, w.x1, w.x2),
          y1: Math.min(box.y1, w.y1, w.y2),
          x2: Math.max(box.x2, w.x1, w.x2),
          y2: Math.max(box.y2, w.y1, w.y2),
        }),
        { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity },
      );
      console.log(
        `   the walls' own box: x ${wallsBox.x1.toFixed(3)}..${wallsBox.x2.toFixed(3)} ` +
          `y ${wallsBox.y1.toFixed(3)}..${wallsBox.y2.toFixed(3)}`,
      );
      const outside = unclaimed.filter((f) => {
        const mx = (f.x1 + f.x2) / 2;
        const my = (f.y1 + f.y2) / 2;
        return mx < wallsBox.x1 || mx > wallsBox.x2 || my < wallsBox.y1 || my > wallsBox.y2;
      });
      const sticksOut = unclaimed.filter((f) => {
        const lo = Math.min(f.x1, f.x2);
        const hi = Math.max(f.x1, f.x2);
        const loY = Math.min(f.y1, f.y2);
        const hiY = Math.max(f.y1, f.y2);
        const pad = 0.02;
        return (
          lo < wallsBox.x1 - pad ||
          hi > wallsBox.x2 + pad ||
          loY < wallsBox.y1 - pad ||
          hiY > wallsBox.y2 + pad
        );
      });
      console.log(
        `   of the ${unclaimed.length} raw unclaimed: ${outside.length} sit entirely outside the walls' box, ` +
          `${sticksOut.length} extend past it`,
      );

      // ── THE ANGLE FAMILIES, which is what an X pattern is ──
      const angleOf2 = (f: { x1: number; y1: number; x2: number; y2: number }) => {
        const a = (Math.atan2(f.y2 - f.y1, f.x2 - f.x1) * 180) / Math.PI;
        return ((a % 180) + 180) % 180;
      };
      const families = new Map<number, number>();
      for (const f of unclaimed) {
        const bucket = Math.round(angleOf2(f) / 5) * 5;
        families.set(bucket, (families.get(bucket) ?? 0) + 1);
      }
      console.log("   by angle (5-degree buckets, counts over 2):");
      for (const [deg2, n] of [...families].sort((a, b) => b[1] - a[1])) {
        if (n <= 2) continue;
        console.log(`     ${String(deg2).padStart(3)}deg  ${n}`);
      }

      // ── THE DIAGONALS IN THE RIGHT HALF: what are they near? ──
      const rightDiagonals = unclaimed.filter((f) => {
        const d = angleOf2(f);
        const mx = (f.x1 + f.x2) / 2;
        return mx > 0.5 && !(d < 10 || d > 170) && Math.abs(d - 90) > 10;
      });
      console.log(`\n   diagonal unclaimed lines right of centre: ${rightDiagonals.length}`);
      for (const f of rightDiagonals.slice(0, 6)) {
        const mx = (f.x1 + f.x2) / 2;
        const my = (f.y1 + f.y2) / 2;
        const near = textItems
          .map((t) => ({
            str: t.str.trim(),
            d: Math.hypot(t.x / size.widthPt - mx, t.y / size.widthPt - my),
          }))
          .filter((t) => t.str.length > 2)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
          .map((t) => `"${t.str}"`)
          .join(", ");
        console.log(
          `     ${(Math.hypot(f.x2 - f.x1, f.y2 - f.y1) * sheetFeetPerUnit).toFixed(0).padStart(4)} ft ` +
            `${angleOf2(f).toFixed(0).padStart(4)}deg at ${mx.toFixed(2)},${my.toFixed(2)}  near: ${near}`,
        );
      }

      // ── AND THE ORANGE RUN ON THE STRIPED BOX AT THE LEFT EDGE ──
      const leftRuns = detected
        .filter((w) => (w.x1 + w.x2) / 2 < 0.2)
        .sort((a, b) => a.lengthFeet - b.lengthFeet);
      console.log(`\n   detected runs left of x=0.2: ${leftRuns.length}`);
      for (const w of leftRuns.slice(0, 6)) {
        const mx = (w.x1 + w.x2) / 2;
        const my = (w.y1 + w.y2) / 2;
        const near = textItems
          .map((t) => ({
            str: t.str.trim(),
            d: Math.hypot(t.x / size.widthPt - mx, t.y / size.widthPt - my),
          }))
          .filter((t) => t.str.length > 2)
          .sort((a, b) => a.d - b.d)
          .slice(0, 3)
          .map((t) => `"${t.str}"`)
          .join(", ");
        console.log(
          `     ${w.lengthFeet.toFixed(0).padStart(4)} ft ${(w.thicknessFeet * 12).toFixed(1).padStart(5)} in ` +
            `${angleOf2(w).toFixed(0).padStart(4)}deg at ${mx.toFixed(2)},${my.toFixed(2)}  near: ${near}`,
        );
      }

      // ── ARE A RUN'S SUPPORTING STROKES AS LONG AS THE RUN? ──
      //
      // The striped box at A102's left edge is 352 diagonal strokes a median
      // 1.2 INCHES long at a 0.57in pitch, and the pairer returns walls on it.
      // `drawnCoverage` keeps them, correctly: a DENSE fill does cover the run
      // it sits under, so "how much ink lies along this" reads high. The
      // question that might separate them is the other one — how LONG the ink
      // is. A wall face is drawn in feet; a hatch tick in inches.
      //
      // Measured over every run on the sheet, so a real wall is in the same
      // sample. An exploded-linetype export draws a real face as many short
      // COLLINEAR pieces, which is why the pieces are measured after
      // `oneFacePerLine` has joined what is collinear: that is the whole
      // difference between a dashed wall and a fill.
      const runSupport = (wall: WallCandidate) => {
        const len = Math.hypot(wall.x2 - wall.x1, wall.y2 - wall.y1);
        if (!(len > 0)) return null;
        const dir = Math.atan2(wall.y2 - wall.y1, wall.x2 - wall.x1);
        const nx = -(wall.y2 - wall.y1) / len;
        const ny = (wall.x2 - wall.x1) / len;
        const ux = (wall.x2 - wall.x1) / len;
        const uy = (wall.y2 - wall.y1) / len;
        const band = (wall.thicknessFeet / sheetFeetPerUnit / 2) * 2;
        const near: number[] = [];
        for (const f of allFaces) {
          const fl = Math.hypot(f.x2 - f.x1, f.y2 - f.y1);
          if (!(fl > 0)) continue;
          const fd = Math.atan2(f.y2 - f.y1, f.x2 - f.x1);
          const gap = Math.abs(((fd - dir + Math.PI / 2) % Math.PI) - Math.PI / 2);
          if (gap > 0.05) continue;
          const mx = (f.x1 + f.x2) / 2 - wall.x1;
          const my = (f.y1 + f.y2) / 2 - wall.y1;
          if (Math.abs(mx * nx + my * ny) > band) continue;
          const along = mx * ux + my * uy;
          if (along < -len * 0.1 || along > len * 1.1) continue;
          near.push(fl / len);
        }
        if (near.length === 0) return null;
        near.sort((a, b) => a - b);
        return { n: near.length, median: near[Math.floor(near.length / 2)] };
      };
      const supportRows = detected
        .map((w) => ({ w, s: runSupport(w) }))
        .filter((r) => r.s !== null)
        .sort((a, b) => (a.s!.median ?? 0) - (b.s!.median ?? 0));
      console.log("\n   runs by how long their supporting faces are, shortest first");
      console.log("        ft     in    deg   faces  median face / run");
      for (const row of supportRows.slice(0, 12)) {
        const d = (Math.atan2(row.w.y2 - row.w.y1, row.w.x2 - row.w.x1) * 180) / Math.PI;
        console.log(
          `  ${row.w.lengthFeet.toFixed(1).padStart(8)} ${(row.w.thicknessFeet * 12).toFixed(1).padStart(6)} ` +
            `${(((d % 180) + 180) % 180).toFixed(0).padStart(6)} ${String(row.s!.n).padStart(7)} ` +
            `${row.s!.median.toFixed(2).padStart(10)}   at ${((row.w.x1 + row.w.x2) / 2).toFixed(2)},${((row.w.y1 + row.w.y2) / 2).toFixed(2)}`,
        );
      }
      const meds = supportRows.map((r) => r.s!.median).sort((a, b) => a - b);
      console.log(
        `   median face/run over ${meds.length} runs: ` +
          `min ${meds[0].toFixed(2)}  p25 ${meds[Math.floor(meds.length / 4)].toFixed(2)}  ` +
          `median ${meds[Math.floor(meds.length / 2)].toFixed(2)}  max ${meds.at(-1)!.toFixed(2)}`,
      );

      // ── AND A PICTURE OF THEM, IN THE PANEL'S OWN COLOURS ──
      //
      // Written to REAL_PLAN_OUT, outside the repository, because these are a
      // client's drawings. The colours are `AnswerKeyPanel`'s exports and not
      // a second palette: amber is an unreviewed PAIR and blue an unreviewed
      // single line, which is what a reviewer opens the sheet to.
      //
      // It exists to answer one question before an hour is spent — is this
      // sheet worth reviewing as it stands, or does detection need another
      // pass first — and a count cannot answer it.
      const out = process.env.REAL_PLAN_OUT ?? "";
      if (out !== "") {
        mkdirSync(out, { recursive: true });
        const w = size.widthPt;
        const h = size.heightPt;
        const line = (
          a: { x1: number; y1: number; x2: number; y2: number },
          scaleBy: number,
        ) =>
          `<line x1="${(a.x1 * scaleBy).toFixed(1)}" y1="${(a.y1 * scaleBy).toFixed(1)}" ` +
          `x2="${(a.x2 * scaleBy).toFixed(1)}" y2="${(a.y2 * scaleBy).toFixed(1)}"/>`;
        const sheetInk = segments.map((g) => line(g, 1)).join("");
        const pairs = detected.map((one) => line(one, w)).join("");
        const singles = offered.map((one) => line(one.line, w)).join("");
        const svg =
          `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" ` +
          `viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">\n` +
          `<rect width="100%" height="100%" fill="#fff"/>\n` +
          `<g stroke="#c9ced6" stroke-width="0.5" fill="none">${sheetInk}</g>\n` +
          `<g stroke="${SINGLE_LINE_COLOUR}" stroke-width="2" fill="none" stroke-opacity="0.9">${singles}</g>\n` +
          `<g stroke="${VERDICT_COLOURS.unreviewed}" stroke-width="3" fill="none">${pairs}</g>\n</svg>\n`;
        const name = `candidates-${fragment.replace(/[^A-Za-z0-9]+/g, "_")}-p${page}.svg`;
        writeFileSync(join(out, name), svg, "utf8");
        console.log(`   overlay written: ${name}`);
      }

      await pdf.close();
    },
    600_000,
  );
});
