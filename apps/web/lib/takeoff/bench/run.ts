import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { takeoffCurrency } from "../../takeoff-currency";
import { allSheets, buildKey, displayMap, primsForCase, sheetForVariant, variantsFor, VARIANTS, type CaseKey, type KeyWall, type Variant } from "./cases";
import {
  appSchedule,
  clusterRuns,
  diagnoseMiss,
  findWalls,
  gradeSchedules,
  gradeWalls,
  handCalcAppRules,
  handCalcEstimator,
  keyRuns,
  nearestRole,
  runScale,
  type FoundWalls,
  type GradedRun,
  type Quantities,
  type ScaleResult,
  type ScheduleGrade,
  type WallGrade,
} from "./harness";
import { HOLDOUT_SEEDS, holdoutPlan } from "./holdout";
import { PARTITION_TYPES, type TypeCode } from "./model";
import { runProbes, type Probe } from "./probes";
import { sheetBuilders, type Prim, type Sheet } from "./sheets";
import { writeDxf, writePdf, writeSvg } from "./writers";

/** Chromium is the second PDF producer and the overlay renderer is pdfjs + canvas. */
export type Printer = { pdfFromSvg: (svg: string, widthIn: number, heightIn: number) => Promise<Buffer>; close: () => Promise<void> };

export type ScaleOutcome = "CORRECT" | "WRONG_CONFIDENT" | "WRONG_PRINTED" | "UNDETERMINED" | "UNDETERMINED_MISLEADING" | "OFFERED_UNSAVABLE";

export type CaseResult = {
  key: CaseKey;
  set: "main" | "holdout";
  bytes: number;
  scale: { outcome: ScaleOutcome; named: string | null; source: string; reason: string | null; note: string };
  reader: { pathOperators: number; segments: number; textItems: number; hasTextLayer: boolean };
  walls: {
    counted: number;
    found: number;
    partial: number;
    missed: number;
    missedOver10: string[];
    keyClLf: number;
    keyFaceLf: number;
    trueLf: number;
    coveredLf: number;
    perType: Record<string, { keyCl: number; keyFace: number; found: number }>;
    phantom: { count: number; lf: number; traps: Record<string, number> };
    mustNotCount: { count: number; lf: number; why: Record<string, number> };
    outOfScope: { count: number; lf: number };
    duplicate: { count: number; lf: number };
    doubleCountLf: number;
    arc: { keyFt: number; foundFt: number } | null;
    diagnoses: Record<string, { walls: number; lf: number }>;
    clusters: { inches: number; feet: number; runs: number }[];
  };
  e2e: { factor: number; lf: number; keyLf: number } | null;
  materials: null | {
    handApp: Record<string, Quantities>;
    app: Record<string, Quantities>;
    estimator: Record<string, Quantities>;
    foundPath: Record<string, Quantities>;
    notes: string[];
  };
  schedules: ScheduleGrade | null;
  wallRows: string[];
  findings: string[];
  badness: number;
  overlay: { graded: GradedRun[]; walls: WallGrade[] };
};

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

function gradeScale(key: CaseKey, s: ScaleResult): CaseResult["scale"] {
  const named = s.calibration ? s.readsAs ?? s.row.scaleName : null;
  const source = s.row.source;
  const reason = s.row.declineReason ?? s.saveRefusal;
  if (s.calibration && s.saveRefusal) {
    return { outcome: "OFFERED_UNSAVABLE", named: s.row.scaleName, source, reason: s.saveRefusal, note: "offered a scale whose line the app then refuses to save" };
  }
  if (!s.calibration) {
    const r = (reason ?? "").toLowerCase();
    let misleading = false;
    if (key.expectedRefusal?.startsWith("lettering") && r.includes("scan")) misleading = true;
    if (key.expectedRefusal?.startsWith("a scan") && !r.includes("scan")) misleading = true;
    if (key.variant.startsWith("half") && r.includes("no printed dimensions")) misleading = true;
    return { outcome: misleading ? "UNDETERMINED_MISLEADING" : "UNDETERMINED", named: null, source, reason, note: misleading ? `says: "${reason}"` : "declined" };
  }
  const expected = key.scales.map((x) => x.scaleName);
  const allMatch = key.scales.length > 0 && expected.every((e) => e === named);
  if (key.scaleBehaviour === "name-it" && allMatch) return { outcome: "CORRECT", named, source, reason: null, note: source === "PRINTED" ? "from the title block (unverified)" : "from printed dimensions" };
  const wrongFor = key.scales.filter((x) => x.scaleName !== named).map((x) => `${x.view} is ${x.scaleName ?? "not a standard scale"}`);
  const why = wrongFor.length > 0 ? wrongFor.join("; ") : "this sheet has no single scale to name";
  return { outcome: source === "PRINTED" ? "WRONG_PRINTED" : "WRONG_CONFIDENT", named, source, reason: null, note: `named ${named} for the whole page — ${why}` };
}

