"use client";

import { useEffect, useRef, useState } from "react";
import { ensureSheetPages } from "@/lib/actions";
import { SheetPinViewer } from "./SheetPinViewer";
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

  return (
    <div className="space-y-3">
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
