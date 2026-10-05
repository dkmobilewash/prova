"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createSheetPin, deleteSheetPin } from "@/lib/actions";
import { describePin, type SheetPinKind } from "@/lib/sheet-pins";
import { ConfirmDeleteButton } from "./ConfirmDeleteButton";
import { Spinner } from "./Spinner";

/**
 * THE SHEET, AND THE MARKS ON IT.
 *
 * A canvas underneath (the real PDF page, through pdfjs) and an SVG overlay on
 * top. The overlay is SVG rather than more canvas DELIBERATELY, copying
 * `TakeoffPlanViewer`: a canvas drawing is pixels no test can read, while every
 * pin here is an element with its own `data-pin-id` that a test — or a person
 * with devtools — can find. The same decision is why that component's geometry
 * is assertable at all.
 *
 * COORDINATES. A click is stored as `x = offsetX / renderedWidth` and
 * `y = offsetY / renderedWidth` — BOTH divided by the width. See
 * `lib/sheet-geometry.ts`; `y` is not a fraction of the height, and a square
 * sheet is the one case where getting that wrong still looks right.
 *
 * pdfjs is imported inside the effect so it never enters a server graph — the
 * `Can't resolve 'canvas'` build failure `plan-ingest/planPdf.ts` documents.
 */

type Pin = {
  id: string;
  x: number;
  y: number;
  kind: SheetPinKind;
  note: string | null;
  mediaId: string | null;
  punchItemId: string | null;
  punchItem: { description: string } | null;
};

type Props = {
  fileUrl: string;
  page: { id: string; pageNumber: number; widthPt: number; heightPt: number; imageUrl: string | null };
  pins: Pin[];
};

const PIN_COLOUR: Record<SheetPinKind, string> = {
  PHOTO: "#38bdf8",
  PUNCH: "#fb923c",
  NOTE: "#a78bfa",
};