/** Feet per page-width unit a zero-wall sheet is graded at: its own printed
 *  scale where it has one, 1/8" (the set's plan scale) otherwise. */
function nominalFpu(sheet: Sheet, key: CaseKey, v: Variant): number {
  const dm = displayMap(sheet, v);
  const factor = v.pdf?.(sheet).printAt?.scale ?? 1;
  const ptPerFt = sheet.id === "A-501" ? 216 : sheet.views[0]?.ptPerFt ?? 9;
  void key;
  return dm.widthPt / (ptPerFt * factor);
}

export async function runCase(sheet: Sheet, variant: Variant, printer: Printer | null, set: "main" | "holdout", outDir: string | null): Promise<CaseResult | { skipped: string; caseId: string }> {
  const prims: Prim[] = primsForCase(sheet, variant);
  const key = buildKey(sheet, variant);
  let bytes: Buffer;
  if (variant.producer === "skia") {
    if (!printer) return { skipped: "Chromium could not launch, so the Skia producer was NOT RUN", caseId: key.caseId };
    bytes = await printer.pdfFromSvg(writeSvg(sheet, prims), sheet.widthPt / 72, sheet.heightPt / 72);
  } else {
    bytes = writePdf(sheet, prims, { compress: true, ...(variant.pdf?.(sheet) ?? {}) });
  }
  if (outDir) {
    mkdirSync(join(outDir, "fixtures", "pdf"), { recursive: true });
    mkdirSync(join(outDir, "fixtures", "keys"), { recursive: true });
    writeFileSync(join(outDir, "fixtures", "pdf", `${key.caseId}.pdf`), bytes);
    writeFileSync(join(outDir, "fixtures", "keys", `${key.caseId}.json`), JSON.stringify(key, null, 1));
  }

  const scaleRes = await runScale(bytes);
  const scale = gradeScale(key, scaleRes);
  const dm = displayMap(sheet, variant);
  const roleAt = (u: { x: number; y: number }) => nearestRole(prims, dm.inv({ x: u.x * dm.widthPt, y: u.y * dm.widthPt }));

  // ── WALLS at the TRUE scale, per view ──
  const passes: { fpu: number; views: string[] | null; box: [number, number, number, number] | null }[] = [];
  const planViews = sheet.views.filter((v) => v.level);
  if (planViews.length > 0) {
    for (const v of planViews) {
      const k = key.walls.find((w) => w.view === v.name);
      const fpu = k?.trueFeetPerUnit ?? nominalFpu(sheet, key, variant);
      const c0 = dm.map({ x: v.origin.x + v.box[0] * v.ptPerFt, y: v.origin.y + v.box[1] * v.ptPerFt });
      const c1 = dm.map({ x: v.origin.x + v.box[2] * v.ptPerFt, y: v.origin.y + v.box[3] * v.ptPerFt });
      const box: [number, number, number, number] = [Math.min(c0.x, c1.x) / dm.widthPt, Math.min(c0.y, c1.y) / dm.widthPt, Math.max(c0.x, c1.x) / dm.widthPt, Math.max(c0.y, c1.y) / dm.widthPt];
      passes.push({ fpu, views: [v.name], box: planViews.length > 1 ? box : null });
    }
  } else {
    passes.push({ fpu: nominalFpu(sheet, key, variant), views: null, box: null });
  }
  const allBoxes = passes.map((p) => p.box).filter((b): b is [number, number, number, number] => b !== null);
  const inBox = (r: { x1: number; y1: number; x2: number; y2: number }, b: number[]) => {
    const mx = (r.x1 + r.x2) / 2;
    const my = (r.y1 + r.y2) / 2;
    return mx >= b[0] && mx <= b[2] && my >= b[1] && my <= b[3];
  };
  let graded: GradedRun[] = [];
  let wallGrades: WallGrade[] = [];
  let firstFound: FoundWalls | null = null;
  const diagnoses: Record<string, { walls: number; lf: number }> = {};
  const wallDiag = new Map<string, string>();
  for (const [i, pass] of passes.entries()) {
    const fw = await findWalls(bytes, pass.fpu);
    firstFound ??= fw;
    const runs = fw.walls.filter((r) => (pass.box ? inBox(r, pass.box) : true) || (i === 0 && allBoxes.length > 0 && !allBoxes.some((b) => inBox(r, b))));
    const g = gradeWalls(runs, key, prims, sheet, variant, pass.views ?? undefined);
    graded = graded.concat(g.graded);
    wallGrades = wallGrades.concat(g.walls);
    for (const w of g.walls) {
      if (!w.wall.count || w.status === "FOUND") continue;
      const why = diagnoseMiss(w.wall, fw.segs, { everywhere: fw.everywhere, inBuilding: fw.inBuilding, final: fw.walls }, roleAt);
      const bucket = why.replace(/ [\d.]+ ft parallel line [\d.]+" off centre/, " a parallel line").replace(/drawn [\d.]+ ft and [\d.]+ ft \([\d.]+x > 3x\)/, "drawn at unequal lengths").replace(/\d+ parallel lines/, "several parallel lines").replace(/came back [\d.]+" apart/, "came back too close");
      const d = (diagnoses[bucket] ??= { walls: 0, lf: 0 });
      d.walls += 1;
      d.lf += w.wall.clFt - w.coveredFt;
      wallDiag.set(`${w.wall.view}|${w.wall.id}`, why);
    }
  }
  const fw = firstFound!;

  const counted = wallGrades.filter((w) => w.wall.count && w.wall.inScope);
  const lfOf = (cls: GradedRun["cls"]) => sum(graded.filter((g) => g.cls === cls).map((g) => g.run.lengthFeet));
  const perType: CaseResult["walls"]["perType"] = {};
  for (const w of counted) {
    const t = (perType[w.wall.type] ??= { keyCl: 0, keyFace: 0, found: 0 });
    t.keyCl += w.wall.clFt;
    t.keyFace += w.wall.faceOverlapFt;
    t.found += w.reportedFt;
  }
  const traps: Record<string, number> = {};
  for (const g of graded.filter((x) => x.cls === "PHANTOM")) traps[g.trap ?? "?"] = (traps[g.trap ?? "?"] ?? 0) + g.run.lengthFeet;
  const why: Record<string, number> = {};
  for (const g of graded.filter((x) => x.cls === "MUST_NOT_COUNT")) why[g.trap ?? "?"] = (why[g.trap ?? "?"] ?? 0) + g.run.lengthFeet;
  const arcWall = counted.find((w) => w.wall.arc);

  // ── END TO END: at whatever scale the pipeline itself offered ──
  let e2e: CaseResult["e2e"] = null;
  const viewFactors: string[] = [];
  if (scaleRes.feetPerUnit && planViews.length > 1) {
    for (const p of passes) {
      const f = scaleRes.feetPerUnit / p.fpu;
      if (Math.abs(f - 1) > 0.01) viewFactors.push(`${p.views?.join(", ")} would be measured at the offered scale: every length ${f.toFixed(2)}x the truth`);
    }
  }
  if (scaleRes.feetPerUnit && planViews.length > 0) {
    const trueFpu = passes[0].fpu;
    const fwE = Math.abs(scaleRes.feetPerUnit / trueFpu - 1) < 1e-9 ? fw : await findWalls(bytes, scaleRes.feetPerUnit);
    const gE = gradeWalls(fwE.walls, key, prims, sheet, variant, passes[0].views ?? undefined);
    e2e = {
      factor: scaleRes.feetPerUnit / trueFpu,
      lf: sum(gE.graded.filter((g) => g.cls === "TRUE").map((g) => g.run.lengthFeet)),
      keyLf: sum(key.walls.filter((w) => w.count && w.inScope && (!passes[0].views || passes[0].views.includes(w.view))).map((w) => w.clFt)),
    };
  }

  // ── MATERIALS on the bid sheets ──
  let materials: CaseResult["materials"] = null;
  if (key.walls.some((w) => w.bid)) {
    const bidWalls = key.walls.filter((w) => w.bid);
    const cr = clusterRuns(fw.clusters, graded, bidWalls, passes[0].fpu);
    materials = {
      handApp: handCalcAppRules(bidWalls),
      app: appSchedule(keyRuns(bidWalls)),
      estimator: handCalcEstimator(bidWalls),
      foundPath: appSchedule(cr.runs),
      notes: cr.notes,
    };
  }

  const schedules = await gradeSchedules(bytes, key);

  const missedOver10 = counted.filter((w) => w.status === "MISSED" && w.wall.clFt > 10).map((w) => `${w.wall.id} (${w.wall.type}, ${w.wall.clFt.toFixed(1)} ft)`);
  const wallRows = wallGrades.map((w) =>
    [
      key.caseId,
      set,
      w.wall.view,
      w.wall.id,
      w.wall.type,
      w.wall.inScope,
      w.wall.count,
      w.wall.whyNot ?? "",
      w.wall.clFt.toFixed(2),
      w.wall.faceOverlapFt.toFixed(2),
      w.wall.netFt.toFixed(2),
      w.wall.heightFt,
      w.runs,
      w.reportedFt.toFixed(2),
      w.coveredFt.toFixed(2),
      w.wall.clFt > 0 ? (((w.reportedFt - w.wall.clFt) / w.wall.clFt) * 100).toFixed(1) : "",
      w.wall.faceOverlapFt > 0 ? (((w.reportedFt - w.wall.faceOverlapFt) / w.wall.faceOverlapFt) * 100).toFixed(1) : "",
      w.doubleCountFt.toFixed(2),
      w.status,
      JSON.stringify(wallDiag.get(`${w.wall.view}|${w.wall.id}`) ?? ""),
    ].join(","),
  );

  const result: CaseResult = {
    key,
    set,
    bytes: bytes.length,
    scale,
    reader: { pathOperators: fw.pathOperators, segments: fw.segments, textItems: fw.textBoxes, hasTextLayer: scaleRes.text.hasTextLayer },
    walls: {
      counted: counted.length,
      found: counted.filter((w) => w.status === "FOUND").length,
      partial: counted.filter((w) => w.status === "PARTIAL").length,
      missed: counted.filter((w) => w.status === "MISSED").length,
      missedOver10,
      keyClLf: sum(counted.map((w) => w.wall.clFt)),
      keyFaceLf: sum(counted.map((w) => w.wall.faceOverlapFt)),
      trueLf: lfOf("TRUE"),
      coveredLf: sum(counted.map((w) => w.coveredFt)),
      perType,
      phantom: { count: graded.filter((g) => g.cls === "PHANTOM").length, lf: lfOf("PHANTOM"), traps },
      mustNotCount: { count: graded.filter((g) => g.cls === "MUST_NOT_COUNT").length, lf: lfOf("MUST_NOT_COUNT"), why },
      outOfScope: { count: graded.filter((g) => g.cls === "OUT_OF_SCOPE").length, lf: lfOf("OUT_OF_SCOPE") },
      duplicate: { count: graded.filter((g) => g.cls === "DUPLICATE").length, lf: lfOf("DUPLICATE") },
      doubleCountLf: sum(counted.map((w) => w.doubleCountFt)),
      arc: arcWall ? { keyFt: arcWall.wall.clFt, foundFt: arcWall.reportedFt } : null,
      diagnoses,
      clusters: fw.clusters.map((c) => ({ inches: c.inches, feet: c.feet, runs: c.runs.length })),
    },
    e2e,
    materials,
    schedules,
    wallRows,
    findings: [],
    badness: 0,
    overlay: { graded, walls: wallGrades },
  };
  result.findings = findingsFor(result);
  for (const v of viewFactors) result.findings.unshift(`SCALE ZONE: ${v} — the page carries more than one scale and the offer names one, with no zone warning`);
  if (scale.outcome === "CORRECT" && scaleRes.row.source === "PRINTED" && sheet.views.some((v) => v.level) && variant.id !== "shx") {
    result.findings.push(`scale right only by the title-block fallback: the ${scaleRes.row.consideredCount} printed dimensions did not pair with their lines (${firstFound?.segments ?? 0} segments read)`);
  }
  if (result.walls.counted > 0 && key.walls.some((w) => w.bid)) {
    const bidCounted = key.walls.filter((w) => w.count && w.inScope && w.bid);
    const gross = sum(bidCounted.map((w) => w.clFt));
    const net = sum(bidCounted.map((w) => w.netFt));
    const header = sum(bidCounted.flatMap((w) => w.openings.map((o) => o.widthFt * Math.max(0, w.heightFt - o.heightFt) * (PARTITION_TYPES[w.type].layers[0] + PARTITION_TYPES[w.type].layers[1]))));
    result.findings.push(`openings: key gross ${gross.toFixed(0)} ft, net of openings ${net.toFixed(0)} ft; found runs stop at jambs, so found LF is NET — and LF × height then drops ${header.toFixed(0)} SF of board above doors and above/below windows`);
  }
  result.badness = badness(result);
  return result;
}

