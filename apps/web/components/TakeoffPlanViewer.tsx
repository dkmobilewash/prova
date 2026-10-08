"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ActionForm } from "@/components/ActionForm";
import { SubmitButton } from "@/components/SubmitButton";
import { formatFeetInches, parseFeetInches } from "@/lib/feet-inches";
import {
  calibrationNotices,
  calibrationRefusal,
  feetPerPageWidth,
  polylineLength,
  readScale,
  ringArea,
  ringSelfIntersects,
  verticesProblem,
  type MeasurementKind,
  type StoredCalibration,
} from "@/lib/takeoff-plan";
import { saveTakeoffCalibration, saveTakeoffMeasurement, saveTakeoffMeasurements } from "@/lib/actions";
import type { PlanSheet, PrintedScaleByPage, ScalePrefill, ScalePrefillByPage } from "@/lib/takeoff-plan-view";
import {
  errorBandText,
  evidenceOrder,
  fitZoom,
  stepZoom,
  TOOLS,
  ZOOM_STEPS,
  type ToolId,
} from "@/lib/takeoff-plan-view";
import {
  clusterByThickness,
  inchLabel,
  wallsFromStrokes,
  wallsInTheBuilding,
  wallsNotLettering,
  type WallCluster,
} from "@/lib/takeoff/wallVectors";
import { segmentsFromOpenPage } from "@/lib/takeoff/sheetStrokes";

/**
 * THE MEASURING SURFACE — a PDF page rendered to a canvas, with an SVG
 * overlay that everything is drawn and measured on.
 *
 * SVG OVER CANVAS FOR THE GEOMETRY, which is the choice `JobMediaAnnotator`
 * already argued for as "THE FIRST DRAWING SURFACE IN THIS APP": shapes stay
 * as elements, so they hit-test, they scale with a transform, and they can be
 * read out of the DOM by a test. The canvas underneath is a rendering surface
 * and nothing else — no pixel is ever read back from it, which is also why
 * the tainting caveat recorded on the photo report does not apply here.
 *
 * PDFJS IS IMPORTED INSIDE AN EFFECT, never statically. That keeps it out of
 * every server graph — so the `Can't resolve 'canvas'` build failure cannot
 * arise — and out of every other page's bundle. The LEGACY build, because the
 * modern one needs `Promise.withResolvers` (Chrome 119 / Safari 17.4) and a
 * contractor's iPad is a real device. The worker is resolved with
 * `new URL(..., import.meta.url)` so the bundler emits it and rewrites the
 * path, which makes worker/API version skew — the single most reported
 * pdf.js-in-Next failure — structurally impossible.
 *
 * ZOOMING RE-RENDERS THE PAGE rather than scaling pixels. A measuring tool is
 * zoomed in precisely so a click can be placed accurately, and a blurry
 * upscale would defeat the entire point of the feature.
 */

type Draft = { xs: number[]; ys: number[] };

const EMPTY: Draft = { xs: [], ys: [] };

/** How wide one PDF point is rendered, before zoom. 1.5 gives a legible
 * sheet on a laptop without asking pdf.js to rasterise a 42-inch drawing at
 * full resolution on first paint. */
const BASE_SCALE = 1.5;

/**
 * ── THE BOTTOM OF THIS LIST USED TO BE 0.5, AND A WHOLE SHEET DID NOT FIT ──
 *
 * These multiply `BASE_SCALE`, so the old floor of 0.5 rendered at 0.75 of full
 * size — on a 42-inch ARCH E sheet that is 3,024pt × 0.75 ≈ 2,270 CSS px, wider
 * than the viewport it sits in. The control said "50%" and the drawing still
 * ran off the edge, with no way to go further out. Reported from a real plan
 * set on 2026-10-07: "the area that displays the plans is too small and cuts
 * off most of the plans even when you zoom all the way out to 50%".
 *
 * The percentage shown is this number, not the render scale, which is why 50%
 * was never half of anything.
 */


/**
 * FIT, which is what somebody actually wants on a 42-inch sheet.
 *
 * Steps alone do not solve it: the right zoom for a whole sheet depends on the
 * sheet's size AND the window's, so no fixed list contains it. This computes
 * the exact scale that puts the full width in view, and it is a MODE rather
 * than a step for that reason — resizing the window keeps it fitted.
 *
 * Sheets are landscape and far wider than tall, so width is the binding
 * dimension; fitting height as well would shrink a 42×30 to the point of
 * uselessness on a laptop.
 */
const FIT = "fit" as const;
type Zoom = number | typeof FIT;


