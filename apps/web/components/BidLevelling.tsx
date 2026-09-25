"use client";

import { useState, useTransition } from "react";

import { ActionForm } from "@/components/ActionForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteBidQuote, recordBidQuoteDecline, saveBidQuote } from "@/lib/actions";
import {
  exclusionLines,
  levelBid,
  outstandingNote,
  requestState,
  type LevelQuote,
} from "@/lib/bid-levelling";

/**
 * The quotes collected for one bid, laid side by side — and the ones still
 * out.
 *
 * THE CAUTION SITS WITH THE LOW NUMBER, not under the table. `levelPackage`
 * returns the cheapest quote and whether the quotes are comparable in ONE
 * object, and this renders them together for the reason the module's header
 * gives: "Acme, $82,000, lowest" in bold, with the exclusions somewhere below
 * the fold, is the app helping somebody buy a hole in their own scope.
 *
 * WHAT IS STILL OUT IS ON SCREEN FOR THE SAME REASON. Two comparable quotes
 * read as a settled buyout, and they are not settled while a third supplier
 * has the drawings and has not answered. The outstanding note sits with the
 * caution, above the numbers, and never in a collapsed section.
 */

export type BidQuoteRow = LevelQuote & { notes: string | null; vendorId: string | null };

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function BidLevelling({
  bidInvitationId,
  quotes,
  vendors,
  today,
}: {
  bidInvitationId: string;
  quotes: BidQuoteRow[];
  vendors: { id: string; name: string }[];
  /** The reader's calendar day, resolved on the server. Passed in rather than
   * read from a clock here: a `new Date()` during render is markup the client
   * then disagrees with, and "overdue" is a claim about a day. */
  today: string;
}) {
  const [adding, setAdding] = useState<null | "quote" | "request">(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);

  const packages = levelBid(quotes);
  // The labels already used on this bid, so the common case is picking a
  // package rather than retyping it — a typo splits a comparison in two.
  const usedLabels = [...new Set(quotes.map((q) => q.packageLabel))].sort();

  const run = (work: () => Promise<{ ok: boolean; error?: string } | void>) => {
    setRowError(null);
    startTransition(async () => {
      const result = await work();
      if (result && !result.ok) setRowError(result.error ?? "That didn't go through. Reload the page.");
    });
  };

  const formProps = { bidInvitationId, vendors, usedLabels };

  if (quotes.length === 0 && adding === null) {
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setAdding("request")}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Ask a supplier for a quote
        </button>
        <button
          type="button"
          onClick={() => setAdding("quote")}
          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Log a quote you received
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-line-row bg-surface-card p-3">
      {packages.map((group) => {
        const waiting = outstandingNote(group, today);
        return (
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
            {/* AND WHAT IS STILL OUT, in the same breath. Two comparable
                quotes are not a finished buyout while somebody has the
                drawings and has not answered. */}
            {waiting && <p className="mt-1 text-xs text-tag-amber-ink">{waiting}</p>}

            <ul className="mt-2 flex flex-col divide-y divide-line-row">
              {group.quotes.map((quote, index) =>
                editing === quote.id ? (
                  <li key={quote.id} className="py-2">
                    <QuoteForm
                      {...formProps}
                      mode="quote"
                      quote={quotes.find((q) => q.id === quote.id) ?? null}
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
                        {quote.quotedOn && (
                          <span className="ml-2 text-xs text-ink-muted">quoted {quote.quotedOn}</span>
                        )}
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
                          onConfirm={() => run(() => deleteBidQuote(quote.id))}
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

            {/* ASKED, NOT ANSWERED. Below the prices because it is not part of
                the comparison, and on the same screen because it is the
                reason the comparison is not finished. */}
            {group.outstanding.length > 0 && (
              <ul className="mt-2 flex flex-col divide-y divide-line-row border-t border-line-row pt-2">
                {group.outstanding.map((row) =>
                  editing === row.id ? (
                    <li key={row.id} className="py-2">
                      <QuoteForm
                        {...formProps}
                        mode="quote"
                        quote={quotes.find((q) => q.id === row.id) ?? null}
                        onDone={() => setEditing(null)}
                      />
                    </li>
                  ) : (
                    <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <p className="text-sm text-ink-body">
                          <span className="font-medium text-ink">{row.vendorName}</span>
                          <span
                            className={`ml-2 text-xs ${
                              requestState(row, today) === "OVERDUE" ? "text-tag-rose-ink" : "text-ink-muted"
                            }`}
                          >
                            {requestState(row, today) === "OVERDUE" ? "overdue" : "no price back yet"}
                          </span>
                        </p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {row.requestedOn ? `Asked ${row.requestedOn}` : "Not recorded as asked"}
                          {row.dueBy ? ` · wanted back by ${row.dueBy}` : " · no date asked for"}
                        </p>
                        {row.notes && <p className="mt-1 text-xs text-ink-muted">{row.notes}</p>}
                      </div>

                      <RowActions
                        className="flex shrink-0 items-center gap-2"
                        destructive={
                          <ConfirmDelete
                            label="Delete"
                            describe={`Removes the record of asking ${row.vendorName}. Nothing is sent to them.`}
                            confirmLabel="Confirm delete"
                            pendingLabel="Deleting…"
                            pending={isPending}
                            pinned="end"
                            onConfirm={() => run(() => deleteBidQuote(row.id))}
                          />
                        }
                      >
                        <button
                          type="button"
                          onClick={() => setEditing(row.id)}
                          className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
                        >
                          Enter their price
                        </button>
                        <DeclineButton
                          id={row.id}
                          today={today}
                          pending={isPending}
                          onRun={run}
                          label="They declined"
                        />
                      </RowActions>
                    </li>
                  ),
                )}
              </ul>
            )}

            {/* DECLINED, AND KEPT. "Gamma declined to bid this" is the answer
                to "why did we only get two prices", and next time it says who
                not to wait on. */}
            {group.declined.length > 0 && (
              <ul className="mt-2 flex flex-col divide-y divide-line-row border-t border-line-row pt-2">
                {group.declined.map((row) => (
                  <li key={row.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <p className="min-w-0 text-sm text-ink-muted">
                      <span className="font-medium">{row.vendorName}</span> declined to bid this
                      {row.declinedAt ? ` on ${row.declinedAt}` : ""}.
                    </p>
                    <RowActions
                      className="flex shrink-0 items-center gap-2"
                      destructive={
                        <ConfirmDelete
                          label="Delete"
                          describe={`Removes the record that ${row.vendorName} declined. Next time nothing will say not to wait on them.`}
                          confirmLabel="Confirm delete"
                          pendingLabel="Deleting…"
                          pending={isPending}
                          pinned="end"
                          onConfirm={() => run(() => deleteBidQuote(row.id))}
                        />
                      }
                    >
                      <DeclineButton
                        id={row.id}
                        today=""
                        pending={isPending}
                        onRun={run}
                        label="They're bidding after all"
                      />
                    </RowActions>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {rowError && (
        <p role="alert" className="text-sm text-tag-rose-ink">
          {rowError}
        </p>
      )}

      {adding !== null ? (
        <div className="border-t border-line-row pt-3">
          <QuoteForm {...formProps} mode={adding} quote={null} onDone={() => setAdding(null)} />
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setAdding("request")}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
          >
            Ask another supplier
          </button>
          <button
            type="button"
            onClick={() => setAdding("quote")}
            className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
          >
            Log another quote
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Declining and un-declining, which are the same action with and without a
 * date. Not a `ConfirmDelete`: nothing is destroyed, and dressing a reversible
 * record as a destructive one teaches people to hesitate over the wrong
 * controls.
 */
function DeclineButton({
  id,
  today,
  pending,
  onRun,
  label,
}: {
  id: string;
  /** The day to record. Empty string clears the decline. */
  today: string;
  pending: boolean;
  onRun: (work: () => Promise<{ ok: boolean; error?: string } | void>) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        const formData = new FormData();
        formData.set("declinedAt", today);
        onRun(() => recordBidQuoteDecline(id, formData));
      }}
      className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800 disabled:opacity-60"
    >
      {label}
    </button>
  );
}

/**
 * One form, two shapes.
 *
 * THE FIELDS A SHAPE OMITS ARE THE POINT, not a simplification. `saveBidQuote`
 * distinguishes "the form left this blank" from "this form does not own this
 * field" by whether the key is present at all — so the quote shape, which
 * carries no `requestedOn`/`dueBy`, cannot erase the record of having asked at
 * the moment the answer arrives.
 */
function QuoteForm({
  bidInvitationId,
  quote,
  vendors,
  usedLabels,
  mode,
  onDone,
}: {
  bidInvitationId: string;
  quote: BidQuoteRow | null;
  vendors: { id: string; name: string }[];
  usedLabels: string[];
  mode: "quote" | "request";
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
        {mode === "request" ? "Who you're asking" : "Who quoted"}
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

      {mode === "request" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Asked on
            <input
              type="date"
              name="requestedOn"
              defaultValue={quote?.requestedOn ?? ""}
              className="rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            />
          </label>

          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Wanted back by
            <input
              type="date"
              name="dueBy"
              defaultValue={quote?.dueBy ?? ""}
              className="rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            />
            <span className="text-ink-muted">This is what makes it read as overdue, not just outstanding.</span>
          </label>
        </>
      ) : (
        <>
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
        </>
      )}

      <SubmitButton
        type="submit"
        className="mt-4 rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        {quote ? "Save" : mode === "request" ? "Record the request" : "Add quote"}
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