function findingsFor(r: CaseResult): string[] {
  const f: string[] = [];
  const k = r.key;
  if (r.scale.outcome === "WRONG_CONFIDENT" || r.scale.outcome === "WRONG_PRINTED") {
    f.push(`SCALE ${r.scale.outcome}: ${r.scale.note}. Code path: ${r.scale.source === "PRINTED" ? "pageInventory → scaleFromPrinted (standardSheetSize treats the reduced page as full size)" : "readSheetScale/scaleFromDimensions picks one scale per PAGE"}`);
  }
  if (r.scale.outcome === "UNDETERMINED_MISLEADING") f.push(`SCALE declined with the wrong reason — ${r.scale.note}`);
  if (r.scale.outcome === "OFFERED_UNSAVABLE") f.push(`SCALE offered and then refused on save: ${r.scale.reason}`);
  if (r.reader.pathOperators === 0 && k.variant === "scan") f.push("No vector strokes: wall finder returns nothing; the viewer's message would be \"No walls found… a fact about the drawing\" — true of the file, misleading about the building");
  if (!k.expectWalls && r.walls.phantom.lf + r.walls.duplicate.lf > 0) {
    const top = Object.entries(r.walls.phantom.traps).sort((a, b) => b[1] - a[1]).slice(0, 3);
    f.push(`ZERO-WALL SHEET produced ${(r.walls.phantom.lf + r.walls.duplicate.lf).toFixed(0)} ft (${r.walls.phantom.count + r.walls.duplicate.count} runs)${top.length ? ` — on ${top.map(([t, lf]) => `${t}: ${lf.toFixed(0)} ft`).join("; ")}` : ""}${r.walls.duplicate.lf > 0 ? `; ${r.walls.duplicate.lf.toFixed(0)} ft are walls repeated from the floor plan` : ""}`);
  }
  if (k.expectWalls && r.walls.phantom.lf > 0) {
    const top = Object.entries(r.walls.phantom.traps).sort((a, b) => b[1] - a[1]).slice(0, 3);
    f.push(`${r.walls.phantom.count} phantom runs, ${r.walls.phantom.lf.toFixed(0)} ft — ${top.map(([t, lf]) => `${t}: ${lf.toFixed(0)} ft`).join("; ")}`);
  }
  if (r.walls.mustNotCount.lf > 0) f.push(`${r.walls.mustNotCount.lf.toFixed(0)} ft counted that must not be: ${Object.entries(r.walls.mustNotCount.why).map(([w, lf]) => `${w} (${lf.toFixed(0)} ft)`).join("; ")}`);
  if (r.walls.counted > 0) {
    const pct = ((r.walls.trueLf - r.walls.keyClLf) / r.walls.keyClLf) * 100;
    f.push(`in-scope LF ${r.walls.trueLf.toFixed(0)} of ${r.walls.keyClLf.toFixed(0)} (centreline) = ${pct.toFixed(1)}%; ${r.walls.missed} walls missed outright, ${r.walls.partial} partial`);
    const top = Object.entries(r.walls.diagnoses).sort((a, b) => b[1].lf - a[1].lf).slice(0, 4);
    for (const [why, d] of top) f.push(`  ${d.lf.toFixed(0)} ft lost over ${d.walls} walls — ${why}`);
  }
  if (r.walls.doubleCountLf > 1) f.push(`${r.walls.doubleCountLf.toFixed(0)} ft counted twice on the same wall (overlapping runs)`);
  if (r.walls.arc) f.push(`curved wall: ${r.walls.arc.foundFt.toFixed(1)} of ${r.walls.arc.keyFt.toFixed(1)} ft`);
  if (r.e2e && Math.abs(r.e2e.factor - 1) > 0.01) f.push(`END TO END the offered scale is ${r.e2e.factor.toFixed(3)}x the truth: ${r.e2e.lf.toFixed(0)} ft reported against ${r.e2e.keyLf.toFixed(0)} ft`);
  return f;
}

