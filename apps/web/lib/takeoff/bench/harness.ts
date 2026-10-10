import { Buffer } from "node:buffer";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { pageInventoryWork, type ScaleReadingRow, type SheetTextRow } from "../../plan-ingest/pageInventory";
import { looksLikeTable, tableRowsFromPage, type TableRow } from "../../plan-ingest/scheduleTable";
import { calibrationNotices, calibrationRefusal, feetPerPageWidth, readScale, recipeInputsFromMeasurements, type StoredMeasurement } from "../../takeoff-plan";
import { scheduleLines, type WallRunInput, type WallTypeInput } from "../../wall-assemblies";
import { segmentsFromOpenPage } from "../sheetStrokes";
import { clusterByThickness, wallFromPair, wallsInTheBuilding, wallsNotLettering, wallsNotTheSheetBorder, type WallCandidate, type WallCluster } from "../wallVectors";
import { wallsFromBothEngines } from "../wallRuns";
import { displayMap, type CaseKey, type KeyWall, type Variant } from "./cases";
import { PARTITION_TYPES, type Pt, type TypeCode } from "./model";
import type { Prim, Sheet } from "./sheets";

/**
 * RUNS C-STREAM'S ACTUAL PIPELINE ON ONE PDF AND GRADES IT AGAINST THE KEY.
 *
 * Every product function is called, not re-implemented:
 *
 *   scale      `pageInventoryWork` — the real PAGE_INVENTORY stage — with its
 *              ports injected (bytes in, rows captured), so `readSheetScale`,
 *              `dimensionLabels`, the printed-scale fallback and the scan
 *              decline all run exactly as ingestion runs them. The proposed
 *              line then goes through `calibrationNotices`/`calibrationRefusal`,
 *              which is what `saveScaleCalibration` does when Accept is pressed.
 *   walls      `segmentsFromOpenPage` → `wallsFromBothEngines` → `wallsInTheBuilding`
 *              → `wallsNotLettering` → `wallsNotTheSheetBorder` → `clusterByThickness`, in page-width units,
 *              with the text boxes derived the way the viewer derives them.
 *   materials  `recipeInputsFromMeasurements` + `scheduleLines`, the path an
 *              accepted cluster takes through `postMeasuredWallRun`.
 *   schedules  `tableRowsFromPage` + `looksLikeTable` (the deterministic half;
 *              the model half needs a key and is not run here).
 *
 * ONE PART IS NECESSARILY A COPY, and it is a finding in itself: the wall
 * pipeline's ORCHESTRATION lives inside `TakeoffPlanViewer.tsx`'s `onFindWalls`
 * (a React component), so there is no exported function to call. `findWalls`
 * below mirrors those ~30 lines line for line; the functions it calls are the
 * product's own.
 */

const CTX = { planId: "bench", companyId: "bench", ingestJobId: "bench", jobId: "bench", startedByUserId: null };

export type ScaleResult = {
  row: ScaleReadingRow;
  text: SheetTextRow;
  /** The calibration the app would store if Accept were pressed. */
  calibration: { x1: number; y1: number; x2: number; y2: number; declaredDistanceFeet: number } | null;
  /** `calibrationRefusal` on that calibration — non-null means Accept fails. */
  saveRefusal: string | null;
  feetPerUnit: number | null;
  /** What `readScale` names the stored calibration. */
  readsAs: string | null;
};

