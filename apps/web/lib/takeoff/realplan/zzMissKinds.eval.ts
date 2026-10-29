import { Buffer } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openPlanPdf } from "../../plan-ingest/planPdf";
import { detectForSheet, offeredCandidates } from "../offeredCandidates";
import { sheetStrokes } from "../sheetStrokes";
import { heldOutReason } from "../heldOutSets";
import type { WallCandidate } from "../wallVectors";

/**
 * ── WHY THE FINDER MISSED EACH WALL A REVIEWER HAD TO TRACE ──
 *
 * Every training sheet now carries traces of the walls the finder did not
 * propose, which is the first time this question has been answerable: a trace
 * is a person saying "there is a wall here and you missed it", with
 * coordinates.
 *
 * The complement of the junk analysis. That one asked what the finder
 * proposes wrongly (extra); this asks what it fails to propose (missing). On
 * the held-out keys missing is 1,844 ft against 6,516 ft extra, so this is
 * the smaller number — but it is the one that costs a subcontractor money,
 * because a wall nobody counted is a wall nobody bid.
 *
 * ── THE STAGE IS ATTRIBUTED FROM THE FINDER'S OWN PASSES ──
 *
 * `onCandidate` is told about EVERY pairing, including the ones the greedy
 * pass discards, so "was a pairing ever made here" is answerable rather than
 * guessable. Then the returned stages — `everywhere`, `inBuilding`,
 * `notLettering`, `notBorder`, `walls` — say where it was lost, by the first
 * stage that no longer holds it.
 *
 * Compared by GEOMETRY, not identity: the stages return copies, which cost a
 * whole wrong answer in the junk analysis when `Set.has` matched nothing and
 * reported 100% of the footage as one kind.
 *
 * ── THE KINDS ARE HEURISTICS AND THE CROPS ARE WHERE THEY ARE CHECKED ──
 *
 * A trace records a wall, not why it was missed. Every kind below is inferred
 * from the strokes near it, the text near it, and which stage lost it.
 * "unattributed" staying large is the honest outcome, not something to
 * squeeze.
 *
 * TRAINING SHEETS ONLY: `heldOutReason` refuses the test buildings, because
 * reading what the finder misses on a held-out sheet and then writing a rule
 * for it is tuning on the test key.
 */
const DIR = process.env.REAL_PLAN_DIR ?? "";
const DIR2 = process.env.REAL_PLAN_DIR2 ?? "";
const LABELS = process.env.TAKEOFF_LABEL_DIR ?? "";
/** Where the per-trace rows go, for rendering crops of a bucket. */
const OUT = process.env.MISS_OUT ?? "";
/** Sheets to break out on their own lines, by a substring of the set name. */
const FOCUS = (process.env.MISS_FOCUS ?? "").split(",").filter((f) => f !== "");
/** Only these sheets (substring of the set name), for a fast rerun. */
const ONLY = (process.env.MISS_ONLY ?? "").split(",").filter((f) => f !== "");

type Saved = {
  set?: string;
  page: number;
  feetPerUnit: number;
  verdicts: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    lengthFeet: number;
    thicknessFeet?: number;
    verdict: string;
  }[];
};

/**
 * ── THE STAGES, IN THE ORDER THE FINDER RUNS THEM ──
 *
 * This list used to test `inBuilding` before `notLettering`, which is not
 * the finder's order (`everywhere` → lettering → border → scale bar, stubs,
 * hatch → in-building → duplicates, corners → `walls` → triage), so two
 * buckets were swapped. Corrected 2026-10-27, and triage added: a wall the
 * finder found and the classifier set aside is a wall the reviewer never
 * saw, which is why they traced it.
 */
type Stage =
  | "never paired"
  | "paired, not awarded"
  | "lost: lettering"
  | "lost: border"
  | "lost: scale bar, stubs, hatch, outside building"
  | "lost: duplicates, corners"
  | "merged into a neighbour"
  | "set aside by triage"
  | "proposed after all";
type Style = "light single-pen partition" | "two faces, ordinary pen" | "hatched masonry" | "short closet wall" | "nothing drawn along it";
const flat = (t: string) => t.replace(/[^a-z0-9]+/gi, "").toUpperCase();
function findPdf(dir: string): string | null {
  for (const root of [DIR, DIR2].filter((r) => r !== "")) for (const name of readdirSync(root)) if (name.toLowerCase().endsWith(".pdf") && flat(name) === flat(dir)) return join(root, name);
  return null;
}
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length === 0 ? 0 : s[Math.floor(s.length / 2)]; };

