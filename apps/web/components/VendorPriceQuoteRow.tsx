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
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { FormDraftNotice, useFormDraft } from "@/components/useFormDraft";

/** One quote in an item's history: reading, editing, or confirming a
 * delete. Delete asks twice, because removing a quote silently changes what
 * "current" and "cheapest" mean for everyone reading the page. A two-step
 * button, not window.confirm(), which some embedded browsers block and none
 * of it can be styled.
 *
 * Arming it no longer leaves Edit sitting beside the confirm: the actions go
 * through <RowActions>, which renders nothing but the cancel/confirm pair
 * while the delete is armed. Issue #152. */
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
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Keyed by the quote id so two rows' edit forms can never share a draft.
  const draft = useFormDraft(`vendor-price-quote:edit:${quote.id}`);

  const expired = isExpired(quote, today);
  const stale = isStale(quote, today);
  const note = sourceNote(quote.source);

  if (isEditing) {
    return (
      <li className="p-4">
        <form
          ref={draft.formRef}
          onChange={draft.save}
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            const formData = new FormData(event.currentTarget);
            startTransition(async () => {
              const result = await updateVendorPriceQuote(quote.id, formData);
              if (result.ok) {
                draft.clear();
                setIsEditing(false);
              } else setError(result.error);
            });
          }}
          className="flex flex-col gap-3"
        >
          <FormDraftNotice draft={draft} />
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

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-brand px-4 py-2 text-sm font-semibold text-ink-label hover:bg-yellow-500 disabled:opacity-50"
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
              className="rounded-md border border-line-card px-4 py-2 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50"
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
          <span className="font-medium text-ink">{money(quote.unitPrice)}</span>
          <span className="text-sm text-ink-body">per {unitLabel(quote.unit)}</span>
          {isCheapest && !expired && (
            <span className="rounded bg-tag-green px-1.5 py-0.5 text-xs text-emerald-700">
              {cheapestBadge(quote.unit)}
            </span>
          )}
          {expired && (
            <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-xs text-ink-body">
              expired {quote.validUntil}
            </span>
          )}
          {stale && (
            <span className="rounded bg-tag-amber px-1.5 py-0.5 text-xs text-amber-700">
              worth re-checking
            </span>
          )}
        </p>

        <p className="text-sm text-ink-label">{quote.vendorName}</p>
        <p className="text-sm text-ink-body">{quote.description}</p>

        <p className="mt-1 text-xs text-ink-muted">
          Quoted {quote.quotedOn} · {sourceLabel(quote.source)}
          {note ? ` (${note})` : ""}
          {quote.validUntil && !expired ? ` · held until ${quote.validUntil}` : ""}
        </p>

        {quote.notes && <p className="mt-1 text-sm text-ink-muted">{quote.notes}</p>}
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
      </div>

      <RowActions
        className="flex shrink-0 items-center gap-2"
        destructive={
          canDelete ? (
            <ConfirmDelete
              pinned="end"
              label="Remove"
              confirmLabel="Confirm remove"
              pendingLabel="Removing…"
              pending={isPending}
              onConfirm={() => {
                setError(null);
                startTransition(async () => {
                  const result = await deleteVendorPriceQuote(quote.id);
                  if (!result.ok) setError(result.error);
                });
              }}
              deleteClassName="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:border-red-500 hover:text-red-600 disabled:opacity-50"
              cancelClassName="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50"
              confirmClassName="rounded-md border border-red-500 px-3 py-1.5 text-sm text-red-600 hover:bg-tag-rose disabled:opacity-50"
            />
          ) : null
        }
      >
        <button
          type="button"
          disabled={isPending}
          onClick={() => setIsEditing(true)}
          className="rounded-md border border-line-card px-3 py-1.5 text-sm text-ink-label hover:bg-neutral-100 disabled:opacity-50"
        >
          Edit
        </button>
      </RowActions>
    </li>
  );
}