export async function runScale(bytes: Buffer): Promise<ScaleResult> {
  let text: SheetTextRow | null = null;
  let row: ScaleReadingRow | null = null;
  const work = pageInventoryWork(CTX, {
    // A COPY: openPlanPdf detaches the buffer it is handed.
    readPlanBytes: async () => ({ ok: true, bytes: Buffer.from(bytes) }),
    openPdf: openPlanPdf,
    saveSheetText: async (r) => {
      text = r;
    },
    saveScaleReading: async (r) => {
      row = r;
    },
  });
  const done = await work({ id: "t", pageNumber: 1, stage: "PAGE_INVENTORY", attempts: 0 } as never);
  if (!done.ok || row === null || text === null) throw new Error(`PAGE_INVENTORY failed: ${JSON.stringify(done)}`);
  const r = row as ScaleReadingRow;
  const t = text as SheetTextRow;
  let calibration: ScaleResult["calibration"] = null;
  if (r.scaleName !== null && r.x1 !== null && r.y1 !== null && r.x2 !== null && r.y2 !== null && r.declaredDistanceFeet !== null) {
    calibration = { x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2, declaredDistanceFeet: r.declaredDistanceFeet };
  }
  const saveRefusal = calibration ? calibrationRefusal(calibrationNotices(calibration, t.widthPt, null, null)) : null;
  const feetPerUnit = calibration && saveRefusal === null ? feetPerPageWidth(calibration) : null;
  const readsAs = calibration ? (readScale(calibration, t.widthPt)?.name ?? null) : null;
  return { row: r, text: t, calibration, saveRefusal, feetPerUnit, readsAs };
}

export type FoundWalls = {
  pathOperators: number;
  segments: number;
  segs: { x1: number; y1: number; x2: number; y2: number }[];
  everywhere: WallCandidate[];
  inBuilding: WallCandidate[];
  walls: WallCandidate[];
  clusters: WallCluster[];
  textBoxes: number;
};

/** `TakeoffPlanViewer.onFindWalls`, line for line, against a PDF in memory. */
export async function findWalls(bytes: Buffer, feetPerUnit: number): Promise<FoundWalls> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // @ts-expect-error pdfjs ships no types for the worker build; imported for its side effect.
  await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise;
  try {
    const page = await doc.getPage(1);
    const unit = page.getViewport({ scale: 1 });
    const pageSize = { widthPt: unit.width, heightPt: unit.height };
    const { segments, pathOperators } = await segmentsFromOpenPage(page, pdfjs, 1);
    const viewport = page.getViewport({ scale: 1 });
    const content = (await page.getTextContent()) ?? { items: [] };
    const textBoxes = content.items.flatMap((raw: unknown) => {
      const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
      if (typeof item.str !== "string" || item.str.trim() === "" || !Array.isArray(item.transform)) return [];
      const m = pdfjs.Util.transform(viewport.transform, item.transform);
      const h = item.height ?? 0;
      return [{ x: m[4] / pageSize.widthPt, y: (m[5] - h) / pageSize.widthPt, width: (item.width ?? 0) / pageSize.widthPt, height: h / pageSize.widthPt }];
    });
    const inUnits = segments.map((s) => ({ x1: s.x1 / pageSize.widthPt, y1: s.y1 / pageSize.widthPt, x2: s.x2 / pageSize.widthPt, y2: s.y2 / pageSize.widthPt, width: s.width }));
    const aspect = pageSize.heightPt / pageSize.widthPt;
    const everywhere = wallsFromBothEngines(inUnits, 1, aspect, { feetPerPoint: feetPerUnit });
    const inBuilding = wallsInTheBuilding(everywhere, feetPerUnit);
    const walls = wallsNotTheSheetBorder(wallsNotLettering(inBuilding, textBoxes, feetPerUnit), 1, aspect);
    page.cleanup();
    return { pathOperators, segments: segments.length, segs: inUnits, everywhere, inBuilding, walls, clusters: clusterByThickness(walls), textBoxes: textBoxes.length };
  } finally {
    await doc.destroy();
  }
}

// ── GRADING ────────────────────────────────────────────────────────────────────

export type RunClass = "TRUE" | "OUT_OF_SCOPE" | "MUST_NOT_COUNT" | "DUPLICATE" | "PHANTOM";

export type GradedRun = {
  run: WallCandidate;
  cls: RunClass;
  wallId: string | null;
  wallType: TypeCode | null;
  /** For a phantom: what was drawn there. */
  trap: string | null;
  /** Projection onto the matched wall's axis, feet from its start. */
  span: [number, number] | null;
};

