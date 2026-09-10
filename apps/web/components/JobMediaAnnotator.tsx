"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveJobMediaAnnotations } from "@/lib/actions";
import { JobMediaMarks, type JobMediaMark } from "@/components/JobMediaMarks";
import {
  JOB_MEDIA_ANNOTATIONS_MAX,
  JOB_MEDIA_ANNOTATION_LABEL_MAX,
  JOB_MEDIA_ANNOTATION_KINDS,
  annotationProblem,
  annotationProblemMessage,
  annotationSetProblemMessage,
  isTwoPointKind,
  requiresLabel,
  type JobMediaAnnotationInput,
  type JobMediaAnnotationKind,
} from "@/lib/job-media-annotations";

/**
 * Drawing on a photo with a thumb.
 *
 * THE FIRST DRAWING SURFACE IN THIS APP, so a few things are decided here
 * for the first time and are worth arguing with rather than inheriting.
 *
 * SVG AND POINTER EVENTS, NOT `<canvas>`. A canvas would mean managing a
 * bitmap, redrawing on every resize, and reimplementing hit-testing to
 * delete a mark. The marks are a handful of vector shapes stored as
 * fractions, so the DOM already holds exactly the right model and the same
 * `JobMediaMarks` the gallery and the portal render is what draws them
 * here — one renderer, so the preview cannot disagree with the result.
 *
 * POINTER EVENTS, not mouse or touch: one code path covers a finger, a
 * stylus and a mouse, and `setPointerCapture` is what makes a drag that
 * leaves the photo still end sensibly rather than sticking.
 *
 * `touch-none` IS LOAD-BEARING, not styling. Without it the browser claims
 * a drag on an image as a scroll or a pinch, and the first stroke somebody
 * tries on a phone scrolls the page instead of drawing — which reads as the
 * feature being broken.
 *
 * EVERY MARK IS A FRACTION OF THE IMAGE, converted at the moment of the
 * pointer event from the element's own box. Nothing here knows the photo's
 * pixel size and nothing needs to: see the schema comment on `x1`.
 */

type Draft = JobMediaAnnotationInput & { id: string };

const TOOL_LABEL: Record<JobMediaAnnotationKind, string> = {
  ARROW: "Arrow",
  BOX: "Highlight",
  TEXT: "Label",
  MEASURE: "Measurement",
};

const TOOL_HINT: Record<JobMediaAnnotationKind, string> = {
  ARROW: "Drag from anywhere to the thing you mean.",
  BOX: "Drag a box around it.",
  TEXT: "Tap where the words go.",
  MEASURE: "Drag along what you measured, then type the figure.",
};

let draftSeq = 0;

