"use client";

import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { storeSheetImage, uploadDrawingPdf } from "@/lib/actions";
import { SheetPinViewer } from "./SheetPinViewer";
import { Spinner } from "./Spinner";
import type { SheetPinKind } from "@/lib/sheet-pins";

/**
 * THE STEP BETWEEN "A REVISION EXISTS" AND "A SHEET CAN BE PINNED ON".
 *
 * A drawing is UPLOADED here, into our own blob store, the way photos already
 * are. The alternative — a link to wherever it lives — is what the form has
 * always offered and it cannot support pinning, for two separate reasons both
 * measured on production on 2026-10-05: a browser cannot read a cross-origin
 * PDF without `Access-Control-Allow-Origin`, and a server cannot fetch one
 * that is behind a login.
 *
 * **AND THE FILE GOES STRAIGHT TO THE STORE, NOT THROUGH A FUNCTION.** The
 * first version posted it to a Server Action as FormData. That cannot work at
 * any size worth having: a Server Action body defaults to 1MB and Vercel caps
 * a serverless request body at 4.5MB regardless, while a single sheet is
 * bigger than that and a set is 10-100MB. `upload()` asks
 * `/api/drawings/upload` for a short-lived token and sends the bytes directly;
 * the action afterwards carries only a URL.
 *
 * **EVERYTHING IS DRAWN HERE, AND THAT IS THE POINT.** The browser doing the
 * upload has the file in its hand, so it reads the page sizes and renders each
 * page with the canvas it has natively — no fetch, no CORS, and no
 * `@napi-rs/canvas` on the server. The server-side rasteriser this replaced
 * needed that package, which needed `serverExternalPackages`, which stopped
 * Vercel tracing the binary into the function: a runtime failure with
 * typecheck, 8,900 tests and a full build all green.
 *
 * The phone is why the pictures exist at all: `apps/mobile` has no PDF
 * renderer and no WebView, so a sheet reaches the field as an `<Image>` with
 * an SVG overlay.
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

/** How wide each sheet picture is drawn, in pixels.
 *
 * A compromise, and it should be read as one. A D-size sheet is 42 inches
 * wide, so 2000px is about 48 dpi — enough to find a wall and drop a pin on
 * it, not enough to read a dimension string. The phone shows it at ~390pt, so
 * this is roughly 5x what the screen has. Raising it is one number and it is
 * paid for on a tower crane with one bar of signal. */
const SHEET_WIDTH_PX = 2000;

async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();
  return pdfjs;
}

