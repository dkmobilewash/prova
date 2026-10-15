import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { inPageWidthUnits } from "./findWallsOnSheet";
import {
  CURVE_FLATNESS_POINTS,
  CURVE_MAX_PIECES,
  flattenCubic,
  segmentsFromOpenPage,
} from "./sheetStrokes";

/**
 * ── A CURVED WALL IS A WALL, AND THIS FILE IS WHY IT REACHES THE PAIRER ──
 *
 * `sheetStrokes` used to drop every `curveTo`, deliberately: "approximating a
 * Bézier as a chord would invent a length nobody drew." That is true of a CHORD
 * and it was the wrong conclusion — the comment named "a radius wall" among the
 * things it was discarding.
 *
 * Reported from School-01's lobby, 2026-10-11: a curved wall with no overlay on
 * it at all. Measured on that sheet, the curve ops separate cleanly — the wall
 * is TWO single Béziers of 22.2 ft and 21.8 ft chord (a pair of concentric
 * faces), the 35 door swings are single Béziers of 4.2 ft, and 57 four-Bézier
 * runs are closed circles.
 *
 * The pieces are cut by FLATNESS rather than by count, and that is what sorts a
 * wall from a door swing without a rule naming either — see
 * `CURVE_FLATNESS_POINTS`. Pieces needed go as the square root of the curve's
 * sagitta over the tolerance, so on A-101:
 *
 *   the lobby wall — shallow  → pieces about 2.8 ft, ABOVE the pairer's 2 ft floor
 *   a door swing   — 90 deg   → pieces about 1.0 ft, BELOW it and dropped
 */
const P = (x: number, y: number) => ({ x, y });

describe("flattening a Bézier into wall faces", () => {
  it("leaves a straight 'curve' as a single piece", () => {
    // Control points on the chord: there is nothing to approximate.
    const out = flattenCubic(P(0, 0), P(10, 0), P(20, 0), P(30, 0));
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(P(30, 0));
  });

  it("ALWAYS ENDS EXACTLY ON THE CURVE'S OWN END POINT", () => {
    // The next `lineTo` starts from here. A piece count that drifted would move
    // every wall drawn after a curve.
    const end = P(100, 40);
    const out = flattenCubic(P(0, 0), P(0, 80), P(100, -40), end);
    expect(out[out.length - 1].x).toBeCloseTo(end.x, 6);
    expect(out[out.length - 1].y).toBeCloseTo(end.y, 6);
  });

  it("cuts a BULGING curve into more pieces than a shallow one", () => {
    const shallow = flattenCubic(P(0, 0), P(33, 4), P(66, 4), P(100, 0));
    const tight = flattenCubic(P(0, 0), P(33, 60), P(66, 60), P(100, 0));
    expect(tight.length).toBeGreaterThan(shallow.length);
  });

  it("STAYS WITHIN ITS TOLERANCE OF THE TRUE CURVE, which is the whole claim", () => {
    // Sample the real Bézier densely and check every sample is near the
    // polyline. A piece count that was too coarse would straighten a wall.
    const p0 = P(0, 0);
    const c1 = P(20, 70);
    const c2 = P(80, 70);
    const p3 = P(100, 0);
    const poly = [p0, ...flattenCubic(p0, c1, c2, p3)];
    let worst = 0;
    for (let i = 0; i <= 400; i++) {
      const t = i / 400;
      const u = 1 - t;
      const x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x;
      const y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y;
      let near = Infinity;
      for (let k = 0; k + 1 < poly.length; k++) {
        const a = poly[k];
        const b = poly[k + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy;
        const s = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / len2));
        near = Math.min(near, Math.hypot(x - (a.x + s * dx), y - (a.y + s * dy)));
      }
      worst = Math.max(worst, near);
    }
    // The control-polygon estimate is conservative, so the real deviation comes
    // in well under the tolerance. Bounding it at the tolerance is the claim
    // the comment makes; the slack is why it holds.
    expect(worst).toBeLessThanOrEqual(CURVE_FLATNESS_POINTS);
  });

  it("NEVER EXPLODES ONE CURVE INTO THOUSANDS, because the pairer is O(n²)", () => {
    const wild = flattenCubic(P(0, 0), P(1e6, 1e6), P(-1e6, 1e6), P(100, 0));
    expect(wild.length).toBeLessThanOrEqual(CURVE_MAX_PIECES);
  });

  it("survives a degenerate curve with all four points together", () => {
    const out = flattenCubic(P(5, 5), P(5, 5), P(5, 5), P(5, 5));
    expect(out).toEqual([P(5, 5)]);
  });
});