export type WallGrade = {
  wall: KeyWall;
  runs: number;
  /** Sum of the runs' own lengths, at the scale they were found at. */
  reportedFt: number;
  /** Union of the runs' projections — how much of the wall is covered. */
  coveredFt: number;
  doubleCountFt: number;
  status: "FOUND" | "PARTIAL" | "MISSED" | "NOT_COUNTED_AND_FOUND" | "NOT_COUNTED";
};

const ANGLE_TOL = Math.sin((3 * Math.PI) / 180);

function matchRun(run: WallCandidate, k: KeyWall): { dist: number; span: [number, number] } | null {
  const mid = { x: (run.x1 + run.x2) / 2, y: (run.y1 + run.y2) / 2 };
  const fpu = k.trueFeetPerUnit;
  const tolFt = Math.max(0.75 * (k.thicknessIn / 12), 0.5);
  if (k.arc) {
    const r = Math.hypot(mid.x - k.arc.cx, mid.y - k.arc.cy);
    const dist = Math.abs(r - k.arc.r) * fpu;
    if (dist > tolFt) return null;
    const ang = (p: Pt) => (Math.atan2(p.y - k.arc!.cy, p.x - k.arc!.cx) * 180) / Math.PI;
    const inRange = (a: number) => {
      for (const v of [a, a - 360, a + 360]) if (v >= k.arc!.a0 - 2 && v <= k.arc!.a1 + 2) return v;
      return null;
    };
    const a1 = inRange(ang({ x: run.x1, y: run.y1 }));
    const a2 = inRange(ang({ x: run.x2, y: run.y2 }));
    if (a1 === null || a2 === null) return null;
    const rFt = k.arc.r * fpu;
    const s = [(Math.min(a1, a2) - k.arc.a0) * (Math.PI / 180) * rFt, (Math.max(a1, a2) - k.arc.a0) * (Math.PI / 180) * rFt] as [number, number];
    return { dist, span: s };
  }
  const d = k.display!;
  const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
  const ux = (d.x2 - d.x1) / L;
  const uy = (d.y2 - d.y1) / L;
  const rl = Math.hypot(run.x2 - run.x1, run.y2 - run.y1);
  if (rl === 0) return null;
  const cross = Math.abs(ux * (run.y2 - run.y1) / rl - uy * (run.x2 - run.x1) / rl);
  if (cross > ANGLE_TOL) return null;
  const dist = Math.abs(-uy * (mid.x - d.x1) + ux * (mid.y - d.y1)) * fpu;
  if (dist > tolFt) return null;
  const s1 = ((run.x1 - d.x1) * ux + (run.y1 - d.y1) * uy) * fpu;
  const s2 = ((run.x2 - d.x1) * ux + (run.y2 - d.y1) * uy) * fpu;
  const lo = Math.max(0, Math.min(s1, s2));
  const hi = Math.min(L * fpu, Math.max(s1, s2));
  if (hi - lo < 0.25) return null;
  return { dist, span: [lo, hi] };
}

function union(spans: [number, number][]): number {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const s of sorted) {
    if (!cur || s[0] > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [s[0], s[1]];
    } else cur[1] = Math.max(cur[1], s[1]);
  }
  if (cur) total += cur[1] - cur[0];
  return total;
}

/** The role of the drawn primitive nearest a paper point — the trap a phantom sat on. */
export function nearestRole(prims: Prim[], at: Pt): string {
  let best = Infinity;
  let role = "nothing drawn";
  const segDist = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  };
  for (const p of prims) {
    if (p.k === "text") {
      const d = Math.hypot(p.at.x - at.x, p.at.y - at.y);
      if (d < best) [best, role] = [d, `${p.role} text "${p.s}"`];
      continue;
    }
    const pts = p.k === "bez" ? [p.start, ...p.segs.map((s) => s[2])] : p.closed ? [...p.pts, p.pts[0]] : p.pts;
    for (let i = 0; i < pts.length - 1; i += 1) {
      const d = segDist(at, pts[i], pts[i + 1]);
      if (d < best) [best, role] = [d, `${p.role} (${p.layer})`];
    }
  }
  return role;
}

