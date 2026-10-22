import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { heldOutReason } from "../heldOutSets";
import { keyFromLabels, scoreSheet, type ScoredRun } from "../heldOutScore";
import { detectForSheet, offeredCandidates, type SheetDetectResult } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { findWallsOnSheet } from "../findWallsOnSheet";
import { drawingRegions, segmentsInRegions } from "../planRegion";
import { drawingCount, isLevelPlan, keptPlanViews, mergeViewWalls, primaryView, sheetDrawings, sheetViews, textBlockBoxes, viewBoxes, viewRegions, viewsInRegions, wallsPerView, type SheetView } from "../sheetViews";
import { isPlanView } from "../viewKind";
import { viewClass } from "../viewTitles";

/**
 * ── DOES SPLITTING A SHEET INTO ITS DRAWINGS REMOVE JUNK WITHOUT LOSING WALL? ──
 *
 * The app's list is `detectForSheet` + `offeredCandidates`. The TREATMENT is
 * the same pipeline with `sheetDrawings` (titles ∪ captions) in place of
 * `sheetViews` (captions only) — composed here from the same exported pieces
 * `detectForSheet` uses, because wiring it in is one line in a file this
 * branch does not own.
 *
 * Scored with the repo's own `scoreSheet` against each sheet's key (accepted +
 * traced): JUNK REMOVED = the fall in EXTRA feet, REAL LOST = the rise in
 * MISSING feet. Leave-one-building-out over the title size ratio: each
 * building is scored at the ratio that did best on the OTHER buildings.
 *
 * TRAINING SHEETS ONLY. Crops of each detected view go to VIEW_SHOTS.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
const SHOTS = process.env.VIEW_SHOTS ?? "";
const RATIOS = [1.25, 1.4, 1.6, 1.8, 2.0];
/** A foot of real wall lost costs this many feet of junk removed. */
const LOST_WEIGHT = 5;

type Saved = {
  page: number;
  feetPerUnit: number;
  verdicts: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number; thicknessFeet?: number; verdict: string }[];
};

const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();

function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) {
    for (const name of readdirSync(root)) {
      if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
    }
  }
  return null;
}

