"use client";

import { useState, useTransition } from "react";

import { ActionForm } from "@/components/ActionForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteBidQuote, saveBidQuote } from "@/lib/actions";
import { exclusionLines, levelBid, type LevelQuote } from "@/lib/bid-levelling";

/**
 * The quotes collected for one bid, laid side by side.
 *
 * THE CAUTION SITS WITH THE LOW NUMBER, not under the table. `levelPackage`
 * returns the cheapest quote and whether the quotes are comparable in ONE
 * object, and this renders them together for the reason the module's header
 * gives: "Acme, $82,000, lowest" in bold, with the exclusions somewhere below
 * the fold, is the app helping somebody buy a hole in their own scope.
 */

export type BidQuoteRow = LevelQuote & { notes: string | null; vendorId: string | null };

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function BidLevelling({
  bidInvitationId,
  quotes,
  vendors,
}: {
  bidInvitationId: string;
  quotes: BidQuoteRow[];
  vendors: { id: string; name: string }[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const packages = levelBid(quotes);
  // The labels already used on this bid, so the common case is picking a
  // package rather than retyping it — a typo splits a comparison in two.
  const usedLabels = [...new Set(quotes.map((q) => q.packageLabel))].sort();

  const remove = (id: string) => {
    setRowError(null);
    startTransition(async () => {
      const result = await deleteBidQuote(id);
      if (result && !result.ok) setRowError(result.error);
    });
  };

  if (quotes.length === 0 && !adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Log a quote you received
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-line-row bg-surface-card p-3">
      {packages.map((group) => (
        <section key={group.packageLabel} className="mb-4 last:mb-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">{group.packageLabel}</h4>
            {group.spread !== null && (
              <p className="text-xs text-ink-muted">
                {group.quotes.length} quotes · {money(group.spread)} between high and low
              </p>
            )}
          </div>

          {/* THE CAUTION, BEFORE THE NUMBERS. It is the thing that decides
              whether the low one is the best one. */}
          {group.caution && (
            <p
              className={`mt-1 text-xs ${
                group.comparable === false ? "text-tag-amber-ink" : "text-ink-muted"
              }`}
            >
              {group.caution}
            </p>
          )}
          {group.comparable === true && (
            <p className="mt-1 text-xs text-tag-emerald-ink">
              Same exclusions on every quote — these are comparable.
            </p>
          )}

          <ul className="mt-2 flex flex-col divide-y divide-line-row">
            {group.quotes.map((quote, index) =>
              editing === quote.id ? (
                <li key={quote.id} className="py-2">
                  <QuoteForm
                    bidInvitationId={bidInvitationId}
                    quote={quotes.find((q) => q.id === quote.id) ?? null}
                    vendors={vendors}
                    usedLabels={usedLabels}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={quote.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-body">
                      <span className="font-medium text-ink">{quote.vendorName}</span> — {money(quote.amount)}
                      {/* "Lowest" is stated only where the caution above is
                          also on screen. Never on its own. */}
                      {index === 0 && group.quotes.length > 1 && (
                        <span className="ml-2 text-xs text-ink-muted">lowest</span>
                      )}
                      <span className="ml-2 text-xs text-ink-muted">quoted {quote.quotedOn}</span>
                    </p>
                    {exclusionLines(quote.exclusions).length > 0 ? (
                      <ul className="mt-1 list-inside list-disc text-xs text-tag-amber-ink">
                        {exclusionLines(quote.exclusions).map((line) => (
                          <li key={line}>excludes {line}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs text-ink-muted">No exclusions recorded.</p>
                    )}
                    {quote.notes && <p className="mt-1 text-xs text-ink-muted">{quote.notes}</p>}
                  </div>

                  <RowActions
                    className="flex shrink-0 items-center gap-2"
                    destructive={
                      <ConfirmDelete
                        label="Delete"
                        describe={`Removes ${quote.vendorName}'s quote from this comparison. Nothing is sent to them.`}
                        confirmLabel="Confirm delete"
                        pendingLabel="Deleting…"
                        pending={isPending}
                        pinned="end"
                        onConfirm={() => remove(quote.id)}
                      />
                    }
                  >
                    <button
                      type="button"
                      onClick={() => setEditing(quote.id)}
                      className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
                    >
                      Edit
                    </button>
                  </RowActions>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}

      {rowError && (
        <p role="alert" className="text-sm text-tag-rose-ink">
          {rowError}
        </p>
      )}

      {adding ? (
        <div className="border-t border-line-row pt-3">
          <QuoteForm
            bidInvitationId={bidInvitationId}
            quote={null}
            vendors={vendors}
            usedLabels={usedLabels}
            onDone={() => setAdding(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Log another quote
        </button>
      )}
    </div>
  );
}

function QuoteForm({
  bidInvitationId,
  quote,
  vendors,
  usedLabels,
  onDone,
}: {
  bidInvitationId: string;
  quote: BidQuoteRow | null;
  vendors: { id: string; name: string }[];
  usedLabels: string[];
  onDone: () => void;
}) {
  return (
    <ActionForm
      action={saveBidQuote.bind(null, bidInvitationId)}
      className="flex flex-wrap items-start gap-2"
      onSuccess={onDone}
    >
      {quote && <input type="hidden" name="bidQuoteId" value={quote.id} />}

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Package
        <input
          name="packageLabel"
          list="bid-packages"
          defaultValue={quote?.packageLabel ?? ""}
          placeholder="Metal stud framing"
          className="w-44 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
        {/* The labels already on this bid, so picking is easier than typing
            and a comparison is less likely to split on a typo. */}
        <datalist id="bid-packages">
          {usedLabels.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Who quoted
        <input
          name="vendorName"
          defaultValue={quote?.vendorName ?? ""}
          placeholder="Acme Framing"
          className="w-40 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        On file as
        <select
          name="vendorId"
          defaultValue={quote?.vendorId ?? ""}
          className="w-40 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        >
          <option value="">not a recorded supplier</option>
          {vendors.map((vendor) => (
            <option key={vendor.id} value={vendor.id}>
              {vendor.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Amount
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={quote?.amount?.toString() ?? ""}
          placeholder="82000"
          className="w-28 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Quoted on
        <input
          type="date"
          name="quotedOn"
          defaultValue={quote?.quotedOn ?? ""}
          className="rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        What they excluded — one per line
        <textarea
          name="exclusions"
          rows={3}
          defaultValue={quote?.exclusions ?? ""}
          placeholder={"Soffits\nFirestopping"}
          className="w-64 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
        <span className="text-ink-muted">This is what decides whether the cheapest is the best.</span>
      </label>

      <SubmitButton
        type="submit"
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        {quote ? "Save" : "Add quote"}
      </SubmitButton>
      <button
        type="button"
        onClick={onDone}
        className="mt-4 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