export function gradeWalls(found: WallCandidate[], key: CaseKey, prims: Prim[], sheet: Sheet, variant: Variant, views?: string[]) {
  const keyWalls = key.walls.filter((w) => !views || views.includes(w.view));
  const dm = displayMap(sheet, variant);
  const graded: GradedRun[] = found.map((run) => {
    let best: { k: KeyWall; dist: number; span: [number, number] } | null = null;
    for (const k of keyWalls) {
      const m = matchRun(run, k);
      if (m && (!best || m.dist < best.dist)) best = { k, ...m };
    }
    if (!best) {
      const mid = dm.inv({ x: ((run.x1 + run.x2) / 2) * dm.widthPt, y: ((run.y1 + run.y2) / 2) * dm.widthPt });
      return { run, cls: "PHANTOM" as RunClass, wallId: null, wallType: null, trap: nearestRole(prims, mid), span: null };
    }
    const k = best.k;
    const cls: RunClass = !k.count ? (k.whyNot === "repeated from the floor plan" ? "DUPLICATE" : "MUST_NOT_COUNT") : k.inScope ? "TRUE" : "OUT_OF_SCOPE";
    return { run, cls, wallId: k.id, wallType: k.type, trap: k.whyNot, span: best.span };
  });

  const walls: WallGrade[] = keyWalls.map((k) => {
    const mine = graded.filter((g) => g.wallId === k.id && g.span);
    const spans = mine.map((g) => g.span!);
    const covered = union(spans);
    const projected = spans.reduce((s, [a, b]) => s + (b - a), 0);
    const reported = mine.reduce((s, g) => s + g.run.lengthFeet, 0);
    let status: WallGrade["status"];
    if (!k.count) status = mine.length > 0 ? "NOT_COUNTED_AND_FOUND" : "NOT_COUNTED";
    else if (covered === 0) status = "MISSED";
    else if (covered < 0.8 * k.clFt) status = "PARTIAL";
    else status = "FOUND";
    return { wall: k, runs: mine.length, reportedFt: reported, coveredFt: covered, doubleCountFt: Math.max(0, projected - covered), status };
  });
  return { graded, walls };
}

// ── WHY A WALL WAS MISSED ─────────────────────────────────────────────────────

type Seg = { x1: number; y1: number; x2: number; y2: number };

/**
 * Names the stage that dropped a wall, from the segments the READER returned
 * along it — not from what this bench drew, so a reader defect shows up here.
 *
 * It re-runs the product's own `wallFromPair` on the wall's two outermost face
 * pieces; when that passes, it looks for the third parallel line that the series
 * test (`inAHatchSeries`, 2.5x the spacing) would have seen, and says what was
 * drawn there. The verdict on whether the wall was FOUND always comes from the
 * product's output; this only explains a miss.
 */