type Kind =
  | "single line drawn"
  | "nothing drawn along it"
  | "faces too far apart"
  | "hatched or filled"
  | "existing to remain"
  | "storefront or curtain wall"
  | "short stub"
  | "dense area"
  | "unattributed";

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
  tolerance = 0.985,
): boolean {
  const la = len(a);
  const lb = len(b);
  if (la === 0 || lb === 0) return false;
  const dot =
    ((a.x2 - a.x1) / la) * ((b.x2 - b.x1) / lb) + ((a.y2 - a.y1) / la) * ((b.y2 - b.y1) / lb);
  return Math.abs(dot) > tolerance;
}

/** Does `other` lie along `trace`, close and parallel, covering most of it? */
function coversTrace(
  trace: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number },
  other: { x1: number; y1: number; x2: number; y2: number; lengthFeet: number },
  fpu: number,
  band = 2.5,
): boolean {
  if (!parallel(trace, other)) return false;
  const off = Math.max(
    offLine(trace, other.x1, other.y1, fpu),
    offLine(trace, other.x2, other.y2, fpu),
  );
  if (off > band) return false;
  const L = len(trace) * fpu;
  const ux = (trace.x2 - trace.x1) / Math.max(len(trace), 1e-9);
  const uy = (trace.y2 - trace.y1) / Math.max(len(trace), 1e-9);
  const t1 = ((other.x1 - trace.x1) * ux + (other.y1 - trace.y1) * uy) * fpu;
  const t2 = ((other.x2 - trace.x1) * ux + (other.y2 - trace.y1) * uy) * fpu;
  const overlap = Math.min(L, Math.max(t1, t2)) - Math.max(0, Math.min(t1, t2));
  return overlap >= Math.min(L, other.lengthFeet) * 0.5;
}