export function SheetPinSurface({
  revisionId,
  fileUrl,
  pages,
}: {
  revisionId: string;
  fileUrl: string | null;
  pages: Page[];
}) {
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function uploadDrawing(file: File) {
    setError(null);

    // THREE OPERATIONS, THREE MESSAGES. These were one try/catch, and when
    // Diego's first real drawing failed on the upload it reported "that file
    // could not be read as a PDF" -- sending the investigation at the file
    // instead of at the 1MB body limit that actually refused it. This repo had
    // already paid for that exact mistake once today, in `sheetPins.ts`, and
    // it was repeated here within the hour. A catch around two operations
    // tells you which one failed only by accident.
    let read: { pageNumber: number; widthPt: number; heightPt: number }[];
    try {
      setBusy("Reading the drawing…");
      const pdfjs = await loadPdfjs();
      // From the FILE, not from a URL. No request leaves the browser, so
      // nothing here depends on where the drawing came from.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
      read = [];
      for (let n = 1; n <= doc.numPages; n += 1) {
        const page = await doc.getPage(n);
        const unit = page.getViewport({ scale: 1 });
        read.push({ pageNumber: n, widthPt: unit.width, heightPt: unit.height });
      }
    } catch {
      setError("That file could not be read as a PDF.");
      setBusy(null);
      return;
    }

    let uploaded: { url: string };
    try {
      setBusy(`Uploading the drawing (${read.length} ${read.length === 1 ? "sheet" : "sheets"})…`);
      uploaded = await upload(`drawings/${revisionId}/${file.name || "drawing.pdf"}`, file, {
        access: "public",
        handleUploadUrl: "/api/drawings/upload",
        clientPayload: revisionId,
      });
    } catch (cause) {
      // The route's own sentence when it has one -- a permission or session
      // problem should say so rather than being flattened into "upload
      // failed".
      setError(cause instanceof Error ? cause.message : "That drawing could not be uploaded.");
      setBusy(null);
      return;
    }

    setBusy("Recording the sheets…");
    const saved = await uploadDrawingPdf(revisionId, uploaded.url, file.name || "drawing.pdf", JSON.stringify(read));
    if (!saved.ok) {
      setError(saved.error);
      setBusy(null);
      return;
    }

    // The sheets exist now but have no pictures. Reload so their ids are the
    // server's rather than guessed here, and the drawing step picks up from
    // the rows that come back.
    window.location.reload();
  }

  async function drawSheets() {
    if (!fileUrl) return;
    setError(null);
    const todo = pages.filter((page) => page.imageUrl === null);
    try {
      setBusy("Opening the drawing…");
      const pdfjs = await loadPdfjs();
      // Our own blob URL, so this one request is same-store and public — the
      // case the old design could never rely on.
      // Our own blob URL, and deliberately WITHOUT `withCredentials` -- that
      // flag makes it a credentialed cross-origin request, which Vercel Blob
      // refuses because it answers with `Access-Control-Allow-Origin: *`.
      // Measured: omit -> 206, include -> TypeError. The file is public by
      // construction, so there is nothing to send.
      const doc = await pdfjs.getDocument({ url: fileUrl }).promise;

      for (const [done, sheet] of todo.entries()) {
        setBusy(`Preparing sheet ${done + 1} of ${todo.length}…`);
        const page = await doc.getPage(sheet.pageNumber);
        const unit = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: SHEET_WIDTH_PX / unit.width });
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        await page.render({ canvasContext: context, viewport }).promise;

        const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!png) throw new Error("no image");

        // Straight to the store, like the PDF. A 2000px sheet PNG is commonly
        // several megabytes, so this one would hit the same wall.
        const stored = await upload(`sheets/${revisionId}/${sheet.pageNumber}.png`, png, {
          access: "public",
          handleUploadUrl: "/api/drawings/upload",
          clientPayload: revisionId,
        });
        const saved = await storeSheetImage(sheet.id, stored.url, String(canvas.width));
        if (!saved.ok) {
          setError(saved.error);
          setBusy(null);
          return;
        }
      }
      window.location.reload();
    } catch {
      setError("Those sheets could not be prepared.");
      setBusy(null);
    }
  }

  const unprepared = pages.filter((page) => page.imageUrl === null).length;
  const page = pages.length > 0 ? pages[Math.min(index, pages.length - 1)] : null;

  return (
    <div className="space-y-3">
      {error && (
        <p className="rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>
      )}

      {pages.length === 0 ? (
        <div className="space-y-2 rounded-md border border-slate-700 bg-slate-900/60 p-4">
          <p className="text-sm text-slate-200">
            {/* Said as the thing it is. A link to Procore is fine for reading
                the drawing and cannot be pinned on, and a person has no way to
                know that unless it is written here. */}
            Upload the drawing to pin on it. A link to Procore or a GC portal can be opened and read, but
            this app cannot see inside it — pinning needs the file itself.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void uploadDrawing(file);
            }}
            className="block w-full text-sm text-slate-300 file:mr-3 file:rounded-md file:border-0 file:bg-sky-500 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-950"
          />
        </div>
      ) : unprepared > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm">
          <span className="text-slate-300">
            {unprepared} of {pages.length} {pages.length === 1 ? "sheet is" : "sheets are"} not ready for the
            phone yet.
          </span>
          <button
            type="button"
            onClick={drawSheets}
            disabled={busy !== null}
            className="rounded-md bg-sky-500 px-3 py-2 text-sm font-medium text-slate-950 disabled:opacity-50"
          >
            {busy ? (
              <>
                <Spinner />
                {busy}
              </>
            ) : (
              "Prepare for the phone"
            )}
          </button>
        </div>
      ) : null}

      {busy && pages.length === 0 && (
        <p className="text-sm text-slate-400">
          <Spinner />
          {busy}
        </p>
      )}

      {pages.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-slate-400">Sheet</span>
          {pages.map((row, i) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-current={i === index}
              className={`rounded-md border px-3 py-2 text-sm ${
                i === index
                  ? "border-sky-400 bg-sky-400/15 text-sky-100"
                  : "border-slate-700 text-slate-300 hover:border-slate-500"
              }`}
            >
              {row.pageNumber}
              {row.pins.length > 0 && <span className="ml-1 text-xs text-slate-400">({row.pins.length})</span>}
            </button>
          ))}
        </div>
      )}

      {page && fileUrl && <SheetPinViewer fileUrl={fileUrl} page={page} pins={page.pins} />}
    </div>
  );
}