export function diagnoseMiss(
  k: KeyWall,
  segments: Seg[],
  stages: { everywhere: WallCandidate[]; inBuilding: WallCandidate[]; final: WallCandidate[] },
  roleAt: (displayUnits: Pt) => string,
): string {
  if (k.arc) return "sheetStrokes skips curveTo: a curved wall has no straight faces to pair";
  const t = PARTITION_TYPES[k.type];
  const hit = (list: WallCandidate[]) => list.some((r) => matchRun(r, k) !== null);
  if (hit(stages.inBuilding) && !hit(stages.final)) return "wallsNotLettering: dropped as lettering (a run under 4 ft inside a text box)";
  if (hit(stages.everywhere) && !hit(stages.inBuilding)) return "wallsInTheBuilding: not in the biggest connected group (or that group had under 10 runs)";
  const d = k.display!;
  const fpu = k.trueFeetPerUnit;
  const L = Math.hypot(d.x2 - d.x1, d.y2 - d.y1);
  const ux = (d.x2 - d.x1) / L;
  const uy = (d.y2 - d.y1) / L;
  const half = t.thicknessIn / 24;
  // Reader segments parallel to the wall, overlapping it, within its body (+1").
  const near = segments
    .map((sg) => {
      const sl = Math.hypot(sg.x2 - sg.x1, sg.y2 - sg.y1);
      if (sl === 0) return null;
      if (Math.abs(ux * (sg.y2 - sg.y1) / sl - uy * (sg.x2 - sg.x1) / sl) > ANGLE_TOL) return null;
      const mx = (sg.x1 + sg.x2) / 2 - d.x1;
      const my = (sg.y1 + sg.y2) / 2 - d.y1;
      const off = (-uy * mx + ux * my) * fpu;
      const a1 = ((sg.x1 - d.x1) * ux + (sg.y1 - d.y1) * uy) * fpu;
      const a2 = ((sg.x2 - d.x1) * ux + (sg.y2 - d.y1) * uy) * fpu;
      if (Math.max(a1, a2) < 0 || Math.min(a1, a2) > L * fpu) return null;
      return { sg, off, lenFt: sl * fpu };
    })
    .filter((x): x is { sg: Seg; off: number; lenFt: number } => x !== null);
  const body = near.filter((x) => Math.abs(x.off) <= half + 1 / 12);
  if (body.length === 0) return "the reader returned no segment on this wall's faces — its geometry never reached wallsFromStrokes";
  const lo = Math.min(...body.map((x) => x.off));
  const hi = Math.max(...body.map((x) => x.off));
  const gap = (hi - lo) * 12;
  if (hi - lo < 0.2) return `only one face reached the reader, or the faces came back ${gap.toFixed(2)}" apart — under wallFromPair's 0.2 ft (2.4") thickness floor`;
  if (hi - lo > 1.5) return `faces read ${gap.toFixed(1)}" apart — over wallFromPair's 1.5 ft ceiling`;
  const faceA = body.filter((x) => Math.abs(x.off - lo) < 0.01).sort((a, b) => b.lenFt - a.lenFt);
  const faceB = body.filter((x) => Math.abs(x.off - hi) < 0.01).sort((a, b) => b.lenFt - a.lenFt);
  const longestA = faceA[0];
  const longestB = faceB[0];
  if (Math.max(longestA.lenFt, longestB.lenFt) < 2) return "every face piece is under the 2 ft minimum run (wallsFromStrokes' input floor)";
  const anyPair = faceA.some((a) => faceB.some((b) => wallFromPair(a.sg, b.sg, { feetPerPoint: fpu }) !== null));
  if (!anyPair) {
    const ratio = Math.max(longestA.lenFt, longestB.lenFt) / Math.min(longestA.lenFt, longestB.lenFt);
    if (ratio > 3) return `wallFromPair face-length ratio: its two faces are drawn ${longestA.lenFt.toFixed(1)} ft and ${longestB.lenFt.toFixed(1)} ft (${ratio.toFixed(1)}x > 3x) — one face broken at junctions/openings, the other continuous`;
    return "wallFromPair overlap test: no face piece on one side overlaps one on the other by 50% of the shorter";
  }
  if (t.planLines.length > 2) {
    return `wallsFromStrokes series test (inAHatchSeries): the type is drawn as ${t.planLines.length} parallel lines, so every pair of its faces has a third line continuing the spacing`;
  }
  // A valid pair exists. The series test looks for a third parallel line beyond
  // either face within 2.5x the spacing, among segments that survived the 2 ft
  // input floor, overlapping the face by half the shorter of the two.
  const step = hi - lo;
  const third = near
    .filter((x) => x.lenFt >= 2)
    .filter((x) => faceA.concat(faceB).some((f) => overlapFt(f.sg, x.sg, fpu) >= 0.5 * Math.min(f.lenFt, x.lenFt)))
    .filter((x) => (x.off > hi + 0.005 && x.off <= hi + 2.5 * step) || (x.off < lo - 0.005 && x.off >= lo - 2.5 * step))
    .sort((a, b) => Math.abs(a.off) - Math.abs(b.off))[0];
  if (third) {
    const what = roleAt({ x: (third.sg.x1 + third.sg.x2) / 2, y: (third.sg.y1 + third.sg.y2) / 2 });
    return `wallsFromStrokes series test (inAHatchSeries): a ${third.lenFt.toFixed(1)} ft parallel line ${(Math.abs(third.off) * 12).toFixed(1)}" off centre continues the face spacing — ${what}`;
  }
  if (faceA.length + faceB.length > 2) return "wallsFromStrokes one-face-one-use: the faces are broken into pieces (openings, T junctions, columns) and the long piece is spent on one partner, stranding the rest";
  return "wallsFromStrokes one-face-one-use: a neighbouring line claimed one of its faces first (longest first, first match wins)";
}

