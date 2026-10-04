"use client";

import { useEffect, useRef, useState } from "react";
import { ensureSheetPages, rasteriseNextSheet } from "@/lib/actions";
import { SheetPinViewer } from "./SheetPinViewer";
import { Spinner } from "./Spinner";
import type { SheetPinKind } from "@/lib/sheet-pins";

/**
 * THE STEP BETWEEN "A PDF EXISTS" AND "A SHEET CAN BE PINNED ON".
 *
 * A `DrawingRevision` is a file; a pin needs a `SheetPage` to sit on. Rather
 * than a server-side PDF parse — which would mean carrying `@napi-rs/canvas`
 * (see `lib/plan-ingest/planPdf.ts`) — this reads the page count and each
 * page's size from the pdfjs the browser is already using to DISPLAY the
 * drawing, and records them once.
 *
 * It runs only when there are no pages yet, and `createMany({skipDuplicates})`
 * behind a unique key means two people opening the same revision at the same
 * moment cannot double-write. The router refresh is what turns the recorded
 * pages into a rendered sheet without the person pressing anything.
 */

type Page = {
  id: string;
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  imageUrl: string | null;
  pins: {
    id: string;
    x: number;
    y: number;
    kind: SheetPinKind;
    note: string | null;
    mediaId: string | null;
    punchItemId: string | null;
    punchItem: { description: string } | null;
  }[];
};

export function SheetPinSurface({
  revisionId,
  fileUrl,
  pages,
}: {
  revisionId: string;
  fileUrl: string;
  pages: Page[];
}) {
  const [index, setIndex] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(pages.length === 0);
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (pages.length > 0 || attempted.current) return;
    attempted.current = true;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/legacy/build/pdf.worker.mjs",
          import.meta.url,
        ).toString();
        const doc = await pdfjs.getDocument({
          url: fileUrl,
          withCredentials: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        }).promise;
        const read: { pageNumber: number; widthPt: number; heightPt: number }[] = [];
        for (let n = 1; n <= doc.numPages; n += 1) {
          const page = await doc.getPage(n);
          const unit = page.getViewport({ scale: 1 });
          read.push({ pageNumber: n, widthPt: unit.width, heightPt: unit.height });
        }
        if (cancelled) return;
        const result = await ensureSheetPages(revisionId, read);
        if (cancelled) return;
        if (!result.ok) {
          setError(result.error);
          setPreparing(false);
          return;
        }
        // The server now has the pages; re-render from it rather than guessing
        // their ids here.
        window.location.reload();
      } catch {
        if (!cancelled) {
          setError("That drawing couldn't be opened, so its sheets couldn't be read.");
          setPreparing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pages.length, fileUrl, revisionId]);

  if (error) {
    return <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>;
  }
  if (preparing) {
    return <p className="text-sm text-slate-400">Reading the sheets in this drawing…</p>;
  }
  if (pages.length === 0) {
    return <p className="text-sm text-slate-400">No sheets were found in this drawing.</p>;
  }

  const page = pages[Math.min(index, pages.length - 1)];
  const unrendered = pages.filter((p) => p.imageUrl === null).length;

  async function renderForThePhone() {
    setRendering(true);
    setRenderError(null);
    // One sheet per call — see `rasteriseNextSheet`. Walk until it stops
    // finding work, so a set of thirty sheets does not need thirty clicks.
    for (let i = 0; i < pages.length; i += 1) {
      const result = await rasteriseNextSheet(revisionId);
      if (!result.ok) {
        setRenderError(result.error);
        setRendering(false);
        return;
      }
    }
    setRendering(false);
    window.location.reload();
  }

  return (
    <div className="space-y-3">
      {unrendered > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm">
          <span className="text-slate-300">
            {/* The phone cannot open a PDF, so a sheet is only usable in the
                field once it has been rendered to an image. Said in those
                words rather than "not processed", which tells a foreman
                nothing about what they can and cannot do on site. */}
            {unrendered} of {pages.length} {pages.length === 1 ? "sheet is" : "sheets are"} not ready for the
            phone yet.
          </span>
          <button
            type="button"
            onClick={renderForThePhone}
            disabled={rendering}
            className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {rendering ? (
              <>
                <Spinner />
                Preparing…
              </>
            ) : (
              "Prepare for the phone"
            )}
          </button>
          {renderError && <span className="text-rose-300">{renderError}</span>}
        </div>
      )}
      {pages.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Sheet</span>
          {pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index}
              className={`rounded-md border px-3 py-2 text-sm ${
                i === index
                  ? "border-sky-400 bg-sky-400/15 text-sky-100"
                  : "border-slate-700 text-slate-300 hover:border-slate-500"
              }`}
            >
              {p.pageNumber}
              {p.pins.length > 0 && <span className="ml-1 text-xs text-slate-400">({p.pins.length})</span>}
            </button>
          ))}
        </div>
      )}
      <SheetPinViewer fileUrl={fileUrl} page={page} pins={page.pins} />
    </div>
  );
}