function badness(r: CaseResult): number {
  let b = 0;
  if (r.scale.outcome === "WRONG_CONFIDENT" || r.scale.outcome === "WRONG_PRINTED") b += 100000;
  if (r.scale.outcome === "UNDETERMINED_MISLEADING" || r.scale.outcome === "OFFERED_UNSAVABLE") b += 50;
  if (!r.key.expectWalls) b += r.walls.phantom.lf + r.walls.duplicate.lf;
  b += r.walls.mustNotCount.lf;
  if (r.walls.counted > 0) b += Math.abs((r.walls.trueLf - r.walls.keyClLf) / r.walls.keyClLf) * 500;
  b += r.walls.missedOver10.length * 10;
  return b;
}

// ── THE MAIN SET ──────────────────────────────────────────────────────────────

export type BenchRun = { main: CaseResult[]; holdout: CaseResult[]; skipped: { caseId: string; skipped: string }[]; probes: Probe[]; currency: string[]; addendum: string[] };

export async function runBench(outDir: string, printer: Printer | null, log: (s: string) => void): Promise<BenchRun> {
  const sheets = allSheets();
  const main: CaseResult[] = [];
  const skipped: BenchRun["skipped"] = [];
  for (const base of sheets) {
    for (const vid of variantsFor(base.id)) {
      const v = VARIANTS.find((x) => x.id === vid)!;
      const sheet = sheetForVariant(base.id, vid, sheets);
      const t0 = Date.now();
      const r = await runCase(sheet, v, printer, "main", outDir);
      if ("skipped" in r) {
        skipped.push(r);
        log(`SKIPPED ${r.caseId}: ${r.skipped}`);
        continue;
      }
      main.push(r);
      log(`${r.key.caseId.padEnd(34)} scale ${r.scale.outcome.padEnd(24)} walls ${r.walls.found}/${r.walls.counted} phantom ${r.walls.phantom.lf.toFixed(0)}ft  ${Date.now() - t0}ms`);
    }
    if (!base.id.includes("REV")) {
      mkdirSync(join(outDir, "fixtures", "dxf"), { recursive: true });
      writeFileSync(join(outDir, "fixtures", "dxf", `${base.id}.dxf`), writeDxf(base.prims));
    }
  }

  // ── ADDENDUM: what the key says changed, and what detection saw change ──
  const addendum: string[] = [];
  const base = main.find((r) => r.key.caseId === "A-101__clean");
  const rev = main.find((r) => r.key.caseId === "A-101-REV1__clean");
  if (base && rev) {
    const b = new Map(base.key.walls.filter((w) => w.bid).map((w) => [w.id, w]));
    const a = new Map(rev.key.walls.filter((w) => w.bid).map((w) => [w.id, w]));
    const removed = [...b.keys()].filter((id) => !a.has(id));
    const added = [...a.keys()].filter((id) => !b.has(id));
    const changed = [...a.keys()].filter((id) => b.has(id) && (Math.abs(a.get(id)!.clFt - b.get(id)!.clFt) > 0.01 || a.get(id)!.type !== b.get(id)!.type || JSON.stringify(a.get(id)!.display) !== JSON.stringify(b.get(id)!.display)));
    addendum.push(`Answer key: ${removed.length} removed (${removed.join(", ")}), ${added.length} added, ${changed.length} changed (${changed.join(", ")}).`);
    const types = new Set([...Object.keys(base.walls.perType), ...Object.keys(rev.walls.perType)]);
    for (const t of types) {
      const kb = base.walls.perType[t]?.keyCl ?? 0;
      const ka = rev.walls.perType[t]?.keyCl ?? 0;
      const fb = base.walls.perType[t]?.found ?? 0;
      const fa = rev.walls.perType[t]?.found ?? 0;
      if (Math.abs(ka - kb) > 0.01 || Math.abs(fa - fb) > 0.5) addendum.push(`${t}: key ${kb.toFixed(1)} → ${ka.toFixed(1)} ft (Δ ${(ka - kb).toFixed(1)}); detected ${fb.toFixed(1)} → ${fa.toFixed(1)} ft (Δ ${(fa - fb).toFixed(1)})`);
    }
  }

  // ── TAKEOFF CURRENCY ──
  const currency: string[] = [];
  const revision = [{ id: "r2", label: "Addendum 2", setName: "A-101 REV 1", issuedOn: "2026-09-14", description: "Corridor moved 4'-0\"; rooms 111/112 combined; S-165 A1 → B1" }];
  for (const [label, issued] of [
    ["sheet date entered (2026-08-04)", "2026-08-04"],
    ["no sheet date entered (the common case)", null],
  ] as [string, string | null][]) {
    const c = takeoffCurrency([{ id: "p", fileName: "A-101.pdf", revisionLabel: "Rev 1", sheetIssuedOn: issued, measurementCount: base?.walls.found ?? 0 }], revision, []);
    currency.push(`${label}: ${c.plans[0].state} — "${c.plans[0].sentence}"`);
  }

  const probes = await runProbes();

  // ── HOLDOUT ──
  const holdout: CaseResult[] = [];
  for (const seed of HOLDOUT_SEEDS) {
    const plan = holdoutPlan(seed);
    const v = VARIANTS.find((x) => x.id === plan.variant)!;
    const sheet = { ...sheetBuilders.floorPlanSheet(`H-${seed}`, plan.level, `HOLDOUT ${seed}`), id: `H-${seed}` };
    const r = await runCase(sheet, v, printer, "holdout", outDir);
    if ("skipped" in r) {
      skipped.push(r);
      continue;
    }
    holdout.push(r);
    log(`holdout ${r.key.caseId.padEnd(26)} scale ${r.scale.outcome.padEnd(24)} walls ${r.walls.found}/${r.walls.counted} LF ${r.walls.trueLf.toFixed(0)}/${r.walls.keyClLf.toFixed(0)}`);
  }

  return { main, holdout, skipped, probes, currency, addendum };
}

export function standardFontDir(): string {
  const req = createRequire(import.meta.url);
  return join(dirname(req.resolve("pdfjs-dist/package.json")), "standard_fonts") + "/";
}

export type { KeyWall, TypeCode };
export { PARTITION_TYPES };
