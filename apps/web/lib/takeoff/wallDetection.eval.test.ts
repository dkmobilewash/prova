import { describe, expect, it } from "vitest";
import { synthesiseSheet, SHEETS, trueWallFeet, type SheetSpec, type WallSpec } from "./syntheticSheet";
import { sheetStrokes } from "./sheetStrokes";
import { wallsFromStrokes, type WallCandidate } from "./wallVectors";
import { WALL_CASES, type WallCase } from "./wallCases";

/**
 * THE WALL-DETECTION MEASUREMENT, END TO END: a real PDF in, walls out.
 *
 * ── WHY THIS IS A TEST AND NOT A `pnpm eval:…` SCRIPT ──
 *
 * `symbolCount.eval.ts` is a script you run by hand because every case costs a
 * model call and an API key. This measurement costs NEITHER. It is deterministic
 * geometry from the PDF's own coordinates, so it can run on every PR forever
 * instead of when somebody remembers — which is strictly better, and is the
 * whole dividend of the vector route.
 *
 * It still reports like an eval: the numbers are printed, because a bare pass
 * tells the next person nothing about how much margin there was.
 *
 * ── WHAT IT GRADES, AND WHY THERE IS NO FATAL CATEGORY ──
 *
 * `FOUND` a true wall matched, within tolerance on length
 * `PHANTOM` a wall reported where none is — a dimension line, a hatch pair
 * `MISSED` a true wall with nothing reported on it
 * `LENGTH_OFF` matched, but the footage is wrong
 *
 * Symbol counting's fatal grade was `OVERCLAIMED`: a confident wrong NUMBER,
 * fatal because nobody can check it by eye. That grade is unreachable here and
 * by construction rather than by luck — this returns a CENTRELINE, the app
 * measures it with `polylineLength` and the sheet's own calibration, and the
 * line is drawn on the drawing where an estimator sees it. A phantom is a line
 * in the wrong place; a miss is a visible gap. Both cost a click, neither costs
 * a wrong bid.
 *
 * If a future version of this ever reports footage the geometry does not
 * support, the fatal category comes back with it.
 */

/** A found wall is the same wall as a true one if its midpoint is within this
 *  many points and its length within this fraction. 6pt is 8 inches of building
 *  at 1/8" scale — tight enough that a wall matched to its neighbour fails. */
const MATCH_TOLERANCE_PT = 6;
const LENGTH_TOLERANCE = 0.05;

type Grade = "FOUND" | "PHANTOM" | "MISSED" | "LENGTH_OFF";

type CaseResult = {
  id: string;
  pathOperators: number;
  segments: number;
  grades: Record<Grade, number>;
  trueFeet: number;
  foundFeet: number;
  cluttered: boolean;
};

/**
 * Where the generator actually drew a wall's centreline, in DISPLAY points.
 *
 * The generator works in PDF user space (y-up, origin bottom-left, a 80pt
 * margin); `sheetStrokes` returns display space (y-down). Converting the TRUTH
 * forward is deliberate — converting the findings backward would mean the
 * grading shared a transform with the thing it grades, and a transform bug
 * would then cancel out and read as a pass.
 */
function trueCentreline(wall: WallSpec, spec: SheetSpec): { x1: number; y1: number; x2: number; y2: number } {
  const ptPerFoot = 72 / (spec.feetPerInch ?? 8);
  const pageHeight = SHEETS[spec.sheetSize].height;
  const x = 80 + wall.fromFeet.x * ptPerFoot;
  const yUp = 80 + wall.fromFeet.y * ptPerFoot;
  const run = wall.lengthFeet * ptPerFoot;
  const half = (wall.thicknessFeet * ptPerFoot) / 2;

  if (wall.direction === "horizontal") {
    const y = pageHeight - (yUp + half);
    return { x1: x, y1: y, x2: x + run, y2: y };
  }
  const cx = x + half;
  return { x1: cx, y1: pageHeight - yUp, x2: cx, y2: pageHeight - (yUp + run) };
}

const midpoint = (s: { x1: number; y1: number; x2: number; y2: number }) => ({
  x: (s.x1 + s.x2) / 2,
  y: (s.y1 + s.y2) / 2,
});

const spanOf = (s: { x1: number; y1: number; x2: number; y2: number }) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1);

/** Grades one sheet: every true wall is matched at most once, and anything left
 *  over on either side is a miss or a phantom. */
