"use client";

import { useState, useTransition } from "react";
import { deleteVendorPriceQuote, updateVendorPriceQuote } from "@/lib/actions";
import { money } from "@/lib/money";
import type { VendorOption } from "@/components/MaterialOrderFields";
import {
  VendorPriceQuoteFields,
  type CatalogOption,
} from "@/components/VendorPriceQuoteFields";
import {
  type QuoteData,
  cheapestBadge,
  isExpired,
  isStale,
  sourceLabel,
  sourceNote,
  unitLabel,
} from "@/components/vendorPricing";

/** One quote in an item's history: reading, editing, or confirming a
 * delete. Delete asks twice — it sits beside Edit, and removing a quote
 * silently changes what "current" and "cheapest" mean for everyone reading
 * the page. A two-step button, not window.confirm(), which some embedded
 * browsers block and none of it can be styled. */
export function VendorPriceQuoteRow({
  quote,
  today,
  canDelete,
  vendors,
  catalogEntries,
  isCheapest,
}: {
  quote: QuoteData;
  today: string;
  canDelete: boolean;
  vendors: VendorOption[];
  catalogEntries: CatalogOption[];
  isCheapest: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const expired = isExpired(quote, today);
  const stale = isStale(quote, today);
  const note = sourceNote(quote.source);

  if (isEditing) {
    return (
      <li className="p-4">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await updateVendorPriceQuote(quote.id, formData);
              if (result.ok) setIsEditing(false);
              else setError(result.error);
            });
          }}
          className="flex flex-col gap-3"
        >
          <VendorPriceQuoteFields
            vendors={vendors}
            catalogEntries={catalogEntries}
            defaults={{
              vendorId: quote.vendorId,
              catalogEntryId: quote.catalogEntryId,
              description: quote.description,
              unit: quote.unit,
              unitPrice: String(quote.unitPrice),
              quotedOn: quote.quotedOn,
              validUntil: quote.validUntil,
              source: quote.source,
              notes: quote.notes,
            }}
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 p-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-100">{money(quote.unitPrice)}</span>
          <span className="text-sm text-slate-400">per {unitLabel(quote.unit)}</span>
          {isCheapest && !expired && (
            <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-400">
              {cheapestBadge(quote.unit)}
            </span>
          )}
          {expired && (
            <span className="rounded bg-slate-700/40 px-1.5 py-0.5 text-xs text-slate-400">
              expired {quote.validUntil}
            </span>
          )}
          {stale && (
            <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-xs text-amber-400">
              worth re-checking
            </span>
          )}
        </p>

        <p className="text-sm text-slate-300">{quote.vendorName}</p>
        <p className="text-sm text-slate-400">{quote.description}</p>

        <p className="mt-1 text-xs text-slate-500">
          Quoted {quote.quotedOn} · {sourceLabel(quote.source)}
          {note ? ` (${note})` : ""}
          {quote.validUntil && !expired ? ` · held until ${quote.validUntil}` : ""}
        </p>

        {quote.notes && <p className="mt-1 text-sm text-slate-500">{quote.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-400">{error}</p>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            setIsEditing(true);
            setIsConfirmingDelete(false);
          }}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
        >
          Edit
        </button>

        {canDelete &&
          (isConfirmingDelete ? (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await deleteVendorPriceQuote(quote.id);
                    if (!result.ok) {
                      setError(result.error);
                      setIsConfirmingDelete(false);
                    }
                  });
                }}
                className="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 disabled:opacity-50"
              >
                {isPending ? "Removing…" : "Confirm remove"}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => setIsConfirmingDelete(false)}
                className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-slate-500 disabled:opacity-50"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={isPending}
              onClick={() => setIsConfirmingDelete(true)}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
            >
              Remove
            </button>
          ))}
      </div>
    </li>
  );
}
