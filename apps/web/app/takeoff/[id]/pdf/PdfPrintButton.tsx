"use client";

/** Prints the drawing in the frame beside it: the viewer's own toolbar is off. */
export function PdfPrintButton() {
  return (
    <button
      type="button"
      onClick={() => (document.querySelector('[data-takeoff="pdf-frame"]') as HTMLIFrameElement | null)?.contentWindow?.print()}
      className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-neutral-900 hover:brightness-95"
    >
      Print
    </button>
  );
}
