import type { Buffer } from "node:buffer";
import type { StrokeSegment } from "./wallVectors";

/**
 * THE STROKED LINES ON A SHEET, in the same coordinate space the viewer uses.
 *
 * ── WHAT WAS MEASURED, 2026-10-06, BEFORE THIS EXISTED ──
 *
 * `plan-ingest/planPdf.ts` records what works in Node on this `pdfjs-dist`:
 * `numPages`, `getViewport`, `getTextContent` — and that `page.render()` FAILS
 * for want of a canvas. It says nothing about `getOperatorList`, so that was
 * probed:
 *
 *   operators returned: 9
 *   by kind: { setLineWidth: 1, constructPath: 4, stroke: 4 }
 *   constructPath args: [[13, 14], [100, 500, 400, 500], …]
 *   OPS.moveTo = 13, OPS.lineTo = 14
 *
 * It works, it needs no canvas, and the coordinates come back EXACTLY as drawn.
 * So a wall's length is the drawing's own number rather than anything estimated
 * — which is the whole reason wall takeoff can be deterministic here while
 * symbol counting could not be.
 *
 * ── CURVES AND RECTANGLES ARE DELIBERATELY DROPPED ──
 *
 * `curveTo` is an arc — a door swing, a radius wall, a pipe. A wall face is a
 * straight run, and approximating a Bézier as a chord would invent a length
 * nobody drew. `rectangle` is kept, because CAD emits a rectangle for a column
 * or a simple room boundary, and its four sides ARE straight runs.
 *
 * ── THE SAME CONVERSION `planPdf.ts` USES ──
 *
 * `getOperatorList` returns coordinates in UNROTATED PDF user space, which is
 * y-up and ignores the page's `/Rotate`. `getViewport().transform` is what maps
 * that to the y-down, rotation-applied space the viewer draws in — and
 * `planPdf.ts` already learned that the hard way for text: an AutoCAD export
 * routinely carries `/Rotate 90`, and reading raw coordinates on one puts every
 * line on the wrong axis.
 *
 * ── AND THE VIEWPORT IS ONLY HALF THE TRANSFORM. THE FIRST VERSION OF THIS FILE
 * SHIPPED WITH THE OTHER HALF MISSING, WHICH HALVED WALL LENGTHS. ──
 *
 * A path's coordinates are in the space of the CURRENT TRANSFORMATION MATRIX at
 * the moment it is drawn, and pdfjs reports that matrix as its own operators
 * rather than baking it in: `OPS.transform` for a `cm`, `OPS.save`/`OPS.restore`
 * for `q`/`Q`. Measured on a sheet carrying two walls whose content-stream
 * numbers are IDENTICAL, the second wrapped in `q 2 0 0 2 0 0 cm … Q`:
 *
 *   operators: { setLineWidth: 1, constructPath: 4, stroke: 4,
 *                save: 1, transform: 1, restore: 1 }
 *   path coords: [100, 600, 280, 600]     // wall A — 180pt, and 180pt on paper
 *   path coords: [50, 150, 230, 150]      // wall B — 180pt, but 360pt on paper
 *
 * Ignoring those operators reports wall B at HALF its length and HALF its
 * thickness — a 40ft wall becoming 20ft, or falling outside the thickness window
 * and vanishing entirely. Both failures are silent, and the footage one is the
 * expensive kind: it reads as a plausible number.
 *
 * **No test in this repo could have caught it**, because `syntheticSheet.ts`
 * writes its own content stream and never emits a `cm`. That is CLAUDE.md's
 * *"nothing is ever missing from a question nobody is asking"* — the fourth
 * member of the census family, arriving as a fixture that cannot pose the
 * question rather than a census that cannot see the file. Real CAD poses it
 * constantly: a Form XObject always carries a matrix, and Revit and AutoCAD both
 * wrap drawing content in one.
 *
 * So the CTM is tracked here, as a stack, and `syntheticSheet.ts` can now draw
 * under a transform so the fixture can ask.
 */