export function SheetPinViewer({ fileUrl, page, pins }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [placing, setPlacing] = useState<SheetPinKind | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const aspect = page.heightPt / page.widthPt;

  useEffect(() => {
    let cancelled = false;

    // THE PREPARED PICTURE IS THE FAST PATH, AND ON A REAL SET IT IS THE ONLY
    // USABLE ONE.
    //
    // Rendering the PDF here downloads the WHOLE PDF. Measured on production
    // on 2026-10-05 against a real 113-sheet set: 46,337,022 bytes, one
    // request, 138 SECONDS, to display one sheet.
    //
    // AND IT CANNOT BE FIXED WITH RANGE REQUESTS, which is the obvious answer
    // and was measured before being believed. Vercel Blob honours a range
    // (`Range: bytes=0-1023` -> 206, exactly 1024 bytes returned). But
    // `Accept-Ranges` and `Content-Range` are not CORS-safelisted response
    // headers and the store sends no `Access-Control-Expose-Headers`, so
    // cross-origin JavaScript cannot read them. The headers visible to JS are
    // exactly: cache-control, content-length, content-type, last-modified.
    //
    // pdf.js decides whether to range-fetch by reading `Accept-Ranges` off the
    // response (`validateRangeRequestCapabilities`). It sees nothing, concludes
    // ranges are unsupported, and streams the entire file -- and
    // `disableAutoFetch` does nothing in that state. Do not add it here
    // expecting a fix.
    //
    // So the viewer shows the PNG that "Prepare for the phone" already makes
    // for the phone: one artefact, both surfaces. The PDF path below stays for
    // a revision nobody has prepared yet, and that is the only time those 46MB
    // are pulled.
    if (page.imageUrl) {
      const box = boxRef.current;
      if (box) setWidth(box.clientWidth);
      return;
    }

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({
          url: fileUrl,
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
        const pdfPage = await doc.getPage(page.pageNumber);
        const canvas = canvasRef.current;
        const box = boxRef.current;
        if (!canvas || !box) return;
        const target = box.clientWidth;
        const unit = pdfPage.getViewport({ scale: 1 });
        const dpr = window.devicePixelRatio || 1;
        const viewport = pdfPage.getViewport({ scale: (target / unit.width) * dpr });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        canvas.style.width = `${target}px`;
        canvas.style.height = `${Math.round(viewport.height / dpr)}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await pdfPage.render({ canvasContext: ctx, viewport }).promise;
        if (!cancelled) setWidth(target);
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof Error && /password/i.test(err.message)
              ? "That PDF is password-protected, so it can't be opened here."
              : "That sheet couldn't be opened. It may not be a PDF, or the upload may not have finished.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUrl, page.pageNumber, page.imageUrl]);

  const onSheetClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!placing || width === 0) return;
      const rect = event.currentTarget.getBoundingClientRect();
      // BOTH axes over the WIDTH. This is the line the whole feature turns on.
      setDraft({
        x: (event.clientX - rect.left) / rect.width,
        y: (event.clientY - rect.top) / rect.width,
      });
      setError(null);
    },
    [placing, width],
  );

  async function save() {
    if (!draft || !placing) return;
    setBusy(true);
    setError(null);
    const data = new FormData();
    data.set("kind", placing);
    data.set("x", String(draft.x));
    data.set("y", String(draft.y));
    if (placing === "NOTE") data.set("note", note);
    const result = await createSheetPin(page.id, data);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDraft(null);
    setPlacing(null);
    setNote("");
  }

  async function remove(pinId: string) {
    setBusy(true);
    const result = await deleteSheetPin(pinId);
    setBusy(false);
    if (!result.ok) setError(result.error);
  }

  if (loadError) {
    return (
      <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{loadError}</p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(["PHOTO", "PUNCH", "NOTE"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => {
              setPlacing(placing === kind ? null : kind);
              setDraft(null);
              setError(null);
            }}
            aria-pressed={placing === kind}
            className={`rounded-md border px-3 py-2 text-sm ${
              placing === kind
                ? "border-sky-400 bg-sky-400/15 text-sky-100"
                : "border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            {placing === kind ? `Tap the sheet to place a ${kind.toLowerCase()} pin` : `Pin a ${kind.toLowerCase()}`}
          </button>
        ))}
      </div>

      <div
        ref={boxRef}
        onClick={onSheetClick}
        data-testid="sheet-surface"
        className={`relative w-full overflow-hidden rounded-md border border-slate-700 ${
          placing ? "cursor-crosshair" : ""
        }`}
        style={{ aspectRatio: `${page.widthPt} / ${page.heightPt}` }}
      >
        {page.imageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element --
             the sheet is a blob URL of unknown pixel dimensions sitting in an
             aspect-ratio box that already comes from the PDF's own page size.
             next/image would want width/height it cannot know and would add an
             optimiser round-trip to a file we already sized ourselves. */
          <img
            src={page.imageUrl}
            alt={`Sheet ${page.pageNumber}`}
            className="block w-full"
            onLoad={() => {
              const box = boxRef.current;
              if (box) setWidth(box.clientWidth);
            }}
          />
        ) : (
          <canvas ref={canvasRef} className="block w-full" />
        )}
        {width > 0 && (
          <svg
            className="pointer-events-none absolute inset-0"
            width={width}
            height={width * aspect}
            data-testid="sheet-overlay"
          >
            {pins.map((pin) => (
              <g key={pin.id} data-pin-id={pin.id} data-pin-kind={pin.kind}>
                <circle cx={pin.x * width} cy={pin.y * width} r={9} fill={PIN_COLOUR[pin.kind]} opacity={0.9} />
                <circle cx={pin.x * width} cy={pin.y * width} r={9} fill="none" stroke="#0f172a" strokeWidth={2} />
              </g>
            ))}
            {draft && (
              <circle
                cx={draft.x * width}
                cy={draft.y * width}
                r={9}
                fill="none"
                stroke="#e2e8f0"
                strokeDasharray="3 3"
                strokeWidth={2}
                data-testid="draft-pin"
              />
            )}
          </svg>
        )}
      </div>

      {draft && placing === "NOTE" && (
        <label className="block text-sm text-slate-300">
          What should this note say?
          <input
            name="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
            inputMode="text"
            placeholder="Hold this wall for the owner's millwork"
          />
        </label>
      )}

      {draft && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setError(null);
            }}
            className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Spinner />
                Saving…
              </>
            ) : (
              "Place pin"
            )}
          </button>
        </div>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}

      {pins.length === 0 ? (
        <p className="text-sm text-slate-400">
          Nothing is pinned on this sheet yet. Pick what to pin, then tap the drawing.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800 rounded-md border border-slate-800">
          {pins.map((pin) => (
            <li key={pin.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="text-slate-200">
                <span
                  className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                  style={{ backgroundColor: PIN_COLOUR[pin.kind] }}
                  aria-hidden
                />
                {/* The kind is a WORD as well as a colour. A status carried by
                    colour alone is unreadable to a third of the people holding
                    the phone, and unreadable to everyone in direct sun. */}
                <span className="text-slate-400">{pin.kind.toLowerCase()}</span> — {describePin(pin)}
              </span>
              {/* The shared control rather than a hand-rolled pair: it owns
                  the armed geometry, including the full-width COLUMN with
                  Cancel on top below 640px. CLAUDE.md's "Cancel inherits the
                  delete pixel" entry is three measured corrections deep, and
                  none of them is reproducible by eye. The label stays SHORT —
                  what is going belongs in `describe`, which costs no width. */}
              <ConfirmDeleteButton
                label="Remove"
                confirmLabel="Remove it"
                describe={`Takes this ${pin.kind.toLowerCase()} pin off the sheet. What it points at is not deleted.`}
                action={() => remove(pin.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
