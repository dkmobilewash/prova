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

/**
 * The optional-content id out of a `beginMarkedContentProps` argument.
 *
 * pdfjs hands `{ type: "OCG", id }` for a plain group and
 * `{ type: "OCMD", ids: [...] }` for a membership dictionary. An OCMD over
 * several groups is attributed to its FIRST, because the alternative is
 * inventing a composite name for a case that is rare on CAD exports — and
 * over-reporting one real layer name is recoverable where a made-up one is not.
 */
function optionalContentId(oc: unknown): string | null {
  if (typeof oc !== "object" || oc === null) return null;
  const o = oc as { id?: unknown; ids?: unknown };
  if (typeof o.id === "string") return o.id;
  if (Array.isArray(o.ids) && typeof o.ids[0] === "string") return o.ids[0];
  return null;
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * What the document knows about one optional-content group.
 *
 * ── A LOOKUP AND NOT THE CONFIG OBJECT, DELIBERATELY ──
 *
 * `getOptionalContentConfig()` belongs to the DOCUMENT and this function is
 * handed a PAGE, so asking for the config here would mean either plumbing a
 * document through or opening a second one — and pdfjs detaches the buffer, so
 * the second open is the documented crash `pageStrokes` has a comment about.
 *
 * A function is also what keeps this testable without a PDF at all.
 */
export type LayerLookup = (id: string) => { name: string; visible: boolean } | null;

/**
 * Builds a `LayerLookup` from an open pdfjs DOCUMENT.
 *
 * Returns `null` when the file carries no optional content, which is the
 * ordinary case for a flattened plot and must stay distinguishable from "this
 * group has no name".
 */
export async function layersOf(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs ships no types for the legacy build entry.
  doc: any,
): Promise<LayerLookup | null> {
  // NEVER THROWS OUT OF HERE. A malformed /OCProperties must cost the layer
  // signal, never the wall takeoff — the whole pipeline worked without this
  // until today and has to keep working when a file will not give it up.
  const config = await doc.getOptionalContentConfig().catch(() => null);
  if (!config) return null;
  const groups = config.getGroups?.() ?? null;
  if (!groups || Object.keys(groups).length === 0) return null;
  return (id: string) => {
    const group = config.getGroup(id);
    if (!group) return null;
    const name = typeof group.name === "string" ? group.name : "";
    if (name === "") return null;
    // `isVisible` takes the same shape the operator list hands us.
    let visible = true;
    try {
      visible = config.isVisible({ type: "OCG", id }) !== false;
    } catch {
      visible = true;
    }
    return { name, visible };
  };
}

export async function segmentsFromOpenPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- pdfjs ships no types for the legacy build entry; `planPdf.ts` takes the same position.
  page: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above.
  pdfjs: any,
  pageNumber: number,
  /**
   * How to turn an optional-content id into a layer name, from `layersOf`.
   *
   * OMITTED MEANS TODAY'S BEHAVIOUR, EXACTLY. Every caller that does not pass
   * one gets segments with no `layer`, which every consumer treats as "say
   * nothing" — so adding this could not change a single number until a caller
   * opts in.
   */
  layers?: LayerLookup | null,
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

      // ── THE MARKED-CONTENT STACK, WHICH IS NOT THE GRAPHICS STACK ──
      //
      // `BDC`/`EMC` nest independently of `q`/`Q` — a layer can open inside a
      // saved graphics state and close outside it — so this is its own stack
      // and never shares the one above.
      //
      // An entry is the layer in force, or `null` for a marked section that is
      // not optional content (`/Artifact BDC`, a tagged-PDF span). Those MUST
      // still be pushed: `EMC` pops one entry whatever opened it, and skipping
      // the non-OC ones would pop a layer early and attribute the rest of the
      // page to the wrong group — silently, and in the direction that drops
      // walls.
      const marks: (string | null)[] = [];

      // ── THE PEN'S POSITION SURVIVES A `constructPath` BOUNDARY ──
      //
      // These were local to each `constructPath` until 2026-10-15, on the
      // assumption that pdfjs emits one operator per path. IT DOES NOT. pdfjs
      // buffers path operators and flushes the buffer when something else
      // interrupts it, so ONE `m … l … S` path can arrive as `[m]` in one
      // operator and `[l]` in the next — and a reader that starts each
      // operator with a null cursor silently drops the line. Nothing throws:
      // the `[m]` draws nothing because it is only a move, and the `[l]` draws
      // nothing because it has no cursor to draw from.
      //
      // MEASURED, on the bench's own A-101: the same sheet written with layer
      // markers has 1,234 path operators against 1,233 and one FEWER segment,
      // and the missing one is wall LB-30's face — split as `op#2997 [m]
      // 248.91 918.42` / `op#2998 [l] 326.86 963.42` where the untagged file
      // has `[m l]` in one. A real CAD export carries a marked-content
      // boundary at every layer change, so this is not a fixture curiosity:
      // it is a wall lost per interrupted path, on exactly the files this
      // repo most wants to read.
      //
      // Carrying the cursor across is also what the PDF model says: `m` and
      // `l` build a path until a PAINT operator ends it, and how a parser
      // chunks the operators in between is its own business. A path that
      // genuinely starts fresh begins with `m`, which overwrites both of
      // these anyway.
      let cursor: { x: number; y: number } | null = null;
      let subpathStart: { x: number; y: number } | null = null;
      /** The innermost named layer, or null. Content inside `A-WALL` inside a
       *  tagged section belongs to A-WALL. */
      const layerNow = (): { name: string; visible: boolean } | null => {
        if (!layers) return null;
        for (let m = marks.length - 1; m >= 0; m -= 1) {
          const id = marks[m];
          if (id === null) continue;
          const found = layers(id);
          if (found) return found;
        }
        return null;
      };

      for (let i = 0; i < ops.fnArray.length; i += 1) {
        const fn = ops.fnArray[i];

        if (fn === OPS.beginMarkedContent) {
          marks.push(null);
          continue;
        }
        if (fn === OPS.beginMarkedContentProps) {
          // `["OC", { type: "OCG", id }]`, or an OCMD carrying `ids`. Read out
          // of pdfjs's own `parseMarkedContentProps` rather than remembered.
          const args = ops.argsArray[i] as [unknown, unknown];
          marks.push(args?.[0] === "OC" ? optionalContentId(args[1]) : null);
          continue;
        }
        if (fn === OPS.endMarkedContent) {
          marks.pop();
          continue;
        }

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
        // ── A FORM XOBJECT CARRIES ITS OWN MATRIX, AND IT ARRIVES HERE ──
        //
        // The header above says "a Form XObject always carries a matrix, and
        // Revit and AutoCAD both wrap drawing content in one", and the CTM
        // stack was built for exactly that. It was never wired to the operator
        // that delivers it: pdf.js does NOT emit the XObject's matrix as a
        // `cm`. It emits `paintFormXObjectBegin` with `[matrix, bbox]`, inlines
        // the form's own operators, and closes with `paintFormXObjectEnd`.
        // Handling only `cm` means every one of those matrices is dropped.
        //
        // MEASURED, and it is the single biggest hole in wall detection. Graded
        // per wall on `reports/takeoff-bench`, the loss diagnosed as "the
        // reader returned no segment on this wall's faces" is 6,086 ft on Mesa
        // Ridge and 7,575 ft on the holdout — and every sheet carrying it is an
        // `__autocad` export, bar one scan that genuinely has no vectors.
        //
        // The geometry was never missing. `A-101__autocad` has 177 of these
        // and returns MORE segments than the clean export of the same sheet
        // (7,272 against 2,928). They land in the wrong place, so the building
        // filter drops them, and the wall is reported as never read.
        //
        // `q`/`Q` do not bracket a form — the begin/end pair is its own scope —
        // so the matrix is pushed and popped here rather than relying on them.
        if (fn === OPS.paintFormXObjectBegin) {
          stack.push({ ctm, lineWidth });
          const matrix = (ops.argsArray[i] as unknown[])[0];
          if (Array.isArray(matrix) && matrix.length === 6) {
            ctm = Util.transform(ctm, matrix as number[]);
          }
          continue;
        }
        if (fn === OPS.paintFormXObjectEnd) {
          const popped = stack.pop();
          ctm = popped?.ctm ?? IDENTITY;
          lineWidth = popped?.lineWidth ?? 1;
          continue;
        }
        // There is deliberately no "replace the matrix" case: PDF has no such
        // operator. `cm` is the only way to change the CTM and it always
        // concatenates, so `q`/`Q` are the only way back. Typecheck caught a
        // first version of this that guessed at an `OPS.setTransform`.
        if (fn !== OPS.constructPath) continue;
        pathOperators += 1;

        // ── A LAYER THE DRAWING HAS SWITCHED OFF WAS NEVER ON THE SHEET ──
        //
        // `/OFF` in the document's optional-content configuration means the
        // content is IN THE FILE and NOT DRAWN: a superseded design option, a
        // demolition overlay, a consultant's background. Measuring it is
        // measuring something nobody can see, and the bench's own answer key
        // has said so since it was written — probe P8, "a wall on an
        // optional-content layer that is OFF", expected 0 segments and got 2.
        //
        // Counted in `pathOperators` first, on purpose: that number is the
        // control that tells a scan from a reader which stopped working, and
        // it has to report what the PAGE carried rather than what survived.
        const onLayer = layerNow();
        if (onLayer !== null && !onLayer.visible) continue;
        const layer = onLayer?.name;

        const args = ops.argsArray[i] as [number[], number[], unknown];
        const pathOps = args[0] ?? [];
        const coords = args[1] ?? [];

        let at = 0;

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
            if (cursor !== null) segments.push({ x1: cursor.x, y1: cursor.y, x2: next.x, y2: next.y, width: w, layer });
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
                segments.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y, width: w, curved: true, layer });
                from = to;
              }
            }
            cursor = end;
          } else if (op === OPS.rectangle) {
            // ── NOTICED AND DELIBERATELY NOT FIXED HERE: `w` SHADOWS THE PEN ──
            //
            // The outer `w` is the line width with the matrix applied. This
            // destructuring rebinds the name to the RECTANGLE'S WIDTH in user
            // space, so all four sides below report the rectangle's width as
            // their stroke width. That is wrong and it is older than this
            // change.
            //
            // It is harmless TODAY — `HEURISTICS.md` records that nothing in
            // the shipped pipeline has read the pen since #671, which is why
            // nothing caught it — and it is a landmine for whoever next decides
            // the pen discriminates a wall from a slab joint.
            //
            // Left alone because fixing it would move bench numbers inside a
            // change whose whole point is a clean before/after on ONE variable.
            // Its own PR, with its own measurement.
            const [x, y, w, hh] = [coords[at], coords[at + 1], coords[at + 2], coords[at + 3]];
            at += 4;
            const a = toDisplay(x, y);
            const b = toDisplay(x + w, y);
            const c = toDisplay(x + w, y + hh);
            const d = toDisplay(x, y + hh);
            segments.push(
              { x1: a.x, y1: a.y, x2: b.x, y2: b.y, width: w, layer },
              { x1: b.x, y1: b.y, x2: c.x, y2: c.y, width: w, layer },
              { x1: c.x, y1: c.y, x2: d.x, y2: d.y, width: w, layer },
              { x1: d.x, y1: d.y, x2: a.x, y2: a.y, width: w, layer },
            );
            cursor = a;
            subpathStart = a;
          } else if (op === OPS.closePath) {
            if (cursor !== null && subpathStart !== null) {
              segments.push({ x1: cursor.x, y1: cursor.y, x2: subpathStart.x, y2: subpathStart.y, width: w, layer });
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
    // The layer table belongs to the DOCUMENT, so it is read here, where this
    // entry point owns one. A file with no optional content gives `null` and
    // the reader behaves exactly as it did before layers existed.
    const layers = await layersOf(doc);
    const page = await doc.getPage(pageNumber);
    try {
      return await segmentsFromOpenPage(page, pdfjs, pageNumber, layers);
    } finally {
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
}