export type SheetStrokes = {
  pageNumber: number;
  /** The page as DISPLAYED, in points — rotation applied. */
  widthPt: number;
  heightPt: number;
  rotation: number;
  segments: StrokeSegment[];
  /**
   * How many path operators the page carried, before anything was filtered.
   *
   * THE PROBE'S OWN CONTROL. A sheet that yields no segments could be a scan
   * (nothing to read, a fact) or a pipeline that silently stopped working (a
   * bug) — and those must never look the same. This number separates them, and
   * the eval asserts it is non-zero before reading any other figure off a run.
   */
  pathOperators: number;
};

/**
 * Reads the straight stroked segments off a page that is ALREADY OPEN.
 *
 * Split out from `sheetStrokes` so one pdfjs document can serve both layers —
 * see `openPlanPdf`'s `pageStrokes`. That is not a tidy-up: pdfjs DETACHES the
 * buffer it is given, so opening a second document from the same bytes throws
 * `Cannot perform Construct on a detached or out-of-bounds ArrayBuffer`. Any
 * stage that wants text AND geometry has to read them from one document.
 *
 * `pdfjs` is passed in rather than imported again, because the `OPS` constants
 * must be the ones belonging to the module that produced this operator list.
 */
/**
 * How far a flattened piece may stray from the true curve, in PAGE POINTS.
 *
 * ── WHY A TOLERANCE AND NOT A PIECE COUNT, AND WHY THIS NUMBER ──
 *
 * The pairer drops any input segment shorter than `minLengthFeet` (2 ft), which
 * is the lever that decides what a flattened curve becomes. A fixed piece count
 * ignores the curve's shape and gets both ends wrong: it cuts a gentle 22 ft
 * wall arc into pieces too short to survive that floor, and leaves a tight 4 ft
 * door swing in pieces long enough to pass it.
 *
 * A flatness tolerance is the opposite and does the right thing on its own.
 * Pieces needed go as the square root of the curve's sagitta over the
 * tolerance, so a SHALLOW arc needs few long pieces and a TIGHT one needs many
 * short pieces. On School-01's A-101, measured:
 *
 *   the lobby wall  — 22.2 ft chord, shallow  → pieces around 2.8 ft, KEPT
 *   a door swing    —  4.2 ft chord, 90 deg   → pieces around 1.0 ft, DROPPED
 *
 * That is not a coincidence to be relied on blindly — a very large-radius door
 * swing would survive flattening — but it costs nothing, and a lone swing has
 * no concentric partner for the pairer to match it against anyway.
 *
 * HALF A POINT is about 2/3 of an inch of building at 1/8" = 1'-0" on an ARCH D
 * sheet, an order of magnitude under the thinnest wall this app recognises, so
 * the polyline is faithful where it matters: the thickness between two
 * concentric faces is unchanged by it.
 */
export const CURVE_FLATNESS_POINTS = 0.5;

/** The most pieces one Bézier may become, so a pathological control polygon
 *  cannot turn one curve into thousands of segments on an O(n²) pairer. */
export const CURVE_MAX_PIECES = 24;

type Point = { x: number; y: number };

/**
 * A cubic Bézier as a polyline, returning the points AFTER the start.
 *
 * The piece count comes from the control polygon's deviation from the chord,
 * which bounds the curve's own deviation — the standard conservative estimate,
 * and conservative in the direction that matters here: it never under-samples a
 * curve and so never straightens a wall that bends.
 */
