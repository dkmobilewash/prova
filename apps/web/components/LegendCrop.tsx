"use client";

import { useEffect, useRef, useState } from "react";
import type { StoredCrop } from "@/lib/takeoff/legendProposal";
import { PLAN_PDF_TRANSPORT } from "@/lib/takeoff/planPdfTransport";

/**
 * ── A LEGEND TYPE'S PICTURE, CUT FROM THE PLAN'S OWN PDF ──
 *
 * The legend review shows each type's crop beside its reading; the review queue shows the
 * same crop, small, beside each type it offers an untagged group. One page open per legend
 * page (cached here), rendered by pdf.js on a canvas: the server has no rasteriser.
 */

// pdfjs ships no types for the legacy build entry.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PdfPage = any;

const opened = new Map<string, Promise<PdfPage>>();

export function openPage(planId: string, pageNumber: number): Promise<PdfPage> {
  const key = `${planId}:${pageNumber}`;
  const was = opened.get(key);
  if (was !== undefined) return was;
  const next = (async () => {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.mjs", import.meta.url).toString();
    const doc = await pdfjs.getDocument({ url: `/api/takeoff/plan/${planId}`, standardFontDataUrl: "/pdfjs/standard_fonts/", ...PLAN_PDF_TRANSPORT }).promise;
    return doc.getPage(pageNumber);
  })();
  // A failed open is not remembered: the next look tries again.
  next.catch(() => opened.delete(key));
  opened.set(key, next);
  return next;
}

/** Render a rectangle of the page (points, y down) at `scale` px per point onto a fresh canvas. */
export async function renderRect(page: PdfPage, rect: { x: number; y: number; width: number; height: number }, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const viewport = page.getViewport({ scale, offsetX: -rect.x * scale, offsetY: -rect.y * scale });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

export function LegendCrop({
  page,
  crop,
  code,
  widthPx,
}: {
  page: PdfPage | null;
  crop: StoredCrop | null;
  code: string;
  /** A fixed width (a thumbnail); else the parent's, up to 480. */
  widthPx?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<"waiting" | "drawn" | "failed">("waiting");
  useEffect(() => {
    if (page === null || crop === null || ref.current === null) return;
    let cancelled = false;
    const target = ref.current;
    (async () => {
      try {
        const dpr = window.devicePixelRatio || 1;
        const widthCss = widthPx ?? Math.min(target.parentElement?.clientWidth ?? 360, 480);
        const scale = (widthCss / crop.width) * dpr;
        const drawn = await renderRect(page, crop, scale);
        if (cancelled) return;
        target.width = drawn.width;
        target.height = drawn.height;
        target.style.width = `${widthCss}px`;
        target.style.height = `${Math.round(drawn.height / dpr)}px`;
        target.getContext("2d")?.drawImage(drawn, 0, 0);
        setState("drawn");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, crop, widthPx]);
  if (crop === null) {
    return <p className="text-xs text-ink-muted">No crop was placed for {code} — the code was not found printed on the legend page.</p>;
  }
  return (
    <div className="rounded-md border border-line-card bg-white p-1" data-legend="crop" data-legend-crop-state={state}>
      <canvas ref={ref} aria-label={`The legend's drawing for ${code}`} />
      {state === "waiting" && widthPx === undefined && <p className="p-2 text-xs text-ink-muted">Rendering the crop…</p>}
      {state === "failed" && <p className="p-2 text-xs text-ink-muted">The crop couldn&rsquo;t be rendered here.</p>}
    </div>
  );
}

/** The same crop as a thumbnail, opening its legend page itself (the review queue's picker). */
export function LegendThumb({ planId, pageNumber, crop, code }: { planId: string; pageNumber: number; crop: StoredCrop; code: string }) {
  const [page, setPage] = useState<PdfPage | null>(null);
  useEffect(() => {
    let cancelled = false;
    openPage(planId, pageNumber)
      .then((p) => {
        if (!cancelled) setPage(p);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [planId, pageNumber]);
  return <LegendCrop page={page} crop={crop} code={code} widthPx={72} />;
}
