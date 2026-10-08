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
            // An arc, not a wall face. Skipped, and the cursor is moved to its
            // end point so the NEXT lineTo starts in the right place rather
            // than from wherever the curve began.
            const end = toDisplay(coords[at + 4], coords[at + 5]);
            at += 6;
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
