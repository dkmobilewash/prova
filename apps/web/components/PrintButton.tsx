"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      // Was a light button (bg-slate-100 / text-slate-900) on a dark page
      // — the only one in the product, and it sat apart from the document
      // sheet it belongs to, so it read as a stray control rather than a
      // deliberate one. It is an action, so it takes the brand fill every
      // other primary action uses.
      className="print:hidden inline-flex items-center justify-center rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
    >
      Print / Save as PDF
    </button>
  );
}
