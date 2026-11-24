import { beforeAll, describe, expect, it, vi } from "vitest";
import type { StrokeSegment, WallCandidate } from "./wallVectors";

/**
 * ── THE CUSTOMER'S LIST HOLDS PLAN WALLS ONLY: NOTHING IN THE TITLE BLOCK, NOTES, LEGEND OR ON A GRID LINE ──
 *
 * Diego's permanent guard (2026-11-20, after "Found 119 runs" on Jane Hahan A2.1, which turned out to
 * be answer-key mode's raw list left on the customer panel — `keyModeList.ts`). This holds the other
 * half: the list every customer path shares (`offeredCandidates` over `detectForSheet`, as
 * `productSheetRuns` calls it) must not offer the furniture of a sheet around its plan.
 *
 * The sheet is INVENTED (no plan content in the repo) and built to tempt each rule: a title-block strip
 * and a notes column ruled in pairs a wall's thickness apart, a legend whose samples ARE wall pairs, and
 * single dashed grid lines running edge to edge between bubbles. 1,000 x 700 pt at 1/10 ft per point.
 *
 * Runs at the PRODUCT'S OWN DEFAULTS (no env stubbed): what it asserts is what main plus the
 * LEGEND-SAMPLE rule (prereg-legend-sample.md, on by default) guarantees. The legend's samples, drawn
 * as wall pairs on a sheet measured whole, were offered before that rule — this guard is what found it.
 * Parts that WAIT ON FUTURE RULES, deliberately not asserted: rules drawn in PAIRS a wall's thickness
 * apart outside the plan on a single-view sheet (the KNOWN GAP below), and patterned-wall RECALL (the
 * parked infill rule, `TAKEOFF_LEGEND_NEW_INFILL`, off by default after failing its ship rule).
 */
const W = 1000, H = 700, FPU = 100;
const seg = (x1: number, y1: number, x2: number, y2: number): StrokeSegment => ({ x1, y1, x2, y2, width: 0.7, gray: 0 });
const pair = (x1: number, y1: number, x2: number, y2: number, t = 5): StrokeSegment[] =>
  y1 === y2 ? [seg(x1, y1, x2, y2), seg(x1, y1 + t, x2, y2 + t)] : [seg(x1, y1, x2, y2), seg(x1 + t, y1, x2 + t, y2)];
const dashed = (x1: number, y: number, x2: number) => { const out: StrokeSegment[] = []; for (let x = x1; x < x2; x += 12) out.push(seg(x, y, Math.min(x + 8, x2), y)); return out; };
const circle = (cx: number, cy: number, r: number) => Array.from({ length: 12 }, (_, i) => { const a = (i * Math.PI) / 6, b = ((i + 1) * Math.PI) / 6; return seg(cx + r * Math.cos(a), cy + r * Math.sin(a), cx + r * Math.cos(b), cy + r * Math.sin(b)); });
const word = (str: string, x: number, y: number, height = 6) => ({ str, x, y, width: str.length * height * 0.6, height });

