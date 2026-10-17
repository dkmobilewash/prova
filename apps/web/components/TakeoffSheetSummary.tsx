"use client";

import { type TakeoffItemRow, formatQuantity, itemQuantityOnPage } from "@/lib/takeoff/itemQuantities";

/**
 * ── THE SUMMARY BOX ON THE DRAWING ──
 *
 * What has been taken off ON THIS SHEET, over the sheet itself, the way every
 * takeoff tool shows it. The rail already carries the project totals; this
 * answers the different question somebody asks with a pen in their hand —
 * "have I done this room yet, and how much did it come to".
 *
 * ── THIS SHEET ONLY, AND THAT IS THE WHOLE POINT ──
 *
 * `itemQuantityOnPage` rather than `itemQuantity`. A box over the drawing
 * showing the PROJECT total would read as the sheet's, and an estimator would
 * reconcile it against what they can see and conclude the tool is wrong.
 *
 * ── IT FLOATS, SO IT COVERS PART OF THE DRAWING ──
 *
 * Which is why it is dismissable, remembers being dismissed, and sits in the
 * TOP-LEFT: a title block is bottom-right on every sheet in this repo's
 * fixtures and on all five real sets, so the corner it covers is the one
 * carrying the least drawing.
 */

type Props = {
  items: readonly TakeoffItemRow[];
  pageNumber: number;
  hidden: ReadonlySet<string>;
  onClose: () => void;
};

export function TakeoffSheetSummary({ items, pageNumber, hidden, onClose }: Props) {
  const rows = items
    .map((item) => ({ item, quantity: itemQuantityOnPage(item.measurements, item, pageNumber) }))
    // Only what is actually ON this sheet. An item with nothing here is not a
    // zero to print — it is a different sheet's work.
    .filter((row) => row.quantity.primary > 0 || row.quantity.count > 0);

  if (rows.length === 0) return null;

  return (
    <div
      className="pointer-events-auto absolute left-3 top-3 z-10 max-w-[18rem] rounded-md border border-line-card bg-surface/95 p-2 shadow-lg backdrop-blur-sm"
      data-takeoff="sheet-summary"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">This sheet</h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide the sheet summary"
          data-takeoff="close-summary"
          className="ml-auto rounded px-1 text-xs leading-none text-ink-muted hover:text-ink-body"
        >
          ×
        </button>
      </div>
      <ul className="mt-1 flex flex-col gap-0.5">
        {rows.map(({ item, quantity }) => (
          <li key={item.id} className="flex items-baseline gap-1.5 text-[11px]">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-sm border border-line-card"
              style={{ backgroundColor: item.colorHex }}
            />
            <span className={"min-w-0 flex-1 truncate" + (hidden.has(item.id) ? " text-ink-muted line-through" : " text-ink-body")}>
              {item.name}
            </span>
            <span className="shrink-0 font-semibold text-ink">{formatQuantity(quantity)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