function overlapFt(a: Seg, b: Seg, fpu: number): number {
  const L = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  const ux = (a.x2 - a.x1) / L;
  const uy = (a.y2 - a.y1) / L;
  const p1 = (b.x1 - a.x1) * ux + (b.y1 - a.y1) * uy;
  const p2 = (b.x2 - a.x1) * ux + (b.y2 - a.y1) * uy;
  return Math.max(0, Math.min(L, Math.max(p1, p2)) - Math.max(0, Math.min(p1, p2))) * fpu;
}

// ── MATERIALS ─────────────────────────────────────────────────────────────────

export type Quantities = { lf: number; studs: number; trackLf: number; boardSf: number; insulationSf: number };

export const zeroQ = (): Quantities => ({ lf: 0, studs: 0, trackLf: 0, boardSf: 0, insulationSf: 0 });

const totalLayers = (t: TypeCode) => PARTITION_TYPES[t].layers[0] + PARTITION_TYPES[t].layers[1];

/** The app's assembly rules, written out by hand — NOT by calling the app. If
 *  this and `scheduleLines` disagree, one of them has a bug. */
export function handCalcAppRules(walls: KeyWall[]): Record<string, Quantities> {
  const out: Record<string, Quantities> = {};
  for (const w of walls) {
    if (!w.bid || !w.inScope) continue;
    const t = PARTITION_TYPES[w.type];
    const q = (out[w.type] ??= zeroQ());
    const spacing = t.studSpacingIn / 12;
    q.lf += w.clFt;
    q.studs += (Math.ceil(Number((w.clFt / spacing).toFixed(9))) + 1) * t.studRows;
    q.trackLf += 2 * w.clFt * t.studRows;
    q.boardSf += w.areaPerSideSf * totalLayers(w.type);
    if (t.insulation) q.insulationSf += w.areaPerSideSf;
  }
  return out;
}

/** How an estimator would count it by hand: every opening deducted from board,
 *  door widths out of the bottom track, two jamb studs each side of an opening. */
export function handCalcEstimator(walls: KeyWall[]): Record<string, Quantities> {
  const out: Record<string, Quantities> = {};
  for (const w of walls) {
    if (!w.bid || !w.inScope) continue;
    const t = PARTITION_TYPES[w.type];
    const q = (out[w.type] ??= zeroQ());
    const spacing = t.studSpacingIn / 12;
    const openArea = w.openings.reduce((s, o) => s + o.widthFt * o.heightFt, 0);
    const doorWidth = w.openings.filter((o) => o.kind !== "window" && o.kind !== "relite").reduce((s, o) => s + o.widthFt, 0);
    const face = Math.max(0, w.clFt * w.heightFt - openArea);
    q.lf += w.clFt;
    q.studs += (Math.ceil(Number((w.clFt / spacing).toFixed(9))) + 1 + 4 * w.openings.length) * t.studRows;
    q.trackLf += (2 * w.clFt - doorWidth) * t.studRows;
    q.boardSf += face * totalLayers(w.type);
    if (t.insulation) q.insulationSf += face;
  }
  return out;
}