// The plan: a 60 x 40 ft building (600 x 400 pt) at (60, 80), six interior partitions.
const plan: StrokeSegment[] = [
  ...pair(60, 80, 660, 80), ...pair(60, 475, 660, 475), ...pair(60, 80, 60, 480), ...pair(655, 80, 655, 480),
  ...pair(260, 85, 260, 475), ...pair(460, 85, 460, 475), ...pair(65, 280, 255, 280), ...pair(465, 280, 655, 280),
  ...pair(265, 200, 455, 200), ...pair(265, 360, 455, 360),
];
const inPlan = (w: WallCandidate) => [w.x1, w.x2].every((x) => x * W >= 50 && x * W <= 670) && [w.y1, w.y2].every((y) => y * W >= 70 && y * W <= 490);
// Grid lines: single dashed lines through the plan, edge to edge between bubbles.
const grid = [140, 380].flatMap((y) => [...dashed(20, y, 690), ...circle(12, y, 8), ...circle(698, y, 8)]);
// Title block: a strip at the right edge with single rules between its rows (firm, project, sheet,
// revisions), as Jane Hahan A2.1's and NG-Lakewood A3.5's are drawn.
const titleBlock = [seg(900, 10, 900, 690), seg(990, 10, 990, 690), seg(900, 10, 990, 10), seg(900, 690, 990, 690), ...[60, 160, 300, 420, 560, 640].map((y) => seg(900, y, 990, y))];
// Notes column: a framed block of numbered notes, a rule under its heading. The legend: framed, its samples drawn as wall pairs.
// KNOWN GAP, not asserted here: on a sheet measured whole (one view), rules drawn in PAIRS a wall's
// thickness apart outside the plan ARE offered — nothing bounds a single-view sheet to its plan. No
// real sheet in training or wave 2 showed it (Jane Hahan A2.1 offers 4 runs, all on the plan).
const notes = [seg(720, 40, 880, 40), seg(720, 40, 720, 400), seg(880, 40, 880, 400), seg(720, 400, 880, 400), seg(725, 58, 830, 58)];
const legend = [seg(720, 430, 880, 430), seg(720, 430, 720, 600), seg(880, 430, 880, 600), seg(720, 600, 880, 600), ...[470, 510, 550].flatMap((y) => pair(725, y, 825, y))];
const textItems = [
  word("FLOOR PLAN", 60, 520, 10), word('SCALE: 1/8" = 1\'-0"', 60, 535),
  word("FLOOR PLAN NOTES", 725, 55, 8), ...[90, 140, 190, 240, 290, 340].map((y, i) => word(`${i + 1}. CONTRACTOR TO FIELD VERIFY ALL DIMENSIONS`, 725, y)),
  word("WALL LEGEND", 725, 445, 8), word("(E) PARTITION", 830, 474, 8), word("(N) 6\" MTL STUD", 830, 514, 8), word("(N) PLUMBING", 830, 554, 8),
  word("ARCHITECTS", 905, 40, 8), word("A2.1", 920, 680, 12), word("REVISIONS", 905, 410),
  word("A", 9, 142), word("A", 695, 142), word("B", 9, 382), word("B", 695, 382),
];

describe("the customer offer on an invented sheet with a title block, notes, a legend and grid lines", () => {
  let offered: WallCandidate[] = [];
  const run = async () => {
    vi.resetModules();
    const { detectForSheet, offeredCandidates } = await import("./offeredCandidates");
    const segments = [...plan, ...grid, ...titleBlock, ...notes, ...legend];
    const d = detectForSheet({ segments, textItems, pageSize: { widthPt: W, heightPt: H }, feetPerUnit: FPU });
    return offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: segments, widthPt: W, feetPerUnit: FPU, planBoxes: d.planBoxes, textItems }).offeredRuns;
  };
  beforeAll(async () => {
    // The product's own defaults: no env stubbed, so this is what every customer sees.
    offered = await run();
  });

  it("offers the plan's walls", () => {
    const planFeet = offered.filter(inPlan).reduce((n, r) => n + r.lengthFeet, 0);
    expect(planFeet, "most of the plan's ~330 ft of wall").toBeGreaterThan(250);
  });

  it("offers nothing outside the plan: not the title block, the notes, the legend samples or a grid line's run past the building", () => {
    const outside = offered.filter((r) => !inPlan(r)).map((r) => `${(r.x1 * W).toFixed(0)},${(r.y1 * W).toFixed(0)}-${(r.x2 * W).toFixed(0)},${(r.y2 * W).toFixed(0)} ${r.lengthFeet.toFixed(0)} ft`);
    expect(outside).toEqual([]);
  });

  it("offers no run along a grid line", () => {
    const onGrid = offered.filter((r) => [140, 380].some((y) => Math.abs(r.y1 * W - y) < 3 && Math.abs(r.y2 * W - y) < 3));
    expect(onGrid).toEqual([]);
  });

  it("the kill switch exists and the rule is really wired: with LEGEND_SAMPLE off, the legend's samples come back", async () => {
    vi.stubEnv("NEXT_PUBLIC_TAKEOFF_LEGEND_SAMPLE", "0");
    const off = await run();
    vi.unstubAllEnvs();
    vi.resetModules();
    const samples = off.filter((r) => [470, 510, 550].some((y) => Math.abs(r.y1 * W - y) < 8) && r.x1 * W > 700);
    expect(samples.length, "legend samples offered again when the rule is off").toBeGreaterThan(0);
  });
});