function grade(found: WallCandidate[], spec: SheetSpec): Record<Grade, number> {
  const truth = (spec.walls ?? []).map((wall) => trueCentreline(wall, spec));
  const claimed = new Set<number>();
  const grades: Record<Grade, number> = { FOUND: 0, PHANTOM: 0, MISSED: 0, LENGTH_OFF: 0 };

  for (const wall of found) {
    const mid = midpoint(wall);
    let match = -1;
    for (let i = 0; i < truth.length; i += 1) {
      if (claimed.has(i)) continue;
      const trueMid = midpoint(truth[i]);
      if (Math.hypot(mid.x - trueMid.x, mid.y - trueMid.y) <= MATCH_TOLERANCE_PT) {
        match = i;
        break;
      }
    }
    if (match === -1) {
      grades.PHANTOM += 1;
      continue;
    }
    claimed.add(match);
    const expected = spanOf(truth[match]);
    const actual = spanOf(wall);
    const off = Math.abs(actual - expected) / Math.max(expected, 1);
    if (off > LENGTH_TOLERANCE) grades.LENGTH_OFF += 1;
    else grades.FOUND += 1;
  }

  grades.MISSED = truth.length - claimed.size;
  return grades;
}

async function runCase(wallCase: WallCase): Promise<CaseResult> {
  const pdf = synthesiseSheet(wallCase.spec);
  const strokes = await sheetStrokes(pdf, 1);
  const feetPerPoint = (wallCase.spec.feetPerInch ?? 8) / 72;
  const found = wallsFromStrokes(strokes.segments, { feetPerPoint });

  return {
    id: wallCase.id,
    pathOperators: strokes.pathOperators,
    segments: strokes.segments.length,
    grades: grade(found, wallCase.spec),
    trueFeet: trueWallFeet(wallCase.spec),
    foundFeet: found.reduce((sum, wall) => sum + wall.lengthFeet, 0),
    cluttered: wallCase.cluttered,
  };
}

describe("wall detection from a sheet's own vector strokes", () => {
  it("MEASURES EVERY CASE AND PRINTS THE RESULT", async () => {
    const results: CaseResult[] = [];
    for (const wallCase of WALL_CASES) {
      results.push(await runCase(wallCase));
    }

    // THE VERDICT COUNT, before anything is read off the numbers. A measurement
    // that silently dropped a case would otherwise report a clean run on fewer
    // cases than were asked for — the shape CLAUDE.md records as the most
    // expensive kind of green.
    expect(results, `collected ${results.length}, requested ${WALL_CASES.length}`).toHaveLength(WALL_CASES.length);

    const lines = results.map((r) => {
      const g = r.grades;
      return (
        `  ${r.id.padEnd(26)} ops ${String(r.pathOperators).padStart(4)}  seg ${String(r.segments).padStart(4)}  ` +
        `found ${g.FOUND}  phantom ${g.PHANTOM}  missed ${g.MISSED}  lengthOff ${g.LENGTH_OFF}  ` +
        `${r.foundFeet.toFixed(1)}ft of ${r.trueFeet.toFixed(1)}ft`
      );
    });
    const net = results.reduce((sum, r) => sum + r.grades.FOUND - r.grades.PHANTOM - r.grades.MISSED, 0);
    console.log(`\nwall detection — ${results.length} cases\n${lines.join("\n")}\n  net walls saved: ${net}\n`);

    // THE HARNESS'S OWN CONTROL, and it is not the same question as the gate.
    // A case that yields no segments could be a pipeline that quietly stopped
    // reaching the file — which would make every "0 phantoms" below vacuous.
    for (const result of results) {
      expect(result.pathOperators, `${result.id}: no path operators — the pipeline read nothing`).toBeGreaterThan(0);
      expect(result.segments, `${result.id}: no segments survived extraction`).toBeGreaterThan(0);
    }
  }, 60_000);

  it("finds every wall on a clean sheet, which is the floor", async () => {
    for (const wallCase of WALL_CASES.filter((c) => !c.cluttered)) {
      const result = await runCase(wallCase);
      expect(result.grades.FOUND, `${wallCase.id}: ${wallCase.why}`).toBe(wallCase.expectWalls);
      expect(result.grades.MISSED, wallCase.id).toBe(0);
      expect(result.grades.LENGTH_OFF, wallCase.id).toBe(0);
    }
  }, 60_000);

  it("GETS THE FOOTAGE RIGHT, which is the number a bid is made of", async () => {
    for (const wallCase of WALL_CASES.filter((c) => !c.cluttered)) {
      const result = await runCase(wallCase);
      // Within 2%: the centreline of a wall whose faces cross at a corner is a
      // little shorter than the nominal run, and that is the drawing's own
      // geometry rather than an error.
      expect(result.foundFeet, `${wallCase.id}: ${result.foundFeet} vs ${result.trueFeet}`).toBeGreaterThan(
        result.trueFeet * 0.98,
      );
      expect(result.foundFeet).toBeLessThan(result.trueFeet * 1.02);
    }
  }, 60_000);

  it("REPORTS NOTHING ON A SHEET WITH NO WALLS — the cheapest case to get wrong", async () => {
    const detailSheet = WALL_CASES.find((c) => c.id === "no-walls-at-all");
    expect(detailSheet).toBeDefined();
    const result = await runCase(detailSheet!);
    expect(result.segments, "nothing was read, so a clean result here means nothing").toBeGreaterThan(0);
    expect(result.grades.PHANTOM, "phantom walls on a sheet that has none").toBe(0);
  }, 60_000);

  it("survives clutter: hatching, dimensions, door swings and notes", async () => {
    for (const wallCase of WALL_CASES.filter((c) => c.cluttered && c.expectWalls > 0)) {
      const result = await runCase(wallCase);
      expect(result.grades.FOUND, `${wallCase.id}: ${wallCase.why}`).toBe(wallCase.expectWalls);
      expect(result.grades.PHANTOM, `${wallCase.id}: ${wallCase.why}`).toBe(0);
    }
  }, 60_000);
});

