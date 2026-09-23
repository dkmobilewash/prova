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
import { saveTakeoffCalibration, saveTakeoffMeasurement } from "@/lib/actions";
import type { PlanSheet } from "@/lib/takeoff-plan-view";
import { TOOLS, type ToolId } from "@/lib/takeoff-plan-view";

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
const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

export function TakeoffPlanViewer({
  jobId,
  planId,
  sheets,
}: {
  jobId: string;
  planId: string;
  sheets: PlanSheet[];
}) {
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [zoomIndex, setZoomIndex] = useState(2);
  const [tool, setTool] = useState<ToolId>("pan");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  /** The page box, straight from the viewer — the ONLY place this number is
   * ever produced. Posted with a calibration so the scale can be named. */
  const [pageSize, setPageSize] = useState<{ widthPt: number; heightPt: number } | null>(null);
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
          withCredentials: true,
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
        const scale = BASE_SCALE * ZOOM_STEPS[zoomIndex];
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
  }, [pageNumber, zoomIndex, pageCount]);

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

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setZoomIndex((i) => Math.max(0, i - 1))}
            disabled={zoomIndex === 0}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
          >
            −
          </button>
          <span className="w-12 text-center text-xs text-ink-muted">{Math.round(ZOOM_STEPS[zoomIndex] * 100)}%</span>
          <button
            type="button"
            onClick={() => setZoomIndex((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-40"
          >
            +
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

      {/* ── The sheet ─────────────────────────────────────────────── */}
      <div
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
                  strokeWidth={0.003}
                  strokeDasharray="0.01 0.006"
                  vectorEffect="non-scaling-stroke"
                />
              )}

              {(sheet?.measurements ?? []).map((m) => (
                <Shape key={m.id} kind={m.kind} xs={m.xs} ys={m.ys} colour={m.postedAt ? "#6b7280" : "#38bdf8"} />
              ))}

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
              existingLabel={sheet?.label ?? ""}
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
    return <polygon points={points} fill={colour} fillOpacity={0.18} stroke={colour} strokeWidth={0.002} vectorEffect="non-scaling-stroke" />;
  }
  return (
    <g>
      <polyline
        points={points}
        fill={kind === "AREA" ? colour : "none"}
        fillOpacity={kind === "AREA" ? 0.12 : 0}
        stroke={colour}
        strokeWidth={0.002}
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
function CalibrationForm({
  jobId,
  planId,
  pageNumber,
  pageWidthPt,
  existingLabel,
  draft,
  onSaved,
}: {
  jobId: string;
  planId: string;
  pageNumber: number;
  pageWidthPt: number | null;
  existingLabel: string;
  draft: StoredCalibration | null;
  onSaved: () => void;
}) {
  const [typed, setTyped] = useState("");

  const preview = useMemo(() => {
    if (!draft) return null;
    const parsed = parseDeclared(typed);
    const line: StoredCalibration = { ...draft, declaredDistanceFeet: parsed ?? 1 };
    const notices = calibrationNotices(line, pageWidthPt, null);
    return { notices, refusal: calibrationRefusal(notices), parsed };
  }, [draft, typed, pageWidthPt]);

  if (!draft) {
    return <p className="mt-2 text-xs text-ink-muted">Click once at each end of a dimension printed on the drawing.</p>;
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