describe.skipIf(DIR === "" || LABELS === "")("why the finder missed the traced walls", () => {
  it("attributes every traced wall to a stage, a kind and a drawing style, in feet", { timeout: 7_200_000 }, async () => {
    const files: { dir: string; sheet: string }[] = [];
    for (const dir of readdirSync(LABELS)) {
      const here = join(LABELS, dir);
      if (!existsSync(here) || heldOutReason(dir) !== null) continue;
      for (const name of readdirSync(here)) if (name.endsWith(".json")) files.push({ dir, sheet: name.replace(/\.json$/, "") });
    }
    files.sort((a, b) => a.dir.localeCompare(b.dir) || a.sheet.localeCompare(b.sheet));
    type Row = { sheet: string; stage: Stage; kind: Kind; style: Style; feet: number; x1: number; y1: number; x2: number; y2: number; spread: number; penRatio: number; faces: number;
      /** The long parallel strokes along the trace: offset from its line (ft), length (ft), pen width, whether it survived into the finder's input. */
      along: { off: number; len: number; pen: number; kept: boolean }[]; alongAll: number; widthPt: number };
    const rows: Row[] = [];
    const read: string[] = [];
    /** Feet of traces set aside by triage, by the classifier's own reason. */
    const asideWhy = new Map<string, number>();
    for (const file of files) {
      if (ONLY.length > 0 && !ONLY.some((o) => file.dir.toLowerCase().includes(o.toLowerCase()))) continue;
      const saved = JSON.parse(readFileSync(join(LABELS, file.dir, `${file.sheet}.json`), "utf8")) as Saved;
      const traces = (saved.verdicts ?? []).filter((v) => v.verdict === "traced");
      if (traces.length === 0) continue;
      const pdf = findPdf(file.dir);
      if (pdf === null) continue;
      const strokes = await sheetStrokes(Buffer.from(readFileSync(pdf)), saved.page);
      const doc = await openPlanPdf(Buffer.from(readFileSync(pdf)));
      const text = await doc.pageText(saved.page);
      await doc.close();
      const textItems = text.items.map((i) => ({ str: i.str, x: i.x, y: i.y, width: i.width, height: i.height }));
      const items = text.items.map((i) => ({ str: i.str, x: i.x / strokes.widthPt, y: i.y / strokes.widthPt }));
      // ── THE PRODUCT PIPELINE, NOT THE RAW FINDER ──
      // Views, sampled-sheet template, triage: what a reviewer was shown.
      const everyPairing: WallCandidate[] = [];
      const d = detectForSheet({
        segments: strokes.segments,
        textItems,
        pageSize: { widthPt: strokes.widthPt, heightPt: strokes.heightPt },
        feetPerUnit: saved.feetPerUnit,
        onCandidate: (_features, wall) => everyPairing.push(wall),
      });
      const found = d.found;
      const offered = offeredCandidates({
        walls: found.walls,
        segments: found.inUnits.map((one) => ({ ...one, x1: one.x1 * strokes.widthPt, y1: one.y1 * strokes.widthPt, x2: one.x2 * strokes.widthPt, y2: one.y2 * strokes.widthPt })),
        widthPt: strokes.widthPt,
        feetPerUnit: saved.feetPerUnit,
        planBoxes: d.planBoxes,
      });
      read.push(`${file.dir}/${file.sheet}`);
      const fpu = saved.feetPerUnit;
      const normalised = strokes.segments.map((seg) => ({ x1: seg.x1 / strokes.widthPt, y1: seg.y1 / strokes.widthPt, x2: seg.x2 / strokes.widthPt, y2: seg.y2 / strokes.widthPt, width: seg.width ?? 0 }));
      const sheetPen = median(normalised.map((s) => s.width).filter((w) => w > 0));
      for (const trace of traces) {
        const inStage = (list: readonly { x1: number; y1: number; x2: number; y2: number; lengthFeet: number }[]) => list.some((c) => coversTrace(trace, c, fpu));
        let stage: Stage;
        if (inStage(offered.candidates)) stage = "proposed after all";
        else if (inStage(found.walls) || inStage(offered.setAsideLines)) {
          stage = "set aside by triage";
          const line = offered.setAsideLines.find((c) => coversTrace(trace, c, fpu));
          asideWhy.set(line?.kind ?? "(found wall, no set-aside line covers it)", (asideWhy.get(line?.kind ?? "(found wall, no set-aside line covers it)") ?? 0) + trace.lengthFeet);
        }
        else if (found.walls.some((c) => parallel(trace, c) && offLine(c, (trace.x1 + trace.x2) / 2, (trace.y1 + trace.y2) / 2, fpu) <= 2.5 && c.lengthFeet > trace.lengthFeet * 1.8)) stage = "merged into a neighbour";
        else if (inStage(found.inBuilding)) stage = "lost: duplicates, corners";
        else if (inStage(found.notBorder)) stage = "lost: scale bar, stubs, hatch, outside building";
        else if (inStage(found.notLettering)) stage = "lost: border";
        else if (inStage(found.everywhere)) stage = "lost: lettering";
        else if (inStage(everyPairing)) stage = "paired, not awarded";
        else stage = "never paired";
        const along = normalised.filter((seg) => parallel(trace, seg, 0.97) && Math.max(offLine(trace, seg.x1, seg.y1, fpu), offLine(trace, seg.x2, seg.y2, fpu)) <= 2.5);
        const longAlong = along.filter((seg) => len(seg) * fpu >= Math.min(4, trace.lengthFeet * 0.4));
        const offsets = longAlong.map((seg) => offLine(trace, seg.x1, seg.y1, fpu));
        const spread = offsets.length < 2 ? 0 : Math.max(...offsets) - Math.min(...offsets);
        const pens = longAlong.map((s) => s.width).filter((w) => w > 0);
        const penRatio = sheetPen > 0 && pens.length > 0 ? median(pens) / sheetPen : 1;
        const nearText = (re: RegExp, ft: number) => items.some((i) => re.test(i.str) && Math.hypot((trace.x1 + trace.x2) / 2 - i.x, (trace.y1 + trace.y2) / 2 - i.y) * fpu <= ft);
        let kind: Kind;
        if (nearText(/STOREFRONT|CURTAIN ?WALL|GLAZ|ALUM.*FRAME/i, 12)) kind = "storefront or curtain wall";
        else if (nearText(/\(E\)|EXIST|TO REMAIN|E\.T\.R/i, 10)) kind = "existing to remain";
        else if (trace.lengthFeet < 3) kind = "short stub";
        else if (longAlong.length === 0) kind = "nothing drawn along it";
        else if (longAlong.length === 1) kind = "single line drawn";
        else if (along.length >= 12 && longAlong.length <= 2) kind = "hatched or filled";
        else if (spread > 2.5) kind = "faces too far apart";
        else if (along.length >= 20) kind = "dense area";
        else kind = "unattributed";
        // ── THE DRAWING STYLE, WHICH IS WHAT A FIX IS WRITTEN FOR ──
        let style: Style;
        if (longAlong.length === 0) style = "nothing drawn along it";
        else if (along.length >= 12 && longAlong.length <= 2) style = "hatched masonry";
        else if (trace.lengthFeet < 6) style = "short closet wall";
        else if (longAlong.length === 1 || penRatio < 0.6) style = "light single-pen partition";
        else style = "two faces, ordinary pen";
        const keptSet = new Set(found.inUnits.map((u) => `${u.x1.toFixed(6)},${u.y1.toFixed(6)},${u.x2.toFixed(6)},${u.y2.toFixed(6)}`));
        const diag = longAlong.map((seg) => ({
          off: Number(((offLine(trace, seg.x1, seg.y1, fpu) + offLine(trace, seg.x2, seg.y2, fpu)) / 2).toFixed(2)),
          len: Number((len(seg) * fpu).toFixed(1)),
          pen: seg.width,
          kept: keptSet.has(`${seg.x1.toFixed(6)},${seg.y1.toFixed(6)},${seg.x2.toFixed(6)},${seg.y2.toFixed(6)}`),
        })).sort((a, b) => a.off - b.off);
        rows.push({ sheet: `${file.dir.slice(0, 24)}/${file.sheet}`, stage, kind, style, feet: trace.lengthFeet, x1: trace.x1, y1: trace.y1, x2: trace.x2, y2: trace.y2, spread, penRatio, faces: longAlong.length, along: diag, alongAll: along.length, widthPt: strokes.widthPt });
      }
    }
    expect(read.length, "no training sheet with traces was read").toBeGreaterThan(0);
    const total = rows.reduce((t, r) => t + r.feet, 0);
    const table = <K extends string>(title: string, key: (r: Row) => K, subset = rows) => {
      const sub = subset.reduce((t, r) => t + r.feet, 0);
      const by = new Map<K, { feet: number; runs: number }>();
      for (const r of subset) { const e = by.get(key(r)) ?? { feet: 0, runs: 0 }; e.feet += r.feet; e.runs += 1; by.set(key(r), e); }
      console.log(`\n${title} (${sub.toFixed(0)} ft, ${subset.length} traces)`);
      for (const [k, e] of [...by.entries()].sort((a, b) => b[1].feet - a[1].feet)) console.log(`  ${k.padEnd(46)} ${e.feet.toFixed(0).padStart(7)} ft ${(100 * e.feet / Math.max(sub, 1e-9)).toFixed(1).padStart(6)}% ${String(e.runs).padStart(5)} runs`);
    };
    console.log(`\nTRACED, ALL TRAINING SHEETS: ${total.toFixed(0)} ft on ${rows.length} traces across ${read.length} sheets`);
    table("BY STAGE", (r) => r.stage);
    table("BY STYLE", (r) => r.style);
    table("BY KIND", (r) => r.kind);
    console.log("\nSET ASIDE BY TRIAGE, BY THE CLASSIFIER'S REASON");
    for (const [why, ft] of [...asideWhy.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${why.padEnd(46)} ${ft.toFixed(0).padStart(7)} ft`);
    table("BY STAGE × STYLE", (r) => `${r.stage} · ${r.style}`);
    for (const f of FOCUS) {
      const sub = rows.filter((r) => r.sheet.toLowerCase().includes(f.toLowerCase()));
      if (sub.length === 0) continue;
      table(`FOCUS ${f}: BY STAGE`, (r) => r.stage, sub);
      table(`FOCUS ${f}: BY STAGE × STYLE`, (r) => `${r.stage} · ${r.style}`, sub);
    }
    if (OUT !== "") {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, "miss-rows.json"), JSON.stringify(rows, null, 1));
    }
  });
});
