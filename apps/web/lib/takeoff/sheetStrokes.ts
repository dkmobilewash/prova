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
 * Reads the straight stroked segments off one page.
 *
 * Opens its own document rather than taking an open one: this is a diagnostic
 * path for now, and `openPlanPdf`'s shape is built around text. When wall
 * takeoff becomes a feature the two should share a document.
 */
export async function sheetStrokes(bytes: Buffer, pageNumber: number): Promise<SheetStrokes> {
  // The legacy build, the same entry `planPdf.ts` imports and for its reasons.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    // No eval, no worker, no canvas — the posture `planPdf.ts` established.
    isEvalSupported: false,
    verbosity: 0,
  }).promise;

  try {
    const page = await doc.getPage(pageNumber);
    try {
      const viewport = page.getViewport({ scale: 1 });
      const ops = await page.getOperatorList();
      const { OPS, Util } = pdfjs;

      const segments: StrokeSegment[] = [];
      let pathOperators = 0;

      for (let i = 0; i < ops.fnArray.length; i += 1) {
        if (ops.fnArray[i] !== OPS.constructPath) continue;
        pathOperators += 1;

        const args = ops.argsArray[i] as [number[], number[], unknown];
        const pathOps = args[0] ?? [];
        const coords = args[1] ?? [];

        let at = 0;
        let cursor: { x: number; y: number } | null = null;
        let subpathStart: { x: number; y: number } | null = null;

        const toDisplay = (x: number, y: number) => {
          const [dx, dy] = Util.applyTransform([x, y], viewport.transform);
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
            if (cursor !== null) segments.push({ x1: cursor.x, y1: cursor.y, x2: next.x, y2: next.y });
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
              { x1: a.x, y1: a.y, x2: b.x, y2: b.y },
              { x1: b.x, y1: b.y, x2: c.x, y2: c.y },
              { x1: c.x, y1: c.y, x2: d.x, y2: d.y },
              { x1: d.x, y1: d.y, x2: a.x, y2: a.y },
            );
            cursor = a;
            subpathStart = a;
          } else if (op === OPS.closePath) {
            if (cursor !== null && subpathStart !== null) {
              segments.push({ x1: cursor.x, y1: cursor.y, x2: subpathStart.x, y2: subpathStart.y });
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
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}