/** The company's wall types as the app stores them, built from the legend. */
export function wallTypeInputs(): WallTypeInput[] {
  return (Object.keys(PARTITION_TYPES) as TypeCode[])
    .filter((c) => PARTITION_TYPES[c].inScope)
    .map((c) => {
      const t = PARTITION_TYPES[c];
      const comp = (id: string, basis: WallTypeInput["components"][number]["basis"], factor: number, roundUp: boolean) => ({
        id: `${c}:${id}`,
        description: id,
        unit: null,
        basis,
        factor,
        wastePercent: 0,
        roundUp,
        productionRate: null,
      });
      const components = [comp("studs", "STUDS", t.studRows, true), comp("track", "LINEAR_FT", 2 * t.studRows, false), comp("board", "FACE_SQFT", totalLayers(c), false)];
      if (t.insulation) components.push(comp("insulation", "FACE_SQFT", 1, false));
      return { id: c, code: c, defaultHeightFt: null, sides: t.layers[1] === 0 ? 1 : 2, studSpacingIn: t.studSpacingIn, components };
    });
}

/** `scheduleLines` over a set of runs, folded back into quantities per type. */
export function appSchedule(runs: WallRunInput[]): Record<string, Quantities> {
  const types = wallTypeInputs();
  const sched = scheduleLines(runs, types);
  const out: Record<string, Quantities> = {};
  for (const line of sched.lines) {
    const q = (out[line.wallTypeId] ??= zeroQ());
    const kind = line.componentId.split(":")[1];
    if (kind === "studs") q.studs += line.quantity;
    if (kind === "track") q.trackLf += line.quantity;
    if (kind === "board") q.boardSf += line.quantity;
    if (kind === "insulation") q.insulationSf += line.quantity;
  }
  for (const r of runs) (out[r.wallTypeId] ??= zeroQ()).lf += r.lengthFt;
  return out;
}

/** Key walls as the app's wall runs — one run per wall, as typed by hand. */
export function keyRuns(walls: KeyWall[]): WallRunInput[] {
  return walls
    .filter((w) => w.bid && w.inScope)
    .map((w) => ({
      id: w.id,
      label: w.id,
      wallTypeId: w.type,
      lengthFt: w.clFt,
      heightFt: w.heightFt,
      openings: w.openings.map((o) => ({ widthFt: o.widthFt, heightFt: o.heightFt })),
    }));
}

/**
 * The best-case estimator path from "Find the walls": accept every cluster,
 * give each the type that most of its footage really is and that type's most
 * common height, and post it — which `postMeasuredWallRun` does by summing the
 * cluster's runs into ONE wall run through `recipeInputsFromMeasurements`.
 * Openings are not typed (nothing on the found-walls path asks for them).
 */
