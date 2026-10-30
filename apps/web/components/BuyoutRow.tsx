"use client";

import { useState, useTransition } from "react";
import { draftPurchaseOrderLine, removePurchaseOrderLine } from "@/lib/actions";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { money } from "@/lib/money";
import type { BuyoutRow as BuyoutRowData } from "@/lib/purchase-orders";

const inputClass =
  "rounded-md border border-line-card bg-canvas px-2 py-1 text-sm text-ink focus:border-link focus:outline-none";
const btn =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-line-card px-3 py-2 text-xs text-ink-label hover:bg-rail-hover disabled:opacity-50";

function overBudgetText(amount: number | null): string | null {
  if (amount === null) return null;
  if (amount === 0) return "on budget";
  return amount > 0 ? `${money(amount)} over budget` : `${money(-amount)} under budget`;
}

/** One scope line: what it was budgeted at, what is drafted and committed,
 * the quotes on file in its own unit, and a typed price for everything else. */
export function BuyoutRow({
  jobId,
  row,
  vendors,
}: {
  jobId: string;
  row: BuyoutRowData;
  vendors: { id: string; name: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(String(row.quantityLeft || row.line.quantity));

  function draft(fill: (form: FormData) => void) {
    const form = new FormData();
    form.set("lineItemId", row.line.id);
    form.set("quantity", quantity);
    fill(form);
    setError(null);
    startTransition(async () => {
      try {
        const result = await draftPurchaseOrderLine(jobId, form);
        if (!result.ok) setError(result.error);
      } catch {
        setError("That did not go through. Reload the page and check before trying again.");
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-ink">{row.line.description}</p>
        <p className="flex flex-wrap gap-x-4 text-sm text-ink-body">
          <span>Budget {row.budget != null ? money(row.budget) : "not set"}</span>
          <span>Drafted {money(row.drafted)}</span>
          <span>Committed {money(row.committed)}</span>
        </p>
      </div>
      <label className="flex items-center gap-2 text-xs text-ink-muted">
        Quantity to buy
        <input
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          inputMode="decimal"
          aria-label={`Quantity to buy of ${row.line.description}`}
          className={`${inputClass} w-24`}
        />
        <span>
          {row.line.unit ?? "no unit"}, {row.quantityLeft} left of {row.line.quantity}
        </span>
      </label>

      {row.offers.length === 0 && <p className="text-xs text-ink-muted">No current quote on file in this unit.</p>}
      <ul className="flex flex-col gap-1">
        {row.offers.map((offer) => (
          <li key={offer.quoteId} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-body">
            <span>
              {offer.vendorName}: {money(offer.unitPrice)} = {money(offer.extended)}
              {offer.cheapest && row.offers.length > 1 ? " · lowest" : ""}
              {overBudgetText(offer.overBudget) ? ` · ${overBudgetText(offer.overBudget)}` : ""}
              <span className="text-xs text-ink-muted"> · quoted {offer.quotedOn}</span>
            </span>
            <button type="button" disabled={isPending} className={btn} onClick={() => draft((form) => form.set("quoteId", offer.quoteId))}>
              Add to draft PO
            </button>
          </li>
        ))}
      </ul>
      {row.otherUnits.map((other) => (
        <p key={`${other.vendorName}-${other.unit}`} className="text-xs text-ink-muted">
          {other.vendorName} quoted {money(other.unitPrice)} per {other.unit ?? "no unit"}. A different unit, so it is not compared.
        </p>
      ))}

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = new FormData(event.currentTarget);
          draft((form) => {
            form.set("vendorId", String(typed.get("vendorId") ?? ""));
            form.set("unitPrice", String(typed.get("unitPrice") ?? ""));
          });
        }}
      >
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Vendor or lower-tier sub
          <select name="vendorId" required defaultValue="" className={`${inputClass} w-52`}>
            <option value="" disabled>
              Pick one
            </option>
            {vendors.map((vendor) => (
              <option key={vendor.id} value={vendor.id}>
                {vendor.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-ink-muted">
          Unit price
          <input name="unitPrice" required inputMode="decimal" className={`${inputClass} w-28`} />
        </label>
        <button type="submit" disabled={isPending} className={btn}>
          Add to draft PO
        </button>
      </form>
      {error && <p className="text-sm text-danger">{error}</p>}
    </li>
  );
}

export function PurchaseOrderLineRow({
  line,
  canRemove,
}: {
  line: { id: string; text: string };
  canRemove: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="flex flex-col gap-1 text-sm text-ink-body">
      <div className="flex items-center justify-between gap-2">
        <span>{line.text}</span>
        {canRemove && (
          <RowActions
            as="span"
            className="flex shrink-0 items-center gap-2"
            destructive={
              <ConfirmDelete
                label="Remove"
                confirmLabel="Remove it"
                pinned="end"
                pending={isPending}
                describe="Takes this line off the draft. Removing the last line removes the draft."
                onConfirm={() => {
                  setError(null);
                  startTransition(async () => {
                    try {
                      const result = await removePurchaseOrderLine(line.id);
                      if (!result.ok) setError(result.error);
                    } catch {
                      setError("That did not go through. Reload the page and check before trying again.");
                    }
                  });
                }}
              />
            }
          >
            {null}
          </RowActions>
        )}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </li>
  );
}
