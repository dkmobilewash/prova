"use client";

import { useState } from "react";
import { Hint } from "@/components/Hint";
import { secondaryActionClass } from "@/components/emptyStateStyles";
import type { G702Document } from "@/lib/billing/g702";

/**
 * Builds the G702/G703 PDF on the person's own machine and hands it to the
 * browser as a download. The figures arrive as a plain object from the
 * server page; the PDF library and the drawing code load only when this is
 * pressed, the same shape as `BidPackageBuilder`. Nothing is uploaded and
 * nothing is stored — where a sent application should live as a file is a
 * decision not yet made.
 */
export function G702DownloadButton({ document: doc }: { document: G702Document }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Hint text="Builds the PDF in your browser and downloads it. Nothing is sent to the GC or stored here.">
        <button
          type="button"
          disabled={busy}
          className={`${secondaryActionClass} print:hidden`}
          onClick={() => {
            setBusy(true);
            setError(null);
            void (async () => {
              try {
                const { buildG702Pdf, g702FileName } = await import("@/lib/billing/g702-pdf");
                const bytes = await buildG702Pdf(doc);
                const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = g702FileName(doc);
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not build the PDF");
              } finally {
                setBusy(false);
              }
            })();
          }}
        >
          {busy ? "Building PDF…" : "Download G702/G703 PDF"}
        </button>
      </Hint>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