describe("the flag reaching the engines", () => {
  const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), "utf8");
  const stripped = (rel: string) =>
    read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("MARKS the pieces it makes, which is what the room engine reads", () => {
    expect(stripped("lib/takeoff/sheetStrokes.ts")).toMatch(/curved: true/);
  });

  it("THE ROOM ENGINE FILTERS ON IT", () => {
    expect(stripped("lib/takeoff/wallRuns.ts")).toMatch(/segments\.filter\(\(one\) => one\.curved !== true\)/);
  });

  it("THE UNIT CONVERSION CARRIES IT — called, not read", () => {
    // ── THIS WAS A SOURCE CENSUS AND IS NOW A TEST, which is the dividend of
    //    lifting the pipeline out of the React component ──
    //
    // It used to grep `TakeoffPlanViewer.tsx` for `curved: one.curved`, because
    // the conversion lived inside a component and nothing could call it. The
    // apology is gone: `inPageWidthUnits` is a function, so this runs it.
    //
    // THE DEFECT IT GUARDS, which is not hypothetical: the bench's own copy of
    // this conversion dropped the flag. `wallRuns` filters `curved !== true`,
    // so a missing flag reads as "not curved" and hands the room engine the arc
    // again — the lobby wall billed twice, 1,957 ft against a key of 1,894.
    const arc = { x1: 0, y1: 0, x2: 10, y2: 0, width: 2, curved: true };
    const straight = { x1: 0, y1: 0, x2: 10, y2: 0, width: 2 };

    expect(inPageWidthUnits(100)(arc).curved).toBe(true);
    // And an ordinary segment does not acquire one — `!== true` would read an
    // invented `false` the same way, but a caller checking `curved === false`
    // later would be told something nobody measured.
    expect(inPageWidthUnits(100)(straight).curved).toBeUndefined();

    // The scaling still happens, so this cannot pass by returning its input.
    expect(inPageWidthUnits(100)(arc).x2).toBe(0.1);
    // `width` is deliberately NOT scaled: the pen is compared against other
    // pens on the same sheet, never against a distance.
    expect(inPageWidthUnits(100)(arc).width).toBe(2);
  });

  it("read real files, so a moved path fails loudly", () => {
    expect(read("lib/takeoff/sheetStrokes.ts").length).toBeGreaterThan(2000);
    expect(read("lib/takeoff/findWallsOnSheet.ts").length).toBeGreaterThan(2000);
  });
});

/**
 * ── THE EXTRACTION LOOP ACTUALLY CALLS IT, which nothing else here proves ──
 *
 * Every case above tests `flattenCubic` as a function, and the censuses test
 * that the flag is spelled in three files. All of that stayed GREEN with the
 * curve branch disabled — mutation-tested, `if (cursor !== null)` to
 * `if (false)`, which is the defect exactly as it was reported. A pure function
 * nothing calls is the shape CLAUDE.md names, and it had it.
 *
 * pdf.js is stubbed rather than driven: `segmentsFromOpenPage` takes an OPEN
 * page and the module, so an operator list can be handed to it directly. That
 * is the whole seam, and it needs no PDF, no fixture and no bytes.
 */
const OPS = { moveTo: 13, lineTo: 14, curveTo: 15, closePath: 16, rectangle: 19, constructPath: 91, save: 10, restore: 11, setLineWidth: 2, transform: 12, stroke: 20, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75 };