/**
 * THE TRANSFORM ARM, and it exists because the fixture could not ask the
 * question until it did.
 *
 * `sheetStrokes.ts` shipped ignoring the current transformation matrix. Every
 * test above passed, because `syntheticSheet.ts` writes its own content stream
 * and never emitted a `cm` — so the defect was not missed by a weak assertion,
 * it was unreachable by every assertion. CLAUDE.md's fourth census failure:
 * *nothing is ever missing from a question nobody is asking.*
 *
 * Real CAD asks it constantly — a Form XObject always carries a matrix, and
 * Revit and AutoCAD both wrap drawing content in one. Ignoring it halves a
 * wall's length AND its thickness, so a 40ft wall reads as 20ft or falls outside
 * the thickness window and disappears. Silent either way.
 *
 * The arms are identical on paper and differ only in whether the reader must
 * honour the matrix, so the EQUALITY is the assertion.
 */
describe("the pen, read back through the graphics state", () => {
  /**
   * `Q` RESTORES THE PEN AS WELL AS THE MATRIX, and nothing checked it.
   *
   * Line width is graphics state. A reader that pops the matrix but not the
   * pen reads every stroke after a transformed block at the INNER width — and
   * since `heavierThanHatching` decides what is a wall by comparing pens, a
   * drift there silently reclassifies the drawing.
   *
   * The fixture draws the walls inside `q … 3 w … Q` and the LAST wall after
   * the restore, at the outer `1 w`. That split is what makes a leak
   * observable: with everything inside one block there is nothing left to read
   * wrongly, which is the same reason the matrix arm is built that way.
   */
  it("reads the OUTER pen for work drawn after the restore", async () => {
    const plain = WALL_CASES.find((c) => c.id === "single-room-clean")!;
    const bytes = synthesiseSheet({ ...plain.spec, wallTransformScale: 2 });
    const { segments } = await sheetStrokes(bytes, 1);
    const widths = segments.map((s) => s.width ?? 0).filter((w) => w > 0);
    expect(widths.length).toBeGreaterThan(0);

    // The inner pen is 3 under a 2x matrix, which reads as SIX: a width is in
    // user space and scales with everything else, so a 0.5 pen inside a
    // half-scale block draws a 0.25 line on the page. Expecting 3 here was the
    // first draft of this test and it was the test that was wrong — comparing
    // raw pen numbers across blocks would be comparing different units, the
    // same mistake the CTM bug made with lengths.
    const outer = widths.filter((w) => Math.abs(w - 1) < 0.01).length;
    const inner = widths.filter((w) => Math.abs(w - 6) < 0.01).length;
    expect(inner, "strokes inside the transformed block, at 3w under a 2x matrix").toBeGreaterThan(0);
    expect(outer, "strokes drawn after the restore — zero means Q did not restore the pen").toBeGreaterThan(0);
  });
});

describe("a sheet drawn under a transform, which is what real CAD does", () => {
  const plain = WALL_CASES.find((c) => c.id === "single-room-clean")!;

  it("reads the SAME walls and the SAME footage at 2x", async () => {
    const flat = await runCase(plain);
    const scaled = await runCase({
      ...plain,
      id: "single-room-2x",
      spec: { ...plain.spec, id: "single-room-2x", wallTransformScale: 2 },
    });

    expect(scaled.segments, "nothing was read, so an equal result means nothing").toBeGreaterThan(0);
    expect(scaled.grades.FOUND).toBe(flat.grades.FOUND);
    expect(scaled.grades.PHANTOM).toBe(0);
    expect(scaled.grades.MISSED).toBe(0);
    expect(scaled.foundFeet).toBeCloseTo(flat.foundFeet, 1);
    expect(scaled.foundFeet).toBeCloseTo(trueWallFeet(plain.spec), 1);
  }, 60_000);

  it("holds at a fractional scale too, where the error would round the other way", async () => {
    const scaled = await runCase({
      ...plain,
      id: "single-room-half",
      spec: { ...plain.spec, id: "single-room-half", wallTransformScale: 0.5 },
    });
    expect(scaled.segments).toBeGreaterThan(0);
    expect(scaled.grades.FOUND).toBe(plain.expectWalls);
    expect(scaled.grades.MISSED).toBe(0);
    expect(scaled.foundFeet).toBeCloseTo(trueWallFeet(plain.spec), 1);
  }, 60_000);
});