export function TakeoffPlanViewer({
  jobId,
  planId,
  sheets,
  printedScaleByPage,
  scalePrefillByPage,
}: {
  jobId: string;
  planId: string;
  sheets: PlanSheet[];
  /**
   * The title-block scale per PAGE NUMBER, deliberately not per sheet.
   *
   * A `PlanSheet` only exists once somebody has saved a calibration on that
   * page, so reading this off `sheet` made it null on every FIRST calibration
   * — the only time it has anything to say. See the note in
   * `takeoff-plan-view.ts`.
   */
  printedScaleByPage: PrintedScaleByPage;
  /** What each sheet said about its own scale, read off the dimensions
   *  printed on it. A PREFILL and never a calibration — see `ScalePrefill`. */
  scalePrefillByPage: ScalePrefillByPage;
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  // FIT by default. A sheet opens showing all of itself, which is what
  // somebody opening a drawing wants to see first; they zoom IN to measure.
  const [zoom, setZoom] = useState<Zoom>(FIT);
  const [tool, setTool] = useState<ToolId>("pan");

  // ── FOUND WALLS ──
  //
  // Held in component state and NEVER written anywhere until a person accepts a
  // group. A found wall is a proposal; the measurements table is for things
  // somebody chose. That also means switching sheets or reloading simply
  // forgets them, which is the correct behaviour for a proposal nobody acted on.
  const [found, setFound] = useState<WallCluster[] | null>(null);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  /** The page box, straight from the viewer — the ONLY place this number is
   * ever produced. Posted with a calibration so the scale can be named. */
  const [pageSize, setPageSize] = useState<{ widthPt: number; heightPt: number } | null>(null);
  /** The scrolling box the sheet sits in — measured, so FIT knows what it is
   *  fitting into. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const [frameHeight, setFrameHeight] = useState(0);
  const [cssWidth, setCssWidth] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const docRef = useRef<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const sheet = sheets.find((s) => s.pageNumber === pageNumber) ?? null;
  const calibration = sheet?.calibration ?? null;

  // ── Load the document once ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({
          url: `/api/takeoff/plan/${planId}`,
          // Served from this app, so the session cookie must go with it.
          // NO `withCredentials`, AND THAT IS THE FIX RATHER THAN AN OMISSION.
          // Setting it makes this a CREDENTIALED cross-origin request, and a
          // server answering one must name a specific origin -- `*` is refused
          // by the browser. Vercel Blob serves public files with `*`, so the
          // flag turns a readable file into an unreadable one. Measured in the
          // live page against a real uploaded drawing on 2026-10-05:
          //
          //   credentials: "omit"     -> 206 Partial Content, reads fine
          //   credentials: "include"  -> TypeError: Failed to fetch
          //
          // The file is public by construction (`access: "public"`), so there
          // are no credentials to send and nothing is lost by not sending
          // them. See `blobPdfCredentials.test.ts`.
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        if (cancelled) return;
        docRef.current = doc as never;
        setPageCount(doc.numPages);
      } catch (error) {
        if (cancelled) return;
        setLoadError(
          error instanceof Error && /password/i.test(error.message)
            ? "That PDF is password-protected, so it can't be opened here."
            : "That drawing couldn't be opened. It may not be a PDF, or the upload may not have finished.",
        );
        setIsRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  // ── What FIT is fitting into ──────────────────────────────────────────
  //
  // Watched rather than read once: the sheet should stay fitted when the window
  // changes, and a sidebar opening or the browser being resized both change
  // this without any render of ours.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const measure = () => {
      setFrameWidth(frame.clientWidth);
      setFrameHeight(frame.clientHeight);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  /** The multiplier in force, with FIT resolved against the measured frame.
   *  Falls back to the old default until the frame has been measured, so the
   *  first paint is never a divide by zero. */
  const zoomFactor = useMemo(() => {
    if (zoom !== FIT) return zoom;
    if (!pageSize || frameWidth === 0) return 1;
    // Decided in `fitZoom`, which is pure and tested — see its header for why
    // this fits BOTH dimensions and why that took a second attempt.
    return fitZoom({ width: frameWidth, height: frameHeight }, pageSize, BASE_SCALE);
  }, [zoom, pageSize, frameWidth, frameHeight]);

  // ── Render the current page at the current zoom ───────────────────────
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || pageCount === null) return;
    let cancelled = false;
    setIsRendering(true);

    (async () => {
      try {
        renderTaskRef.current?.cancel();
        const page = (await doc.getPage(pageNumber)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: unknown) => { promise: Promise<void>; cancel: () => void };
        };
        if (cancelled) return;

        // THE PAGE-WIDTH BOX is defined at scale 1, with pdf.js having
        // applied the page's own /Rotate. Everything stored is a fraction of
        // THIS width — see `lib/takeoff-plan.ts`.
        const unit = page.getViewport({ scale: 1 });
        setPageSize({ widthPt: unit.width, heightPt: unit.height });

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = BASE_SCALE * zoomFactor;
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${Math.round(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
        setCssWidth(Math.round(viewport.width / dpr));

        const canvasContext = canvas.getContext("2d");
        if (!canvasContext) return;
        const task = page.render({ canvasContext, viewport });
        renderTaskRef.current = task;
        await task.promise;
      } catch (error) {
        // A cancelled render is the normal result of changing page or zoom
        // quickly, not a failure worth telling anybody about.
        if (!cancelled && !(error instanceof Error && /cancel/i.test(error.message))) {
          setLoadError("That page couldn't be drawn.");
        }
      } finally {
        if (!cancelled) setIsRendering(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pageNumber, zoomFactor, pageCount]);

  // Changing page or tool abandons a half-drawn shape rather than carrying
  // points from one sheet onto another.
  useEffect(() => {
    setDraft(EMPTY);
  }, [pageNumber, tool]);

  const aspect = pageSize ? pageSize.heightPt / pageSize.widthPt : 1.294;

  /** Pointer position as page-width units — both axes divided by the
   * rendered WIDTH, which is the contract the whole feature rests on. */
  const pointAt = useCallback(
    (event: React.PointerEvent<SVGSVGElement>): { x: number; y: number } | null => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (rect.width <= 0) return null;
      return {
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.width,
      };
    },
    [],
  );

  const drawing = tool !== "pan";
  const kindOf = (id: ToolId): MeasurementKind | null =>
    id === "linear" ? "LINEAR" : id === "area" ? "AREA" : id === "count" ? "COUNT" : null;

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!drawing) return;
    const point = pointAt(event);
    if (!point) return;
    event.preventDefault();
    setDraft((current) => {
      // A calibration is exactly two points: the second click replaces the
      // end rather than extending a polyline.
      if (tool === "calibrate" && current.xs.length >= 2) {
        return { xs: [current.xs[0], point.x], ys: [current.ys[0], point.y] };
      }
      return { xs: [...current.xs, point.x], ys: [...current.ys, point.y] };
    });
  };

  const undoPoint = () =>
    setDraft((current) => ({ xs: current.xs.slice(0, -1), ys: current.ys.slice(0, -1) }));

  // ── THE FEET-PER-PAGE-WIDTH THIS SHEET IS CALIBRATED AT ──
  //
  // One derivation, used by the readout below AND by the wall finder, so the
  // two can never disagree about what the sheet's scale is.
  const feetPerUnit = useMemo(
    () => (calibration ? feetPerPageWidth(calibration as StoredCalibration) : null),
    [calibration],
  );

  /**
   * FINDING THE WALLS ON THIS SHEET.
   *
   * ── IT RUNS IN THE BROWSER, AND THAT IS NOT A SHORTCUT ──
   *
   * This component already holds the pdf.js document open to draw the sheet, so
   * the stroked lines a wall is made of are a method call away —
   * `getOperatorList()`, the same one the server-side reader uses. Detecting
   * here means no upload, no round trip, no stored proposals and no new table:
   * the drawing is already here and the answer is already in it.
   *
   * ── IT WORKS IN PAGE-WIDTH UNITS, NOT POINTS ──
   *
   * The finder only needs its coordinates and its feet-per-unit to agree with
   * each other. Converting the segments to the same 0..1 box the measurements
   * live in means the centrelines come back ready to SAVE, with no second
   * conversion anywhere for a sign or a factor to go wrong in.
   *
   * ── WHY A BUTTON RATHER THAN AUTOMATIC ──
   *
   * On the biggest sheet measured this takes about 1.7 seconds and returns 511
   * runs. Doing that unasked, on every sheet somebody opens, would be a freeze
   * nobody requested — and a found wall is a proposal, which should arrive
   * because a person asked a question.
   */
  async function onFindWalls() {
    const doc = docRef.current;
    if (!doc || !pageSize || feetPerUnit === null) return;
    setFinding(true);
    setFindError(null);
    setFound(null);
    try {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const page = await (doc as { getPage: (n: number) => Promise<unknown> }).getPage(pageNumber);
      const { segments } = await segmentsFromOpenPage(page, pdfjs, pageNumber);

      // ── WHERE THE WORDS ARE ──
      //
      // Same derivation as `planPdf.ts`: an item's own matrix composed with the
      // viewport's, whose translation is the item's position on the page as
      // displayed. `y` is reported from the TOP of the glyph, so the box is
      // grown downwards by its height.
      const viewport = (page as { getViewport: (o: { scale: number }) => { transform: number[] } }).getViewport({
        scale: 1,
      });
      const content = (await (page as { getTextContent: () => Promise<{ items: unknown[] }> }).getTextContent()) ?? {
        items: [],
      };
      const textBoxes = content.items.flatMap((raw) => {
        const item = raw as { str?: string; transform?: number[]; width?: number; height?: number };
        if (typeof item.str !== "string" || item.str.trim() === "" || !Array.isArray(item.transform)) return [];
        const m = pdfjs.Util.transform(viewport.transform, item.transform);
        const h = item.height ?? 0;
        return [
          {
            x: m[4] / pageSize.widthPt,
            y: (m[5] - h) / pageSize.widthPt,
            width: (item.width ?? 0) / pageSize.widthPt,
            height: h / pageSize.widthPt,
          },
        ];
      });
      const inUnits = segments.map((segment) => ({
        x1: segment.x1 / pageSize.widthPt,
        y1: segment.y1 / pageSize.widthPt,
        x2: segment.x2 / pageSize.widthPt,
        y2: segment.y2 / pageSize.widthPt,
        // NOT divided by the page width. The pen is compared against other
        // pens on the same sheet, never against a distance — scaling it into
        // page-width units would be arithmetic with no meaning.
        width: segment.width,
      }));
      const everywhere = wallsFromStrokes(inUnits, { feetPerPoint: feetPerUnit });
      // ONLY THE ONES IN THE BUILDING. Without this the title block, the notes
      // column, the sheet border and any detail drawn above the plan all come
      // back as walls — see `wallsInTheBuilding`, which exists because somebody
      // looked at the output rather than at its statistics.
      const inBuilding = wallsInTheBuilding(everywhere, feetPerUnit);
      // AND NOT THE LETTERING. A stroked glyph is two parallel lines and the
      // pairer takes it — two whole groups on one real sheet were dimension
      // strings and room tags. See `wallsNotLettering`.
      const walls = wallsNotLettering(inBuilding, textBoxes, feetPerUnit);
      setFound(clusterByThickness(walls));
    } catch {
      // The sheet is still on screen and the manual tools still work, so this
      // says what failed and stops — it does not take the page down.
      setFindError("The lines on this sheet couldn't be read. Trace the walls by hand as usual.");
    } finally {
      setFinding(false);
    }
  }

  /** Accepting a group writes its runs as ordinary LINEAR measurements, which
   *  is the whole point: everything downstream — the measurement list, the wall
   *  type, the height, the priced wall run — already works on those and needs
   *  no part of this. */
  async function onAcceptCluster(index: number) {
    const cluster = found?.[index];
    if (!cluster || !sheet) return;
    const body = new FormData();
    body.set("pageId", sheet.id);
    body.set("label", `${inchLabel(cluster.inches)} wall`);
    for (const run of cluster.runs) {
      body.append("shape", JSON.stringify({ xs: [run.x1, run.x2], ys: [run.y1, run.y2] }));
    }
    const result = await saveTakeoffMeasurements(jobId, body);
    if (!result.ok) return setFindError(result.error);
    // Only the accepted group leaves the list. The rest stay on screen, because
    // an estimator works through them one at a time and re-running the finder
    // to get back to where they were would be a punishment for accepting one.
    setFound((current) => (current ?? []).filter((_, i) => i !== index));
  }

  // ── What the draft currently measures, for the live readout ───────────
  const draftReading = useMemo(() => {
    if (!calibration || draft.xs.length === 0) return null;
    const stored: StoredCalibration = calibration;
    const scale = feetPerPageWidth(stored);
    if (scale === null) return null;
    if (tool === "linear" && draft.xs.length >= 2) {
      return `${(polylineLength(draft.xs, draft.ys) * scale).toFixed(1)} ft`;
    }
    if (tool === "area" && draft.xs.length >= 3) {
      if (ringSelfIntersects(draft.xs, draft.ys)) return "crosses itself";
      const area = ringArea(draft.xs, draft.ys);
      return area === null ? null : `${Math.round(area * scale * scale)} sq ft`;
    }
    if (tool === "count") return `${draft.xs.length}`;
    return null;
  }, [calibration, draft, tool]);

  const calibrationDraft: StoredCalibration | null =
    tool === "calibrate" && draft.xs.length === 2
      ? { x1: draft.xs[0], y1: draft.ys[0], x2: draft.xs[1], y2: draft.ys[1], declaredDistanceFeet: 1 }
      : null;

  const scaleReading = calibration ? readScale(calibration, sheet?.pageWidthPt ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      {/* ── Toolbar ───────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-card bg-surface-card p-2">
        <div className="flex items-center gap-1">
          {TOOLS.map((entry) => {
            const disabled = entry.id !== "pan" && entry.id !== "calibrate" && !calibration;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTool(entry.id)}
                disabled={disabled}
                title={disabled ? "Set the scale on this sheet first." : entry.hint}
                className={`rounded-md px-2 py-1 text-xs ${
                  tool === entry.id
                    ? "bg-brand text-neutral-900"
                    : "border border-line-card text-ink-label hover:bg-neutral-800"
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {entry.label}
              </button>
            );
          })}
        </div>

        <span className="mx-1 h-4 w-px bg-line-card" aria-hidden />

        {/* ── ZOOM, WITH FIT AS A FIRST-CLASS SETTING ──

            − and + step through `ZOOM_STEPS`. From FIT they step off the
            CURRENT rendered size rather than jumping to a remembered index, so
            pressing − on a fitted 42-inch sheet makes it a little smaller
            instead of suddenly enormous. */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoom(stepZoom(zoomFactor, -1))}
            disabled={zoomFactor <= ZOOM_STEPS[0]}
            aria-label="Zoom out"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center text-xs text-ink-muted" data-takeoff="zoom">
            {Math.round(zoomFactor * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom(stepZoom(zoomFactor, 1))}
            disabled={zoomFactor >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
            aria-label="Zoom in"
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => setZoom(FIT)}
            data-takeoff="fit"
            className={`ml-1 rounded-md border px-2 py-1 text-xs ${
              zoom === FIT
                ? "border-tag-amber-ink text-tag-amber-ink"
                : "border-line-card text-ink-label hover:bg-neutral-800"
            }`}
          >
            Fit
          </button>
        </div>

        {pageCount !== null && pageCount > 1 && (
          <>
            <span className="mx-1 h-4 w-px bg-line-card" aria-hidden />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
                disabled={pageNumber <= 1}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs text-ink-muted">
                Sheet {pageNumber} of {pageCount}
              </span>
              <button
                type="button"
                onClick={() => setPageNumber((n) => Math.min(pageCount, n + 1))}
                disabled={pageNumber >= pageCount}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </>
        )}

        {/* FIND THE WALLS — only once the sheet is calibrated, and the reason
            is structural rather than tidy: the finder's bounds are in FEET of
            building ("thinner than 2-1/2in is not a wall"), so without a scale
            there is no feet-per-unit and every bound means nothing. Same guard
            the measuring tools already carry, for the same reason. */}
        {/* ── SHOWN DISABLED WITHOUT A SCALE, NOT HIDDEN ──

            The gate itself is structural and unchanged: `wallVectors` asks "is
            this thinner than 2-1/2in", so without a calibration there is no
            feet-per-point and every bound in it means nothing.

            HIDING it was the mistake, and it was reported the day it shipped —
            somebody opened a sheet, went looking for the button they had been
            told about, and found nothing. No error, no explanation, just an
            absence, which reads as "this feature does not exist" rather than
            "this sheet needs a scale first". Three separate defects this week
            have had that shape; a capability nobody can see is a capability
            nobody has.

            So it is on the toolbar either way, and `title` says what is in the
            way. The measuring tools beside it already take exactly this
            posture — disabled until the sheet is calibrated, never hidden. */}
        <button
          type="button"
          onClick={onFindWalls}
          disabled={finding || !calibration}
          data-takeoff="find-walls"
          title={calibration ? undefined : "Set the scale on this sheet first — wall thickness is measured in feet of building."}
          className="min-h-[36px] rounded-md border border-line-card bg-surface px-3 text-xs font-medium text-ink-body hover:bg-rail-hover disabled:opacity-40"
        >
          {finding ? "Reading the lines…" : "Find the walls"}
        </button>

        <span className="ml-auto text-xs text-ink-muted">
          {calibration ? (
            <>
              Scale set{scaleReading?.name ? `: ${scaleReading.name}` : ""}
              {scaleReading ? ` · sheet reads ${Math.round(scaleReading.sheetWidthFeet)} ft across` : ""}
            </>
          ) : (
            <span className="text-tag-amber-ink">Set the scale on this sheet before measuring.</span>
          )}
        </span>
      </div>

      {findError && (
        <p className="mt-2 rounded-md border border-line-card bg-surface px-3 py-2 text-sm text-tag-amber-ink">
          {findError}
        </p>
      )}

      {/* ── WHAT THE SHEET GAVE UP, BIGGEST FOOTAGE FIRST ──

          ── THIS LIST IS LONGER THAN ANYBODY EXPECTS, AND THAT IS THE TRUTH ──

          The obvious design is "here are your three wall types". Seven real
          sheets were measured before this was written and they return 15 to 21
          thickness groups each, with the top three holding only about half the
          footage. Showing three and calling it the answer would hide footage an
          estimator is going to bid.

          So: sorted by FEET, biggest first, the top six shown and the rest
          counted honestly underneath. What the measurement also showed is that
          the big groups are the real ones — 4.88", 4.92" and 4.80" on three
          unrelated projects, every one of them a 4-7/8" partition, which is a
          3-5/8" stud with 5/8" board each side. Noise does not land on 4-7/8".

          That is the actual promise of this feature, and it is smaller and more
          honest than "it does your takeoff": the biggest wall types come for
          free. Accepting one group on one real sheet replaced ninety-nine hand
          traces. Whatever it missed is still traced the way it always was. */}
      {found !== null && (
        <div className="mt-2 rounded-md border border-line-card bg-surface p-3" data-takeoff="found-walls">
          {found.length === 0 ? (
            <p className="text-sm text-ink-body">
              No walls found on this sheet. That is a fact about the drawing, not a failure — a scanned or
              image-only sheet has no lines to read. Trace them by hand as usual.
            </p>
          ) : (
            <>
              <p className="mb-2 text-sm text-ink-body">
                Found {found.reduce((n, c) => n + c.runs.length, 0)} runs of wall. Each group is drawn on the
                sheet in its own colour — check it sits on real walls before adding it.
              </p>
              <ul className="flex flex-col gap-1">
                {found.slice(0, 6).map((cluster, index) => (
                  <li
                    key={`${cluster.inches}-${index}`}
                    className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1 hover:bg-rail-hover"
                    onMouseEnter={() => setHovered(index)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <span
                      aria-hidden
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: CLUSTER_COLOURS[index % CLUSTER_COLOURS.length] }}
                    />
                    <span className="text-sm font-medium text-ink">{inchLabel(cluster.inches)}</span>
                    <span className="text-sm text-ink-body">
                      {cluster.runs.length} {cluster.runs.length === 1 ? "run" : "runs"} ·{" "}
                      {Math.round(cluster.feet).toLocaleString()} ft
                    </span>
                    <button
                      type="button"
                      onClick={() => void onAcceptCluster(index)}
                      className="ml-auto min-h-[36px] rounded-md border border-line-card px-3 text-xs font-medium text-ink-body hover:bg-rail-hover"
                    >
                      Add these
                    </button>
                  </li>
                ))}
              </ul>
              {found.length > 6 && (
                <p className="mt-2 text-xs text-ink-muted">
                  And {found.length - 6} smaller {found.length - 6 === 1 ? "group" : "groups"}, holding{" "}
                  {Math.round(found.slice(6).reduce((f, c) => f + c.feet, 0)).toLocaleString()} ft between them.
                  A real floor plan carries more wall thicknesses than anybody expects; these are the ones a bid
                  usually turns on.
                </p>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => setFound(null)}
            className="mt-2 text-xs text-ink-muted underline hover:text-ink-body"
          >
            Clear what was found
          </button>
        </div>
      )}

      {/* ── The sheet ─────────────────────────────────────────────── */}
      <div
        ref={frameRef}
        className="relative max-h-[calc(var(--shell-port)-22rem)] min-h-[24rem] overflow-auto rounded-lg border border-line-card bg-neutral-900"
        data-testid="takeoff-plan-port"
      >
        {loadError ? (
          <p className="p-6 text-sm text-tag-rose-ink">{loadError}</p>
        ) : (
          <div className="relative w-fit">
            <canvas ref={canvasRef} className="block" />
            <svg
              viewBox={`0 0 1 ${aspect}`}
              preserveAspectRatio="none"
              style={{ width: cssWidth ? `${cssWidth}px` : "100%", height: cssWidth ? `${cssWidth * aspect}px` : "100%" }}
              className={`absolute left-0 top-0 ${drawing ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
              onPointerDown={onPointerDown}
            >
              {/* The calibration line, redrawn over the sheet so the scale is
                  something a reviewer can SEE rather than take on faith. */}
              {calibration && (
                <line
                  x1={calibration.x1}
                  y1={calibration.y1}
                  x2={calibration.x2}
                  y2={calibration.y2}
                  stroke="#f0b429"
                  strokeWidth={STROKE_PX}
                  strokeDasharray={`${STROKE_PX * 4} ${STROKE_PX * 2.5}`}
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {(sheet?.measurements ?? []).map((m) => (
                <Shape key={m.id} kind={m.kind} xs={m.xs} ys={m.ys} colour={m.postedAt ? "#6b7280" : "#38bdf8"} />
              ))}

              <FoundWalls clusters={found} hovered={hovered} />

              {draft.xs.length > 0 && (
                <Shape
                  kind={tool === "calibrate" ? "LINEAR" : (kindOf(tool) ?? "LINEAR")}
                  xs={draft.xs}
                  ys={draft.ys}
                  colour="#f0b429"
                  open
                />
              )}
            </svg>
          </div>
        )}
        {isRendering && !loadError && (
          <p className="absolute right-3 top-3 rounded bg-neutral-800 px-2 py-1 text-xs text-ink-muted">Drawing…</p>
        )}
      </div>

      {/* ── What the draft reads, and what to do with it ──────────── */}
      {drawing && (
        <div className="rounded-lg border border-line-card bg-surface-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs text-ink-body">
              {draft.xs.length === 0
                ? TOOLS.find((t) => t.id === tool)?.hint
                : `${draft.xs.length} point${draft.xs.length === 1 ? "" : "s"}${draftReading ? ` · ${draftReading}` : ""}`}
            </p>
            {draft.xs.length > 0 && (
              <button
                type="button"
                onClick={undoPoint}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
              >
                Undo point
              </button>
            )}
            {draft.xs.length > 0 && (
              <button
                type="button"
                onClick={() => setDraft(EMPTY)}
                className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
              >
                Clear
              </button>
            )}
          </div>

          {tool === "calibrate" && (
            <CalibrationForm
              jobId={jobId}
              planId={planId}
              pageNumber={pageNumber}
              pageWidthPt={pageSize?.widthPt ?? null}
              printedScale={printedScaleByPage[pageNumber] ?? null}
              prefill={scalePrefillByPage[pageNumber] ?? null}
              onUsePrefill={(xs, ys) => {
                // Seeds the draft so the proposed line DRAWS ON THE SHEET over
                // the dimension it was read from. That is the verification
                // channel and the reason this is two clicks rather than one:
                // an estimator should see the line sitting on `16' - 4 1/2"`
                // before agreeing to a number that multiplies through every
                // quantity on the sheet.
                setDraft({ xs: [...xs], ys: [...ys] });
              }}
              existingLabel={sheet?.label ?? ""}
              existingNote={calibration?.note ?? ""}
              draft={calibrationDraft}
              onSaved={() => {
                setDraft(EMPTY);
                setTool("pan");
              }}
            />
          )}

          {tool !== "calibrate" && sheet && draft.xs.length > 0 && (
            <MeasurementForm
              jobId={jobId}
              pageId={sheet.id}
              kind={kindOf(tool) ?? "LINEAR"}
              draft={draft}
              reading={draftReading}
              onSaved={() => setDraft(EMPTY)}
            />
          )}

          {tool !== "calibrate" && !sheet && (
            <p className="mt-2 text-xs text-tag-amber-ink">Set the scale on this sheet before measuring it.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** One shape on the overlay. `open` is a polyline still being drawn. */
/**
 * One colour per group, so the panel and the drawing refer to each other.
 *
 * Six, because a real sheet returns 15-21 thickness clusters and the panel
 * shows the biggest few — a palette per cluster would be unreadable, and these
 * are distinguishable against both a white drawing and each other. They are
 * deliberately not `DESIGN.md` status colours: these mean "group 2", not
 * "warning".
 */
const CLUSTER_COLOURS = ["#38bdf8", "#f472b6", "#a78bfa", "#34d399", "#fbbf24", "#fb923c"];

/**
 * THE FOUND WALLS, DRAWN ON THE DRAWING.
 *
 * ── THIS IS THE VERIFICATION CHANNEL, NOT DECORATION ──
 *
 * `wallVectors.ts` returns CENTRELINES rather than a number, and its header
 * says why: a wrong answer is then a line sitting where there is no wall, which
 * an estimator catches in a glance on a drawing they are already looking at. A
 * takeoff that reported "1,284 ft" and nothing else would be asking them to
 * take it on faith, and a confidently wrong number is the failure
 * `symbolCount.eval.ts` refused to ship. These lines ARE the safety argument
 * for the whole feature.
 *
 * ── AND THAT IS WHY IT IS ITS OWN COMPONENT ──
 *
 * Written inline in the viewer's SVG it could be made to render nothing and
 * every test still passed — measured, as a mutation, which is the only reason
 * anybody knew. The ghosts cannot be reached from a test that way, because they
 * only exist after a real PDF has been read. Exported, they can be handed
 * clusters and looked at. Same move as `errorBandText`: a decision inside JSX
 * is a decision no test can reach.
 *
 * Dashed, and painted under the saved measurements, so a proposal never looks
 * like something already counted.
 */
export function FoundWalls({
  clusters,
  hovered,
}: {
  clusters: WallCluster[] | null;
  hovered: number | null;
}) {
  if (clusters === null) return null;
  return (
    <>
      {clusters.map((cluster, index) =>
        cluster.runs.map((run, runIndex) => (
          <line
            key={`${index}-${runIndex}`}
            data-found-wall={index}
            x1={run.x1}
            y1={run.y1}
            x2={run.x2}
            y2={run.y2}
            stroke={CLUSTER_COLOURS[index % CLUSTER_COLOURS.length]}
            strokeWidth={hovered === index ? STROKE_PX * 2.5 : STROKE_PX}
            strokeDasharray={`${STROKE_PX * 3} ${STROKE_PX * 2}`}
            strokeOpacity={hovered === null || hovered === index ? 1 : 0.25}
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
    </>
  );
}

function Shape({
  kind,
  xs,
  ys,
  colour,
  open = false,
}: {
  kind: MeasurementKind;
  xs: number[];
  ys: number[];
  colour: string;
  open?: boolean;
}) {
  const points = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  if (kind === "COUNT") {
    return (
      <g>
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={0.006} fill={colour} fillOpacity={0.9} />
        ))}
      </g>
    );
  }
  if (kind === "AREA" && !open) {
    return (
      <polygon
        points={points}
        fill={colour}
        fillOpacity={0.18}
        stroke={colour}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
      />
    );
  }
  return (
    <g>
      <polyline
        points={points}
        fill={kind === "AREA" ? colour : "none"}
        fillOpacity={kind === "AREA" ? 0.12 : 0}
        stroke={colour}
        strokeWidth={STROKE_PX}
        vectorEffect="non-scaling-stroke"
      />
      {xs.map((x, i) => (
        <circle key={i} cx={x} cy={ys[i]} r={0.004} fill={colour} />
      ))}
    </g>
  );
}

/**
 * THE READBACK IS THE SAFEGUARD. The scale is named in the estimator's own
 * vocabulary, and the sheet width is stated in feet, while the drawing is
 * still on screen — so a wrong calibration is caught before a single quantity
 * comes off it. Every sentence here is computed by the same pure module the
 * server re-runs before saving.
 */
/**
 * WHAT THE SHEET SAID ABOUT ITS OWN SCALE, offered rather than applied.
 *
 * It shows its work, and that is the whole design. Never a bare
 * `1/8" = 1'-0"`: the dimensions that agreed are listed, because an estimator
 * can glance at the sheet and see `16' - 4 1/2"` printed where this says it is.
 * A reason nobody can check is a reason nobody can overrule — the sentence
 * `PlanSheetProposal.proposedReason` already insists on, applied to geometry.
 *
 * Pressing it draws the proposed line ON THE DRAWING and fills the box; the
 * estimator then presses the same button they press today. Two clicks against
 * today's find-a-dimension, click, click, type — and nothing reaches a quantity
 * without somebody having looked at the line, which matters because a scale
 * error multiplies through every wall on the sheet.
 */
function ScaleOffer({ prefill, onUse }: { prefill: ScalePrefill; onUse: () => void }) {
  // Both of these are PURE and live in `takeoff-plan-view.ts`, where they are
  // tested — the wording of a measured error and the order of the evidence are
  // decisions, and a decision written inline in JSX is one no test can reach.
  const band = errorBandText(prefill.inheritedError);
  const shown = evidenceOrder(prefill.agreed, prefill.declaredText);

  // ── A SCALE OFF THE TITLE BLOCK, WITH NOTHING ON THE SHEET TO CHECK IT ──
  //
  // The sentence is the whole of what makes this path acceptable. A
  // dimension-derived scale is offered with the dimensions it matched and a line
  // drawn over one of them, so an estimator verifies it by looking. A printed
  // one cannot be verified by looking at anything, and #623 declined it for
  // exactly that reason. It ships because a real bid set reads 9 of ~30 sheets
  // from dimensions while 16 more PRINT their scale — but it ships SAYING so,
  // never dressed as the other kind.
  if (prefill.unconfirmed) {
    return (
      <div className="rounded-md border border-line-card bg-surface p-2">
        <p className="text-xs text-ink-body">
          The title block on this sheet says <span className="font-semibold text-ink">{prefill.scaleName}</span>.
        </p>
        <p className="mt-1 text-[11px] text-ink-muted">
          {/* Said plainly rather than softened. The estimator is accepting a
              figure with nothing to look at, and that is their decision to make
              knowingly. */}
          Nothing measurable on this sheet confirms it —{" "}
          {/* "DID NOT AGREE" WAS THE WRONG WORD FOR THE COMMON CASE, and a
              click-through caught it: a sheet with 2 printed dimensions cannot
              agree on anything, because three are needed before a scale is
              taken seriously. Saying they disagreed invites somebody to go
              looking for a contradiction that is not there — and on the sheet
              that reported it, one of the two measured correctly. */}
          {prefill.considered === 0
            ? "no printed dimensions could be read here"
            : prefill.considered < 3
              ? `only ${prefill.considered} printed dimension${prefill.considered === 1 ? "" : "s"} could be read, ` +
                `too few to confirm a scale from`
              : `its ${prefill.considered} printed dimensions did not settle on one scale`}
          . Using it sets the scale from the printed figure alone.
        </p>
        <button
          type="button"
          onClick={onUse}
          className="mt-2 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover"
        >
          Use the printed scale
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-line-card bg-surface p-2">
      <p className="text-xs text-ink-body">
        This sheet reads <span className="font-semibold text-ink">{prefill.scaleName}</span>
        {prefill.agreed.length > 0 && (
          <>
            {" — matched "}
            {prefill.agreed.length} printed dimension{prefill.agreed.length === 1 ? "" : "s"}
            {prefill.considered > prefill.agreed.length && ` of ${prefill.considered} found`}.
          </>
        )}
      </p>
      {/* THE QUOTED DIMENSION GOES FIRST, and a click-through is why.

          This row used to be `agreed.slice(0, 6)` in whatever order the vote
          produced, while the sentence below quotes the ONE pair being proposed.
          On a sheet with 24 matched dimensions the quoted one was not among the
          six shown — "Within 0.17% on 25' - 0 1/2"" above a row that did not
          contain `25' - 0 1/2"`. Both facts were true and the pair read as a
          contradiction, which is worse than showing less. */}
      {shown.length > 0 && <p className="mt-1 text-[11px] text-ink-muted">{shown.join("   ")}</p>}
      <p className="mt-1 text-[11px] text-ink-muted">
        {/* THE BAND IS MEASURED, AND IT USED TO PRINT A FLOOR AS IF IT WERE THE
            MEASUREMENT. `band < 0.05 ? "0.05" : …` meant a pair accurate to
            0.01% was reported as "Within 0.05%" — while the note written beside
            it said 0.01%, because that one formats the real figure. A
            click-through caught the contradiction.

            Rounding UP to a floor is defensible in a progress bar and indefensible
            in a number about accuracy: it is the figure somebody would rely on,
            and it was overstating the error rather than the precision, which is
            the direction that makes the feature look worse than it is. Either
            way, two places showing one quantity differently is a defect.

            Under a hundredth of a percent now says so as an inequality rather
            than inventing a value — `toFixed(2)` on 0.004 would print "0.00",
            which claims perfection. */}
        Within {band} on {prefill.declaredText || "the dimension it read"}.
      </p>
      <button
        type="button"
        onClick={onUse}
        className="mt-2 rounded-md border border-line-card bg-surface px-2 py-1 text-xs text-ink-body hover:bg-rail-hover"
      >
        Use this dimension
      </button>
    </div>
  );
}

/**
 * STROKE WIDTH IN SCREEN PIXELS, because `vectorEffect="non-scaling-stroke"`
 * means that is the unit — and these lines were set to 0.002 of one.
 *
 * Found by a click-through of the prefill: the two end dots rendered on the
 * drawing and **the line between them did not**. The dots are plain circles
 * with `r={0.004}` in the viewBox's own units, so they scale and show. Every
 * stroked line carries `non-scaling-stroke`, which makes its width a count of
 * device pixels rather than user units — so `0.002` asked for two thousandths
 * of a pixel.
 *
 * The pairing was incoherent under either reading, which is what makes this a
 * defect rather than a taste: if the vector effect applies, the line is
 * invisible; if it did not apply, the effect was pointless. 2 is the width that
 * matches the intent the attribute was reaching for.
 *
 * This is NOT specific to the prefill — the same renderer draws every
 * hand-clicked draft and every posted measurement, so it was always this thin.
 * Nothing in this repo could have caught it: the screen suite renders in
 * happy-dom, which does no layout.
 */
const STROKE_PX = 2;

function CalibrationForm({
  jobId,
  planId,
  pageNumber,
  pageWidthPt,
  printedScale,
  existingLabel,
  existingNote,
  draft,
  prefill,
  onUsePrefill,
  onSaved,
}: {
  jobId: string;
  planId: string;
  pageNumber: number;
  pageWidthPt: number | null;
  printedScale: string | null;
  existingLabel: string;
  existingNote: string;
  draft: StoredCalibration | null;
  prefill: ScalePrefill | null;
  onUsePrefill: (xs: readonly [number, number], ys: readonly [number, number]) => void;
  onSaved: () => void;
}) {
  const [typed, setTyped] = useState("");
  /**
   * WHY THIS SCALE IS THE RIGHT ONE, and it has to survive the save.
   *
   * `TakeoffScaleCalibration.note` is described in the schema as "the one thing
   * here that records WHY this scale is the right one". Until now the prefill
   * filled the distance and left this empty, so once a scale was accepted
   * NOTHING recorded where it came from — a scale read off the title block,
   * which nothing on the sheet confirms, became indistinguishable from one
   * matched against five printed dimensions. A click-through caught it: *"the
   * toolbar doesn't show which way the scale was set."*
   *
   * That matters beyond tidiness. If a bid is ever questioned, "this came from
   * the printed figure alone" is the sentence somebody needs, and it is the one
   * sentence the estimator cannot reconstruct a week later.
   *
   * Still editable, because it is the estimator's own note and they may know
   * more than the app does.
   */
  const [note, setNote] = useState("");

  const preview = useMemo(() => {
    if (!draft) return null;
    const parsed = parseDeclared(typed);
    const line: StoredCalibration = { ...draft, declaredDistanceFeet: parsed ?? 1 };
    const notices = calibrationNotices(line, pageWidthPt, null, printedScale);
    return { notices, refusal: calibrationRefusal(notices), parsed };
  }, [draft, typed, pageWidthPt, printedScale]);

  if (!draft) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        {/* WHERE A SAVED SCALE CAME FROM, which was stored and then shown
            nowhere at all.

            Since #655 the automatic reader writes its own account into
            `note` — which dimensions it matched and how closely, or that it
            used the printed scale with nothing confirming it. That is
            provenance for a number multiplying every quantity on the sheet.

            It was only ever rendered INSIDE the draft form, and a sheet with a
            scale already set has no draft — so the moment it was saved it
            became invisible. A click-through went looking for it on two sheets
            that saved successfully and reported, correctly, that nothing on
            screen says which way a scale was set.

            Shown here rather than in the toolbar because the toolbar states
            WHAT the scale is in six words and this is a sentence; this panel is
            where somebody who doubts it has already come to look. */}
        {existingNote && (
          <p className="rounded-md border border-line-card bg-surface px-2 py-1.5 text-[11px] text-ink-muted">
            <span className="text-ink-body">How this sheet&apos;s scale was set:</span> {existingNote}
          </p>
        )}
        {prefill && (
          <ScaleOffer
            prefill={prefill}
            onUse={() => {
              onUsePrefill(prefill.xs, prefill.ys);
              // The provenance, in words, so it survives the save — see `note`
              // above for why that is not cosmetic.
              setNote(
                prefill.unconfirmed
                  ? `From the ${prefill.scaleName} printed on this sheet. Nothing measurable on the sheet ` +
                    `confirmed it.`
                  : `Matched ${prefill.agreed.length} printed dimension${prefill.agreed.length === 1 ? "" : "s"}` +
                    ` on this sheet (${prefill.agreed.slice(0, 3).join(", ")}), within ` +
                    `${(prefill.inheritedError * 100).toFixed(2)}%.`,
              );
              // A PRINTED scale's `declaredText` is the scale NAME, not a
              // distance, so typing it into the distance box would be nonsense.
              // The figure there is what the printed scale says the sheet's own
              // width is — see `scaleFromPrinted`.
              setTyped(
                prefill.unconfirmed
                  ? formatFeetInches(prefill.declaredFeet)
                  : prefill.declaredText || formatFeetInches(prefill.declaredFeet),
              );
            }}
          />
        )}
        <p className="text-xs text-ink-muted">Click once at each end of a dimension printed on the drawing.</p>
      </div>
    );
  }

  return (
    <ActionForm
      action={saveTakeoffCalibration.bind(null, jobId)}
      className="mt-3 flex flex-col gap-2"
      onSuccess={onSaved}
    >
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="pageNumber" value={pageNumber} />
      {pageWidthPt !== null && <input type="hidden" name="pageWidthPt" value={pageWidthPt} />}
      <input type="hidden" name="points" value={JSON.stringify({ xs: [draft.x1, draft.x2], ys: [draft.y1, draft.y2] })} />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          What does the drawing say that is?
          {/* inputMode is "text", not "decimal", ON PURPOSE: this field takes
              a dimension as printed — 24'-6" — and a decimal keypad has no
              foot or inch mark on it. The figure still goes through the app's
              one number parser, via `parseFeetInches`. */}
          <input
            name="declaredDistanceFeet"
            inputMode="text"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={"24'-6\""}
            className="w-32 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          Sheet name
          <input
            name="pageLabel"
            defaultValue={existingLabel}
            placeholder="A-101 First Floor"
            className="w-44 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          What you measured (optional)
          <input
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="24'-0&quot; column grid"
            className="w-52 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <SubmitButton
          type="submit"
          disabled={!preview?.parsed || Boolean(preview?.refusal)}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Set the scale
        </SubmitButton>
      </div>

      {preview && preview.parsed !== null && (
        <ul className="flex flex-col gap-0.5">
          {preview.notices.map((notice, i) => (
            <li
              key={i}
              className={`text-xs ${notice.level === "refuse" ? "text-tag-rose-ink" : "text-ink-body"}`}
            >
              {notice.message}
            </li>
          ))}
          <li className="text-xs text-ink-muted">
            Reading that back: {formatFeetInches(preview.parsed)}.
          </li>
        </ul>
      )}
    </ActionForm>
  );
}

/** Saves one finished shape. The geometry rides as JSON; nothing numeric the
 * person typed goes anywhere but through the app's parser on the server. */
function MeasurementForm({
  jobId,
  pageId,
  kind,
  draft,
  reading,
  onSaved,
}: {
  jobId: string;
  pageId: string;
  kind: MeasurementKind;
  draft: Draft;
  reading: string | null;
  onSaved: () => void;
}) {
  const problem = verticesProblem(kind, draft.xs, draft.ys);
  const crosses = kind === "AREA" && !problem && ringSelfIntersects(draft.xs, draft.ys);

  return (
    <ActionForm action={saveTakeoffMeasurement.bind(null, jobId)} className="mt-3 flex flex-col gap-2" onSuccess={onSaved}>
      <input type="hidden" name="pageId" value={pageId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="points" value={JSON.stringify(draft)} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          {kind === "COUNT" ? "What are you counting?" : "Name this measurement (optional)"}
          <input
            name="label"
            placeholder={kind === "COUNT" ? "can light" : "North corridor"}
            className="w-56 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
        <SubmitButton
          type="submit"
          disabled={Boolean(problem) || crosses}
          className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900 disabled:opacity-50"
        >
          Save {reading ? `(${reading})` : "measurement"}
        </SubmitButton>
      </div>
      {problem && <p className="text-xs text-ink-muted">{problem}</p>}
      {crosses && (
        <p className="text-xs text-tag-rose-ink">
          That outline crosses itself, so it has no area. Undo back past the crossing, or clear and draw it again.
        </p>
      )}
    </ActionForm>
  );
}

/** The typed dimension, for the PREVIEW only — the figure that is saved is
 * parsed again on the server by the SAME reader, so the sentence on screen
 * and the number stored cannot disagree. Null while the field is still being
 * typed into, so the readback appears rather than flickering a refusal at
 * every keystroke.
 */
function parseDeclared(typed: string): number | null {
  if (!typed.trim()) return null;
  const parsed = parseFeetInches(typed);
  return parsed.ok ? parsed.n : null;
}