export function clusterRuns(clusters: WallCluster[], graded: GradedRun[], keyWalls: KeyWall[], feetPerUnit: number): { runs: WallRunInput[]; notes: string[] } {
  const runs: WallRunInput[] = [];
  const notes: string[] = [];
  clusters.forEach((cluster, i) => {
    const byType = new Map<string, number>();
    for (const r of cluster.runs) {
      const g = graded.find((x) => x.run === r);
      const t = g && g.cls === "TRUE" && g.wallType ? g.wallType : "?";
      byType.set(t, (byType.get(t) ?? 0) + r.lengthFeet);
    }
    const ranked = [...byType.entries()].sort((a, b) => b[1] - a[1]);
    const type = ranked.find(([t]) => t !== "?")?.[0] as TypeCode | undefined;
    if (!type) {
      notes.push(`cluster ${i + 1} (${cluster.inches.toFixed(2)}", ${cluster.feet.toFixed(1)} ft): no true wall in it — an estimator rejects it`);
      return;
    }
    const heights = keyWalls.filter((w) => w.type === type && w.bid);
    const heightFt = mode(heights.map((w) => w.heightFt)) ?? 10;
    const stored: StoredMeasurement[] = cluster.runs.map((r) => ({
      kind: "LINEAR",
      xs: [r.x1, r.x2],
      ys: [r.y1, r.y2],
      label: null,
      // A calibration whose feetPerPageWidth is exactly feetPerUnit.
      calibration: { x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: feetPerUnit },
    }));
    const inputs = recipeInputsFromMeasurements("wall", stored, { heightFt, sides: 2, openings: [] });
    if (!inputs.ok) {
      notes.push(`cluster ${i + 1}: ${inputs.error}`);
      return;
    }
    const wall = inputs.inputs[0];
    if (wall.kind !== "wall") return;
    runs.push({ id: `cluster-${i + 1}`, label: `cluster ${i + 1}`, wallTypeId: type, lengthFt: wall.wall.lengthFt, heightFt, openings: [] });
    const mixed = ranked.filter(([t]) => t !== type);
    if (mixed.length > 0) notes.push(`cluster ${i + 1} posted as ${type} @ ${heightFt}' also holds ${mixed.map(([t, ft]) => `${ft.toFixed(1)} ft of ${t === "?" ? "non-walls" : t}`).join(", ")}`);
  });
  return { runs, notes };
}

function mode(xs: number[]): number | null {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// ── SCHEDULES ─────────────────────────────────────────────────────────────────

export type ScheduleGrade = {
  looksLikeTable: boolean;
  rowsFound: number;
  expected: number;
  exact: number;
  merged: number;
  missing: number;
  /** Rows whose blank cells were dropped, so the columns no longer line up. */
  shifted: number;
  /** Rows that are a wrapped half of a cell, not a schedule row. */
  orphanRows: number;
  examples: string[];
};

export async function gradeSchedules(bytes: Buffer, key: CaseKey): Promise<ScheduleGrade | null> {
  if (!key.schedules) return null;
  const doc = await openPlanPdf(Buffer.from(bytes));
  try {
    const page = await doc.pageText(1);
    const rows = tableRowsFromPage(page);
    const expectRows = [
      ...key.schedules.door.rows.map((r) => ({ cells: key.schedules!.door.columns.map((c) => r[c] ?? ""), mark: r.MARK })),
      ...key.schedules.window.rows.map((r) => ({ cells: key.schedules!.window.columns.map((c) => r[c] ?? ""), mark: r.MARK })),
    ];
    const g: ScheduleGrade = { looksLikeTable: looksLikeTable(rows), rowsFound: rows.length, expected: expectRows.length, exact: 0, merged: 0, missing: 0, shifted: 0, orphanRows: 0, examples: [] };
    const markRows = new Set<TableRow>();
    for (const e of expectRows) {
      const want = e.cells.filter((c) => c !== "").map((c) => c.replace(/\s+/g, " "));
      const row = rows.find((r) => r.cells.includes(e.mark) && (r.cells[0] === e.mark || r.cells.indexOf(e.mark) > 0));
      if (!row) {
        g.missing += 1;
        if (g.examples.length < 6) g.examples.push(`${e.mark}: no row`);
        continue;
      }
      markRows.add(row);
      const idx = row.cells.indexOf(e.mark);
      const mine = row.cells.slice(idx, idx + want.length);
      const exact = JSON.stringify(mine) === JSON.stringify(want) && e.cells.every((c) => c !== "");
      if (row.cells.length > want.length + 1) g.merged += 1;
      if (e.cells.some((c) => c === "")) g.shifted += 1;
      if (exact) g.exact += 1;
      else if (g.examples.length < 6) g.examples.push(`${e.mark}: [${row.cells.join(" | ")}]`);
    }
    g.orphanRows = rows.filter((r) => !markRows.has(r) && r.cells.length <= 2 && !r.cells.some((c) => /SCHEDULE|MARK/.test(c))).length;
    return g;
  } finally {
    await doc.close();
  }
}
