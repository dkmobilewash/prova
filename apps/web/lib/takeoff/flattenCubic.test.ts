import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
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

  it("THE VIEWER CARRIES IT through its unit conversion", () => {
    // `unitsOf` rebuilds each segment field by field. Leaving `curved` off
    // compiles, passes every test above, and silently hands the room engine the
    // arc again — the lobby wall billed twice, 1,957 ft against a key of 1,894.
    const viewer = stripped("components/TakeoffPlanViewer.tsx");
    expect(viewer, "unitsOf drops the curved flag").toMatch(/curved: one\.curved/);
  });

  it("read real files, so a moved path fails loudly", () => {
    expect(read("lib/takeoff/sheetStrokes.ts").length).toBeGreaterThan(2000);
    expect(read("components/TakeoffPlanViewer.tsx").length).toBeGreaterThan(2000);
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
const OPS = { moveTo: 13, lineTo: 14, curveTo: 15, closePath: 16, rectangle: 19, constructPath: 91, save: 10, restore: 11, setLineWidth: 2, transform: 12, stroke: 20 };

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