describe.skipIf(DIR === "" || LABELS === "")("view detection on the app's candidate list", () => {
  it("measures junk removed against real wall lost, leave-one-building-out", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const here = join(LABELS, dir);
      if (!existsSync(here) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(here)) if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));

    type Row = {
      dir: string; sheet: string; key: ScoredRun[]; keyFeet: number;
      base: { extra: number; missing: number; n: number; views: number };
      /** The VIEWER's pipeline: captions placed by `viewsInRegions`, which `detectForSheet` omits. */
      app: { extra: number; missing: number; n: number };
      byRatio: Map<number, { extra: number; missing: number; n: number; views: SheetView[]; measured: string[] }>;
    };
    const rows: Row[] = [];

    for (const file of files) {
      const pdf = findPdf(file.dir);
      if (pdf === null) { console.log(`  no pdf for ${file.dir}`); continue; }
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const bytes = Buffer.from(readFileSync(pdf));
      const strokes = await sheetStrokes(bytes, saved.page);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const pageSize = { widthPt: strokes.widthPt, heightPt: strokes.heightPt };
      const { key } = keyFromLabels(saved);
      const base = { segments: strokes.segments, textItems, pageSize, feetPerUnit: saved.feetPerUnit };

      const offer = (d: SheetDetectResult) =>
        offeredCandidates({ walls: d.found.walls, segments: strokes.segments, widthPt: strokes.widthPt, feetPerUnit: saved.feetPerUnit, planBoxes: d.planBoxes });
      const score = (d: SheetDetectResult) => {
        const offered = offer(d);
        const proposed: ScoredRun[] = offered.candidates.map((w) => ({ x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, lengthFeet: w.lengthFeet, thicknessFeet: w.thicknessIn === null ? undefined : w.thicknessIn / 12 }));
        const s = scoreSheet({ set: file.dir, sheet: file.sheet, key, proposed, feetPerUnit: saved.feetPerUnit });
        return { extra: s.extraFeet, missing: s.missingFeet, n: offered.candidates.length, keyFeet: s.keyFeet };
      };

      const baseline = detectForSheet(base);
      const b = score(baseline);
      const composed = (views: SheetView[]): SheetDetectResult => {
        if (drawingCount(views) < 2) {
          // The single-drawing branch of `detectForSheet`, with the text
          // blocks' regions taken out of the drawing before it is measured.
          const blocks = textBlockBoxes(views);
          if (blocks.length === 0) return baseline;
          const regions = viewRegions(strokes.segments, pageSize).filter((r) => !blocks.some((b) => r.from >= b.from - 1e-9 && r.to <= b.to + 1e-9 && r.fromY >= b.fromY - 1e-9 && r.toY <= b.toY + 1e-9));
          const drawing = drawingRegions(regions, strokes.segments, pageSize.widthPt);
          const onTheDrawing = segmentsInRegions(strokes.segments, drawing, pageSize.widthPt);
          return { found: findWallsOnSheet({ ...base, segments: onTheDrawing, wallTypes: [], sampledSheets: null }), planBoxes: drawing.length > 0 ? [...drawing] : null, views: views.length, primaryName: null };
        }
        const measured = wallsPerView({ ...base, views, wallTypes: [], sampledSheets: null });
        const picked = primaryView(measured);
        // Every floor keeps its walls (`keptPlanViews`); the app today keeps
        // `picked.primary` alone. KEEP_PRIMARY_ONLY=1 reproduces the app.
        const kept = process.env.KEEP_PRIMARY_ONLY === "1" ? (picked.primary === null ? [] : [picked.primary]) : keptPlanViews(measured).kept;
        return {
          found: mergeViewWalls(kept) ?? { ...baseline.found, walls: [] },
          planBoxes: measured.flatMap((one) => viewBoxes(one.view)),
          views: views.length,
          primaryName: kept.map((k) => k.view.name).join(" + ") || null,
        };
      };
      const appViews = viewsInRegions(sheetViews(textItems, pageSize.widthPt), viewRegions(strokes.segments, pageSize));
      const appOnly = (views: SheetView[]): SheetDetectResult => {
        if (views.length < 2) return baseline;
        const measured = wallsPerView({ ...base, views, wallTypes: [], sampledSheets: null });
        const picked = primaryView(measured);
        return { found: picked.primary?.found ?? { ...baseline.found, walls: [] }, planBoxes: measured.flatMap((one) => viewBoxes(one.view)), views: views.length, primaryName: picked.primary?.view.name ?? null };
      };
      const a = score(appOnly(appViews));
      const byRatio = new Map<number, { extra: number; missing: number; n: number; views: SheetView[]; measured: string[] }>();
      for (const ratio of RATIOS) {
        const views = sheetDrawings({ items: textItems, segments: strokes.segments, pageSize, sizeRatio: ratio });
        const treated = composed(views);
        const measuredNames = drawingCount(views) < 2 ? [] : wallsPerView({ ...base, views, wallTypes: [], sampledSheets: null }).map((m) => m.view.name);
        const t = score(treated);
        byRatio.set(ratio, { ...t, views, measured: measuredNames });
      }
      rows.push({ dir: file.dir, sheet: file.sheet, key, keyFeet: b.keyFeet, base: { ...b, views: baseline.views }, app: a, byRatio });

      // ── CROPS, at the default ratio ──
      if (SHOTS !== "") {
        const views = byRatio.get(1.4)!.views;
        const out = join(SHOTS, `${flat(file.dir).slice(0, 24)}-${file.sheet}`);
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, "views.json"), JSON.stringify({
          pdf, page: saved.page, widthPt: pageSize.widthPt, heightPt: pageSize.heightPt,
          views: views.map((v) => ({ name: v.name, kind: viewClass(v.name).kind, foundBy: v.foundBy ?? "caption", scale: v.scaleName, measured: v.textBlock !== true && (isPlanView(v.name) || isLevelPlan(v.name)) && (v.boxes?.length ?? 1) > 0, boxes: viewBoxes(v) })),
        }));
      }
    }
    expect(rows.length, "no training sheet was read").toBeGreaterThan(0);

    // ── LEAVE ONE BUILDING OUT over the size ratio ──
    const buildings = [...new Set(rows.map((r) => r.dir))];
    const gain = (r: Row, ratio: number) => {
      const t = r.byRatio.get(ratio)!;
      return (r.base.extra - t.extra) - LOST_WEIGHT * Math.max(0, t.missing - r.base.missing);
    };
    let junkRemoved = 0, realLost = 0, realGained = 0, junkApp = 0, lostApp = 0, appJunkVsShip = 0, appLostVsShip = 0;
    console.log(`\n${rows.length} training sheets, ${buildings.length} buildings · ratios ${RATIOS.join("/")} · lost weight ${LOST_WEIGHT}\n`);
    console.log(`  ${"sheet".padEnd(34)} ${"key".padStart(6)} ${"ship/app/treat n".padStart(16)} ${"ratio".padStart(5)} ${"vs SHIP: junk−".padStart(14)} ${"lost".padStart(6)} ${"vs APP: junk−".padStart(13)} ${"lost".padStart(6)}  views (measured *, T=by title, B=text block)`);
    for (const b of buildings) {
      const others = rows.filter((r) => r.dir !== b);
      const pick = RATIOS.map((ratio) => ({ ratio, g: others.reduce((n, r) => n + gain(r, ratio), 0) })).sort((x, y) => y.g - x.g)[0].ratio;
      for (const r of rows.filter((r) => r.dir === b)) {
        const t = r.byRatio.get(pick)!;
        const junk = r.base.extra - t.extra;
        const lost = Math.max(0, t.missing - r.base.missing);
        const gained = Math.max(0, r.base.missing - t.missing);
        const junkA = r.app.extra - t.extra;
        const lostA = Math.max(0, t.missing - r.app.missing);
        junkRemoved += junk; realLost += lost; realGained += gained; junkApp += junkA; lostApp += lostA;
        appJunkVsShip += r.base.extra - r.app.extra; appLostVsShip += Math.max(0, r.app.missing - r.base.missing);
        const keptNames = (t as unknown as { kept?: string }).kept ?? "";
        void keptNames;
        const names = t.views.map((v) => `${isPlanView(v.name) && t.measured.includes(v.name) ? "*" : ""}${v.name.slice(0, 22)}[${viewClass(v.name).kind}${v.foundBy === "title" ? ",T" : ""}${v.textBlock ? ",B" : ""}]`).join(" ");
        console.log(`  ${`${r.dir.slice(0, 26)}/${r.sheet}`.padEnd(34)} ${r.keyFeet.toFixed(0).padStart(6)} ${`${r.base.n}/${r.app.n}/${t.n}`.padStart(16)} ${pick.toFixed(2).padStart(5)} ${junk.toFixed(0).padStart(14)} ${lost.toFixed(0).padStart(6)} ${junkA.toFixed(0).padStart(13)} ${lostA.toFixed(0).padStart(6)}  ${names.slice(0, 170)}`);
      }
    }
    console.log(`\n  THE APP vs AS-SHIPPED detectForSheet (no treatment): junk −${appJunkVsShip.toFixed(0)} ft · real lost ${appLostVsShip.toFixed(0)} ft — the viewer clips captioned views to regions and detectForSheet does not`);
    console.log(`  TREATMENT vs AS-SHIPPED: junk removed ${junkRemoved.toFixed(0)} ft · real lost ${realLost.toFixed(0)} ft · real gained ${realGained.toFixed(0)} ft`);
    console.log(`  TREATMENT vs THE APP:    junk removed ${junkApp.toFixed(0)} ft · real lost ${lostApp.toFixed(0)} ft   (extra ft that fell, missing ft that rose, by scoreSheet; LOBO ratio)`);
    console.log("\n  PER RATIO, ALL SHEETS (not LOBO):");
    for (const ratio of RATIOS) {
      const j = rows.reduce((n, r) => n + (r.base.extra - r.byRatio.get(ratio)!.extra), 0);
      const l = rows.reduce((n, r) => n + Math.max(0, r.byRatio.get(ratio)!.missing - r.base.missing), 0);
      const multi = rows.filter((r) => drawingCount(r.byRatio.get(ratio)!.views) >= 2).length;
      console.log(`    ratio ${ratio.toFixed(2)}: junk −${j.toFixed(0)} ft · real lost ${l.toFixed(0)} ft · ${multi} sheets split into 2+ drawings`);
    }
  });
});