function stubPdfjs() {
  return {
    OPS,
    Util: {
      // The same two the real module uses: compose a matrix, and apply one.
      transform: (a: number[], b: number[]) => [
        a[0] * b[0] + a[2] * b[1],
        a[1] * b[0] + a[3] * b[1],
        a[0] * b[2] + a[2] * b[3],
        a[1] * b[2] + a[3] * b[3],
        a[0] * b[4] + a[2] * b[5] + a[4],
        a[1] * b[4] + a[3] * b[5] + a[5],
      ],
      applyTransform: (p: number[], m: number[]) => [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5],
      ],
    },
  };
}

function stubPage(kinds: number[], coords: number[]) {
  return {
    getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100 }),
    getOperatorList: async () => ({
      fnArray: [OPS.constructPath, OPS.stroke],
      argsArray: [[kinds, coords], null],
    }),
  };
}

describe("reading a curve off a page", () => {
  it("TURNS A CURVE INTO SEGMENTS, rather than skipping it", async () => {
    // One moveTo then one curveTo that bulges well past the tolerance.
    const out = await segmentsFromOpenPage(
      stubPage([OPS.moveTo, OPS.curveTo], [0, 0, 20, 60, 80, 60, 100, 0]),
      stubPdfjs(),
      1,
    );
    expect(out.segments.length, "the curve produced no geometry at all").toBeGreaterThan(1);
    expect(out.segments.every((s) => s.curved === true)).toBe(true);
  });

  it("STARTS AT THE CURSOR AND ENDS AT THE CURVE'S END", async () => {
    const out = await segmentsFromOpenPage(
      stubPage([OPS.moveTo, OPS.curveTo], [0, 0, 20, 60, 80, 60, 100, 0]),
      stubPdfjs(),
      1,
    );
    const first = out.segments[0];
    const last = out.segments[out.segments.length - 1];
    expect([first.x1, first.y1]).toEqual([0, 0]);
    expect(last.x2).toBeCloseTo(100, 6);
    expect(last.y2).toBeCloseTo(0, 6);
  });

  it("leaves an ordinary line unmarked, so the room engine still sees it", async () => {
    const out = await segmentsFromOpenPage(
      stubPage([OPS.moveTo, OPS.lineTo], [0, 0, 50, 0]),
      stubPdfjs(),
      1,
    );
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].curved).toBeUndefined();
  });

  it("MOVES THE CURSOR ACROSS A CURVE, so the next line starts in the right place", async () => {
    // The behaviour the old skip-the-curve branch was careful to keep, and the
    // one a rewrite is most likely to lose.
    const out = await segmentsFromOpenPage(
      stubPage(
        [OPS.moveTo, OPS.curveTo, OPS.lineTo],
        [0, 0, 20, 60, 80, 60, 100, 0, 150, 0],
      ),
      stubPdfjs(),
      1,
    );
    const straight = out.segments.filter((s) => s.curved !== true);
    expect(straight).toHaveLength(1);
    expect([straight[0].x1, straight[0].y1]).toEqual([100, 0]);
    expect([straight[0].x2, straight[0].y2]).toEqual([150, 0]);
  });
});

/**
 * ── A FORM XOBJECT CARRIES ITS OWN MATRIX, AND IT NEVER REACHED THE CTM ──
 *
 * `sheetStrokes`'s header has always said "a Form XObject always carries a
 * matrix, and Revit and AutoCAD both wrap drawing content in one", and the CTM
 * stack was built for exactly that. It was wired to `cm` only. pdf.js does not
 * emit an XObject's matrix as a `cm`: it emits `paintFormXObjectBegin` with
 * `[matrix, bbox]`, inlines the form's operators, then `paintFormXObjectEnd`.
 * Every one of those matrices was dropped.
 *
 * MEASURED ON THE BENCH, graded per wall against the key's centreline. The loss
 * diagnosed as "the reader returned no segment on this wall's faces" was
 * 6,086 ft on Mesa Ridge and 7,575 ft on the holdout, and every sheet carrying
 * it is an `__autocad` export bar one scan with no vectors at all.
 *
 * The geometry was never missing. `A-101__autocad` carries 177 of these and
 * returns MORE segments than the clean export of the same sheet — 7,272 against
 * 2,928. They simply landed in the wrong place, so the building filter dropped
 * them and the wall was reported as never read.
 *
 * With the matrix applied: Mesa found 52,109 → 59,538 ft (66.8% → 76.3%) and
 * the holdout 24,057 → 31,088 ft (72.8% → 94.1%).
 */