export function flattenCubic(p0: Point, c1: Point, c2: Point, p3: Point): Point[] {
  const chord = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  // How far the control points pull away from the straight line. For a
  // degenerate curve (all four points coincident) this is zero and one piece is
  // the whole of it.
  const bulge = Math.max(
    distanceToSegment(c1, p0, p3),
    distanceToSegment(c2, p0, p3),
  );
  if (!(bulge > CURVE_FLATNESS_POINTS) || !(chord > 0)) return [p3];
  const pieces = Math.min(
    CURVE_MAX_PIECES,
    Math.max(2, Math.ceil(Math.sqrt(bulge / CURVE_FLATNESS_POINTS))),
  );
  const out: Point[] = [];
  for (let i = 1; i <= pieces; i++) {
    const t = i / pieces;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
    });
  }
  return out;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export async function segmentsFromOpenPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs ships no types for the legacy build entry; `planPdf.ts` takes the same position.
  page: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above.
  pdfjs: any,
  pageNumber: number,
): Promise<SheetStrokes> {
  {
    {
      const viewport = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const { OPS, Util } = pdfjs;

      const segments: StrokeSegment[] = [];
      let pathOperators = 0;

      // The CTM stack. `ctm` is the matrix in force now; `q` pushes a copy and
      // `Q` pops back to it. A `Q` with nothing pushed is malformed PDF, so the
      // identity is kept rather than popping past the bottom.
      const IDENTITY: number[] = [1, 0, 0, 1, 0, 0];
      let ctm = IDENTITY;
      // THE PEN TRAVELS WITH THE MATRIX. Line width is graphics state, so `q`
      // and `Q` save and restore it exactly as they do the CTM — keeping it in
      // a separate stack would drift the moment a path changed one and not the
      // other. 1.0 is the PDF default for a page that never sets it.
      let lineWidth = 1;
      const stack: { ctm: number[]; lineWidth: number }[] = [];

      for (let i = 0; i < ops.fnArray.length; i += 1) {
        const fn = ops.fnArray[i];

        if (fn === OPS.save) {
          stack.push({ ctm, lineWidth });
          continue;
        }
        if (fn === OPS.restore) {
          const popped = stack.pop();
          ctm = popped?.ctm ?? IDENTITY;
          lineWidth = popped?.lineWidth ?? 1;
          continue;
        }
        if (fn === OPS.setLineWidth) {
          lineWidth = Number((ops.argsArray[i] as number[])[0]) || 0;
          continue;
        }
        if (fn === OPS.transform) {
          // A `cm` CONCATENATES onto the matrix in force, it does not replace
          // it — so nested transforms compose, which is how a Form XObject
          // inside a scaled block lands in the right place.
          ctm = Util.transform(ctm, ops.argsArray[i] as number[]);
          continue;
        }
        // There is deliberately no "replace the matrix" case: PDF has no such
        // operator. `cm` is the only way to change the CTM and it always
        // concatenates, so `q`/`Q` are the only way back. Typecheck caught a
        // first version of this that guessed at an `OPS.setTransform`.
        if (fn !== OPS.constructPath) continue;
        pathOperators += 1;

        const args = ops.argsArray[i] as [number[], number[], unknown];
        const pathOps = args[0] ?? [];
        const coords = args[1] ?? [];

        let at = 0;
        let cursor: { x: number; y: number } | null = null;
        let subpathStart: { x: number; y: number } | null = null;

        // CTM first, then the viewport — the order the PDF model composes them
        // in. Captured per path, because the next path may be under a different
        // matrix.
        const toPage = Util.transform(viewport.transform, ctm);
        // A WIDTH IS IN USER SPACE AND HAS TO BE SCALED LIKE EVERYTHING ELSE.
        // A 0.5 pen inside a half-scale block draws a 0.25 line on the page,
        // and comparing raw pen numbers across blocks would be comparing
        // different units — the same mistake the CTM bug made with lengths.
        // The matrix's area scale, square-rooted, is the isotropic factor.
        const widthScale = Math.sqrt(Math.abs(toPage[0] * toPage[3] - toPage[1] * toPage[2])) || 1;
        const w = lineWidth * widthScale;
        const toDisplay = (x: number, y: number) => {
          const [dx, dy] = Util.applyTransform([x, y], toPage);
          return { x: dx, y: dy };
        };

        for (const op of pathOps) {
          if (op === OPS.moveTo) {
            cursor = toDisplay(coords[at], coords[at + 1]);
            subpathStart = cursor;
            at += 2;
          } else if (op === OPS.lineTo) {
            const next = toDisplay(coords[at], coords[at + 1]);
            at += 2;
            if (cursor !== null) segments.push({ x1: cursor.x, y1: cursor.y, x2: next.x, y2: next.y, width: w });
            cursor = next;
          } else if (op === OPS.curveTo) {
            // ── AN ARC IS FLATTENED, NOT DROPPED ──
            //
            // This used to skip the curve and move the cursor to its end. The
            // header said why: approximating a Bézier as a CHORD would invent a
            // length nobody drew. That is true of a chord and it is the wrong
            // conclusion — a radius wall is a wall, and the comment named one
            // as something it was throwing away.
            //
            // Reported from School-01's lobby, 2026-10-11: a curved wall with
            // no overlay on it at all. Measured on that sheet, the curve ops
            // separate cleanly — the wall is TWO single Béziers, chords 22.2 ft
            // and 21.8 ft, which is a pair of concentric faces; the 35 door
            // swings are single Béziers of 4.2 ft; the 57 four-Bézier runs are
            // closed circles (hardware symbols).
            //
            // So the curve is cut into pieces short enough to be straight and
            // handed to the pairer, which already asks the only question that
            // matters: are these two lines parallel, a wall thickness apart,
            // and overlapping. A lone door swing has no concentric partner and
            // produces nothing, exactly as it does today.
            //
            // `flattenCubic`'s tolerance is what keeps that true — see its own
            // comment for why the pieces of a tight arc come out BELOW the
            // 2 ft floor the pairer applies to its input, and the pieces of a
            // gentle one above it.
            const c1 = toDisplay(coords[at], coords[at + 1]);
            const c2 = toDisplay(coords[at + 2], coords[at + 3]);
            const end = toDisplay(coords[at + 4], coords[at + 5]);
            at += 6;
            if (cursor !== null) {
              let from = cursor;
              for (const to of flattenCubic(cursor, c1, c2, end)) {
                segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, width: w, curved: true });
                from = to;
              }
            }
            cursor = end;
          } else if (op === OPS.rectangle) {
            const [x, y, w, hh] = [coords[at], coords[at + 1], coords[at + 2], coords[at + 3]];
            at += 4;
            const a = toDisplay(x, y);
            const b = toDisplay(x + w, y);
            const c = toDisplay(x + w, y + hh);
            const d = toDisplay(x, y + hh);
            segments.push(
              { x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: w },
              { x1: b.x, y1: b.y, x2: c.x, y2: c.y, width: w },
              { x1: c.x, y1: c.y, x2: d.x, y2: d.y, width: w },
              { x1: d.x, y1: d.y, x2: a.x, y2: a.y, width: w },
            );
            cursor = a;
            subpathStart = a;
          } else if (op === OPS.closePath) {
            if (cursor !== null && subpathStart !== null) {
              segments.push({ x1: cursor.x, y1: cursor.y, x2: subpathStart.x, y2: subpathStart.y, width: w });
              cursor = subpathStart;
            }
          }
        }
      }

      return {
        pageNumber,
        widthPt: viewport.width,
        heightPt: viewport.height,
        rotation: page.rotate,
        segments,
        pathOperators,
      };
    }
  }
}

/**
 * Reads the stroked segments off one page of a PDF, opening its own document.
 *
 * For a caller that wants ONLY geometry — the wall-detection measurement. A
 * stage that also needs the text layer must use `openPlanPdf`'s `pageStrokes`
 * instead, because pdfjs detaches the buffer and a second document cannot be
 * opened from the same bytes.
 */
export async function sheetStrokes(bytes: Buffer, pageNumber: number): Promise<SheetStrokes> {
  // The legacy build, the same entry `planPdf.ts` imports and for its reasons.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    // A COPY here, unlike `openPlanPdf`'s deliberate view: this entry point is
    // for callers holding bytes they may still want afterwards.
    data: new Uint8Array(bytes),
    // No eval, no worker, no canvas — the posture `planPdf.ts` established.
    isEvalSupported: false,
    verbosity: 0,
  }).promise;
  try {
    const page = await doc.getPage(pageNumber);
    try {
      return await segmentsFromOpenPage(page, pdfjs, pageNumber);
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}