/**
 * ── NOT-DRAWING v3's CI GUARD, LIMITED TO TITLE-BLOCK SHAPES (prereg-not-drawing-v3.md rule 5) ──
 *
 * The KNOWN GAP above, in the one place v3 closes it: a SINGLE-VIEW sheet measured whole, whose
 * title-block row rules are drawn in PAIRS a wall's thickness apart. Singh A2.0 offered nine such
 * runs (its entire list, 100% junk); OTH A105 its title runs. The strip is found from the sheet's
 * own ruled boundary (rightmost chained full-height vertical with >= 2 strong title words right of
 * it), and behind NEXT_PUBLIC_TAKEOFF_NOT_DRAWING=1 everything inside it is set aside.
 * Notes/legend residue left of the boundary is deliberately NOT asserted — that belongs to (b),
 * the run-model features.
 */
describe("a single-view sheet whose title-block rows are wall pairs (Singh A2.0's nine runs, OTH A105's title runs)", () => {
  // One plan view, measured whole (no second view), and a ruled title strip with paired row rules.
  const strip = [
    seg(900, 10, 900, 690), seg(990, 10, 990, 690),
    seg(900, 10, 990, 10), seg(900, 690, 990, 690),
    ...[60, 160, 300, 420, 560, 640].map((y) => pair(902, y, 988, y)).flat(),
  ];
  const words = [
    word("FLOOR PLAN", 60, 520, 10),
    word("ARCHITECTS", 905, 40, 8), word("PROJECT", 905, 200, 8), word("REVISIONS", 905, 410), word("SHEET", 905, 630, 8),
  ];
  const inStrip = (r: WallCandidate) => [r.x1, r.x2].every((x) => x * W >= 895) ;
  const runSingle = async () => {
    const { detectForSheet, offeredCandidates } = await import("./offeredCandidates");
    const segments = [...plan, ...strip];
    const d = detectForSheet({ segments, textItems: words, pageSize: { widthPt: W, heightPt: H }, feetPerUnit: FPU });
    return offeredCandidates({ walls: d.found.walls, segments: d.found.inUnits.map((u) => ({ ...u, x1: u.x1 * W, y1: u.y1 * W, x2: u.x2 * W, y2: u.y2 * W })), pageSegments: segments, widthPt: W, feetPerUnit: FPU, planBoxes: d.planBoxes, textItems: words }).offeredRuns;
  };

  it("flag off, the gap is real: the strip's paired rows ARE offered (what Singh A2.0 showed live)", async () => {
    vi.resetModules();
    const off = await runSingle();
    expect(off.filter(inStrip).length, "title-row pairs offered with the rule off — the non-vacuity control").toBeGreaterThan(0);
  });

  it("flag on, nothing inside the detected strip survives, and the plan is untouched", async () => {
    vi.stubEnv("NEXT_PUBLIC_TAKEOFF_NOT_DRAWING", "1");
    vi.resetModules();
    const on = await runSingle();
    vi.unstubAllEnvs();
    vi.resetModules();
    expect(on.filter(inStrip).map((r) => `${(r.x1 * W).toFixed(0)},${(r.y1 * W).toFixed(0)}-${(r.x2 * W).toFixed(0)},${(r.y2 * W).toFixed(0)}`)).toEqual([]);
    expect(on.filter(inPlan).reduce((n, r) => n + r.lengthFeet, 0), "the plan's walls still offered").toBeGreaterThan(250);
  });
});