function stubFormPage(kinds: number[], coords: number[], matrix: number[]) {
  return {
    getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100 }),
    getOperatorList: async () => ({
      fnArray: [OPS.paintFormXObjectBegin, OPS.constructPath, OPS.paintFormXObjectEnd, OPS.constructPath],
      argsArray: [
        [matrix, [0, 0, 100, 100]],
        [kinds, coords],
        null,
        // The same path again, AFTER the form closes: it must be untransformed.
        [kinds, coords],
      ],
    }),
  };
}

describe("a Form XObject's own matrix", () => {
  const line = [OPS.moveTo, OPS.lineTo];
  const at = [0, 0, 10, 0];

  it("MOVES THE GEOMETRY INSIDE IT — the AutoCAD case", async () => {
    // Translate by (100, 50). Without the fix the segment stays at the origin
    // and lands nowhere near the building.
    const out = await segmentsFromOpenPage(
      stubFormPage(line, at, [1, 0, 0, 1, 100, 50]),
      stubPdfjs(),
      1,
    );
    const inside = out.segments[0];
    expect([inside.x1, inside.y1], "the form's matrix was dropped").toEqual([100, 50]);
    expect([inside.x2, inside.y2]).toEqual([110, 50]);
  });

  it("SCALES IT TOO, which is what makes a wall the wrong thickness", async () => {
    const out = await segmentsFromOpenPage(stubFormPage(line, at, [2, 0, 0, 2, 0, 0]), stubPdfjs(), 1);
    expect([out.segments[0].x1, out.segments[0].x2]).toEqual([0, 20]);
  });

  it("POPS THE MATRIX AT THE END, so the next path is not moved as well", async () => {
    // The form's scope is the begin/end pair — `q`/`Q` do not bracket it. A
    // matrix left in force would drag the whole rest of the sheet with it.
    const out = await segmentsFromOpenPage(
      stubFormPage(line, at, [1, 0, 0, 1, 100, 50]),
      stubPdfjs(),
      1,
    );
    expect(out.segments).toHaveLength(2);
    const after = out.segments[1];
    expect([after.x1, after.y1], "the form's matrix outlived the form").toEqual([0, 0]);
    expect([after.x2, after.y2]).toEqual([10, 0]);
  });

  it("COMPOSES ONTO THE MATRIX IN FORCE, it does not replace it", async () => {
    // The nested case the file's header names: "a Form XObject inside a scaled
    // block". A `cm` is in force when the form begins, so composing gives
    // 5+100 and replacing gives 100 — and with an identity CTM, which is what
    // every other test here starts from, the two are indistinguishable.
    // Mutation-tested: replacing instead of composing was BLIND until this.
    const page = {
      getViewport: () => ({ transform: [1, 0, 0, 1, 0, 0], width: 100, height: 100 }),
      getOperatorList: async () => ({
        fnArray: [OPS.transform, OPS.paintFormXObjectBegin, OPS.constructPath, OPS.paintFormXObjectEnd],
        argsArray: [
          [1, 0, 0, 1, 5, 5],
          [[1, 0, 0, 1, 100, 50], [0, 0, 100, 100]],
          [line, at],
          null,
        ],
      }),
    };
    const out = await segmentsFromOpenPage(page, stubPdfjs(), 1);
    expect(
      [out.segments[0].x1, out.segments[0].y1],
      "the form replaced the page's own transform",
    ).toEqual([105, 55]);
  });

  it("survives a form with no usable matrix rather than throwing", async () => {
    const out = await segmentsFromOpenPage(stubFormPage(line, at, []), stubPdfjs(), 1);
    expect(out.segments).toHaveLength(2);
    expect([out.segments[0].x1, out.segments[0].x2]).toEqual([0, 10]);
  });
});