export function JobMediaAnnotator({
  mediaId,
  blobUrl,
  alt,
  initialMarks,
  onDone,
}: {
  mediaId: string;
  blobUrl: string;
  alt: string;
  initialMarks: JobMediaMark[];
  onDone: () => void;
}) {
  const [tool, setTool] = useState<JobMediaAnnotationKind>("ARROW");
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    initialMarks.map((m) => ({ ...m, id: `existing-${m.id}` })),
  );
  const [drawing, setDrawing] = useState<Draft | null>(null);
  const [pendingLabel, setPendingLabel] = useState<Draft | null>(null);
  const [labelText, setLabelText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  /** The image's width/height as it sits on screen, which for an
   *  `object-contain` box is the photo's own ratio. Read at draw time
   *  rather than stored: the arrow head needs it and nothing else does. */
  function aspect(): number {
    const box = surfaceRef.current?.getBoundingClientRect();
    if (!box || box.height === 0) return 1;
    return box.width / box.height;
  }

  /** A pointer event as a fraction of the photo, clamped to it. Clamping
   *  HERE is right even though the validator refuses out-of-range marks:
   *  a finger that slides off the edge mid-drag meant the edge, and the
   *  validator's job is to refuse a payload, not to interpret a gesture. */
  function pointAt(event: React.PointerEvent): { x: number; y: number } {
    const box = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)),
    };
  }

  function begin(event: React.PointerEvent) {
    if (isPending || pendingLabel) return;
    const capped = annotationSetProblemMessage(drafts.length + 1);
    if (capped) {
      setError(capped);
      return;
    }
    setError(null);
    const { x, y } = pointAt(event);
    const draft: Draft = {
      id: `draft-${++draftSeq}`,
      kind: tool,
      x1: x,
      y1: y,
      x2: isTwoPointKind(tool) ? x : null,
      y2: isTwoPointKind(tool) ? y : null,
      label: null,
    };

    if (!isTwoPointKind(tool)) {
      // A one-point mark is finished the moment it is placed; the words are
      // the only thing left to ask for.
      setPendingLabel(draft);
      setLabelText("");
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing(draft);
  }

  function move(event: React.PointerEvent) {
    if (!drawing) return;
    const { x, y } = pointAt(event);
    setDrawing({ ...drawing, x2: x, y2: y });
  }

  function end() {
    if (!drawing) return;
    const problem = annotationProblem(drawing);
    if (problem) {
      // A stray tap is the common case here, and it should cost nothing —
      // no error, no mark, just nothing happened.
      setError(problem === "degenerate" ? null : annotationProblemMessage(problem));
      setDrawing(null);
      return;
    }
    if (requiresLabel(drawing.kind)) {
      setPendingLabel(drawing);
      setLabelText("");
      setDrawing(null);
      return;
    }
    setDrafts((current) => [...current, drawing]);
    setDrawing(null);
  }

  function commitLabel() {
    if (!pendingLabel) return;
    const mark = { ...pendingLabel, label: labelText };
    const problem = annotationProblem(mark);
    if (problem) {
      setError(annotationProblemMessage(problem));
      return;
    }
    setDrafts((current) => [...current, mark]);
    setPendingLabel(null);
    setLabelText("");
    setError(null);
  }

  const preview: JobMediaMark[] = [...drafts, ...(drawing ? [drawing] : [])].map((d) => ({
    id: d.id,
    kind: d.kind,
    x1: d.x1,
    y1: d.y1,
    x2: d.x2,
    y2: d.y2,
    label: d.label,
  }));

  return (
    <div className="flex flex-col gap-3">
      {/* The photo at its own ratio rather than the card's 4:3 crop — you
          cannot mark up a picture whose edges you cannot see. */}
      <div
        ref={surfaceRef}
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="relative w-full touch-none select-none overflow-hidden rounded-md bg-black"
        style={{ aspectRatio: "4 / 3" }}
      >
        {/* A plain <img>, not next/image: this one is measured by
            `getBoundingClientRect` and sized by `object-contain`, and the
            gallery's own comment explains why the optimizer is out of the
            picture for these blobs anyway. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={blobUrl} alt={alt} className="h-full w-full object-contain" draggable={false} />
        <JobMediaMarks marks={preview} aspect={aspect()} />
      </div>

      <p className="text-sm text-slate-400">{TOOL_HINT[tool]}</p>

      <div className="flex flex-wrap gap-2">
        {JOB_MEDIA_ANNOTATION_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => {
              setTool(kind);
              setError(null);
            }}
            aria-pressed={tool === kind}
            className={`min-h-11 rounded-md border px-3 text-sm ${
              tool === kind
                ? "border-blue-500 text-blue-400"
                : "border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            {TOOL_LABEL[kind]}
          </button>
        ))}
      </div>

      {pendingLabel && (
        <div className="flex flex-col gap-2 rounded-md border border-slate-700 p-3">
          <label className="text-sm text-slate-300" htmlFor={`label-${mediaId}`}>
            {pendingLabel.kind === "MEASURE"
              ? "What does it measure? Type it as you would write it — the app does not measure anything itself."
              : "What does it say?"}
          </label>
          <input
            id={`label-${mediaId}`}
            autoFocus
            value={labelText}
            maxLength={JOB_MEDIA_ANNOTATION_LABEL_MAX}
            onChange={(e) => setLabelText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitLabel();
              }
            }}
            placeholder={pendingLabel.kind === "MEASURE" ? "3 ft 6 in" : "Rework this joint"}
            className="min-h-11 rounded-md border border-slate-700 bg-slate-950 px-3 text-base text-slate-100"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={commitLabel}
              className="min-h-11 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500"
            >
              Add it
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingLabel(null);
                setLabelText("");
                setError(null);
              }}
              className="min-h-11 rounded-md border border-slate-700 px-3 text-sm text-slate-300"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <p className="text-sm text-slate-400">
        {drafts.length} of {JOB_MEDIA_ANNOTATIONS_MAX} marks.{" "}
        {drafts.length > 0 && "Undo removes the last one."}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              try {
                const result = await saveJobMediaAnnotations(
                  mediaId,
                  drafts.map(({ kind, x1, y1, x2, y2, label }) => ({ kind, x1, y1, x2, y2, label })),
                );
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                router.refresh();
                onDone();
              } catch {
                setError("Could not save these marks");
              }
            });
          }}
          className="min-h-11 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Save marks"}
        </button>
        <button
          type="button"
          disabled={isPending || drafts.length === 0}
          onClick={() => {
            setDrafts((current) => current.slice(0, -1));
            setError(null);
          }}
          className="min-h-11 rounded-md border border-slate-700 px-3 text-sm text-slate-300 disabled:opacity-50"
        >
          Undo
        </button>
        <button
          type="button"
          disabled={isPending || drafts.length === 0}
          onClick={() => {
            setDrafts([]);
            setError(null);
          }}
          className="min-h-11 rounded-md border border-slate-700 px-3 text-sm text-slate-300 disabled:opacity-50"
        >
          Clear all
        </button>
        <button
          type="button"
          disabled={isPending}
          onClick={onDone}
          className="min-h-11 rounded-md border border-slate-700 px-3 text-sm text-slate-300 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {/* Said here, at the moment somebody is deciding to draw, rather than
          only in a schema comment nobody on a roof will read. */}
      <p className="text-sm text-slate-400">
        Marks are saved beside the photo, not burned into it — the original file is never changed,
        and anyone who downloads it gets the picture without the markup.
      </p>
    </div>
  );
}
