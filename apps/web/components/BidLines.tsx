"use client";

import { useState, useTransition } from "react";

import { ActionForm } from "@/components/ActionForm";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { SubmitButton } from "@/components/SubmitButton";
import { deleteBidLine, saveBidLine, setBidLineAccepted } from "@/lib/actions";
import { alternateDirection, bidTotals, type BidLineInput, type BidLineKind } from "@/lib/bid-lines";

/**
 * The rest of a bid — the alternates, unit prices and allowances a GC's form
 * asks for and `bidAmount` alone cannot hold.
 *
 * EVERY TOTAL ON SCREEN COMES FROM `bidTotals`. The three kinds sit in three
 * different places relative to the base bid, and the reason this component
 * computes nothing itself is that the arithmetic which looks obvious here is
 * the arithmetic that sends a bid out wrong: an allowance is already inside
 * the base, so adding it double-counts it, and a unit price is a rate that
 * belongs in no sum at all.
 */

export type BidLineRow = BidLineInput & { id: string; description: string | null };

const KIND_LABEL: Record<BidLineKind, string> = {
  ALTERNATE: "Alternate",
  UNIT_PRICE: "Unit price",
  ALLOWANCE: "Allowance",
};

const money = (value: number) =>
  value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function BidLines({
  bidInvitationId,
  base,
  lines,
}: {
  bidInvitationId: string;
  base: number | null;
  lines: BidLineRow[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const totals = bidTotals(base, lines);

  // `ConfirmDelete`'s own `action` prop discards what the action returns, and
  // these refuse in sentences worth reading. So the delete runs here and its
  // refusal is rendered rather than swallowed.
  const [isPending, startTransition] = useTransition();
  const [rowError, setRowError] = useState<string | null>(null);
  const remove = (id: string) => {
    setRowError(null);
    startTransition(async () => {
      const result = await deleteBidLine(id);
      if (result && !result.ok) setRowError(result.error);
    });
  };

  if (lines.length === 0 && !adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-2 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Add an alternate, unit price or allowance
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-line-row bg-surface-card p-3">
      {lines.length > 0 && (
        <>
          <ul className="flex flex-col divide-y divide-line-row">
            {lines.map((line) =>
              editing === line.id ? (
                <li key={line.id} className="py-2">
                  <LineForm
                    bidInvitationId={bidInvitationId}
                    line={line}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={line.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-ink-body">
                      <span className="text-ink-muted">{KIND_LABEL[line.kind]}</span>{" "}
                      <span className="font-medium text-ink">{line.label}</span>
                      {line.kind === "UNIT_PRICE" && line.unitPrice !== null && (
                        <>
                          {" "}
                          — {money(line.unitPrice)} per {line.unit}
                        </>
                      )}
                      {line.kind !== "UNIT_PRICE" && line.amount !== null && (
                        <>
                          {" "}
                          —{" "}
                          {line.kind === "ALTERNATE" ? (
                            <>
                              {/* The direction is in WORDS as well as in the
                                  sign: a minus in a table is the easiest thing
                                  on a bid document to miss. */}
                              <span className="font-medium">{alternateDirection(line.amount)}</span>{" "}
                              {money(Math.abs(line.amount))}
                            </>
                          ) : (
                            money(line.amount)
                          )}
                        </>
                      )}
                    </p>
                    {line.description && <p className="text-xs text-ink-muted">{line.description}</p>}
                    {line.kind === "ALLOWANCE" && (
                      <p className="text-xs text-ink-muted">Carried inside the base bid — not added to it.</p>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {line.kind === "ALTERNATE" && <AcceptedControl line={line} />}
                    <RowActions
                      className="flex shrink-0 items-center gap-2"
                      destructive={
                        <ConfirmDelete
                          label="Delete"
                          describe={`Removes this ${KIND_LABEL[line.kind].toLowerCase()} from the bid. Nothing is sent to the GC.`}
                          confirmLabel="Confirm delete"
                          pendingLabel="Deleting…"
                          pending={isPending}
                          pinned="end"
                          onConfirm={() => remove(line.id)}
                        />
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setEditing(line.id)}
                        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
                      >
                        Edit
                      </button>
                    </RowActions>
                  </div>
                </li>
              ),
            )}
          </ul>

          {/* WHAT IT ADDS UP TO, with each figure saying which kinds it drew
              from. The award is base + ACCEPTED alternates: the allowance is
              already in the base, and the unit prices are rates. */}
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line-row pt-2 text-xs">
            {totals.allowanceCount > 0 && (
              <div>
                <dt className="inline text-ink-muted">Allowances inside the base </dt>
                <dd className="inline text-ink-body">{money(totals.allowancesCarried)}</dd>
              </div>
            )}
            {totals.alternateCount > 0 && (
              <div>
                <dt className="inline text-ink-muted">Alternates accepted </dt>
                <dd className="inline text-ink-body">
                  {money(totals.alternatesAccepted)} of {money(totals.alternatesOffered)} offered
                </dd>
              </div>
            )}
            {totals.awardedTotal !== null && (
              <div>
                <dt className="inline text-ink-muted">Base plus accepted </dt>
                <dd className="inline font-medium text-ink">{money(totals.awardedTotal)}</dd>
              </div>
            )}
            {totals.unitPriceCount > 0 && (
              <div className="text-ink-muted">
                {totals.unitPriceCount} unit {totals.unitPriceCount === 1 ? "price" : "prices"} held — rates, not
                part of any total
              </div>
            )}
          </dl>
          {rowError && (
            <p role="alert" className="mt-1 text-sm text-tag-rose-ink">
              {rowError}
            </p>
          )}
          {totals.undecidedCount > 0 && (
            <p className="mt-1 text-xs text-tag-amber-ink">
              {totals.undecidedCount === 1
                ? "One alternate has no answer from the GC yet, so this total is provisional."
                : `${totals.undecidedCount} alternates have no answer from the GC yet, so this total is provisional.`}
            </p>
          )}
        </>
      )}

      {adding ? (
        <div className="mt-3 border-t border-line-row pt-3">
          <LineForm bidInvitationId={bidInvitationId} line={null} onDone={() => setAdding(false)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
        >
          Add another
        </button>
      )}
    </div>
  );
}

/** The GC's answer on one alternate — three states, because "they have not
 * said" is a different fact from "they declined". */
function AcceptedControl({ line }: { line: BidLineRow }) {
  const value = line.accepted === true ? "yes" : line.accepted === false ? "no" : "";
  return (
    <ActionForm action={setBidLineAccepted.bind(null, line.id)} className="flex items-center gap-1">
      <label className="text-xs text-ink-muted">
        GC
        <select
          name="accepted"
          defaultValue={value}
          className="ml-1 rounded-md border border-line-card bg-surface-input px-1 py-0.5 text-xs text-ink-body"
        >
          <option value="">not said</option>
          <option value="yes">took it</option>
          <option value="no">declined</option>
        </select>
      </label>
      <SubmitButton
        type="submit"
        className="rounded-md border border-line-card px-2 py-0.5 text-xs text-ink-label hover:bg-neutral-800"
      >
        Save
      </SubmitButton>
    </ActionForm>
  );
}

/** Add or edit. The kind drives which figure the form asks for, because a
 * unit price holds a rate and the other two hold an amount — asking for both
 * is how one of them arrives on the wrong kind. */
function LineForm({
  bidInvitationId,
  line,
  onDone,
}: {
  bidInvitationId: string;
  line: BidLineRow | null;
  onDone: () => void;
}) {
  const [kind, setKind] = useState<BidLineKind>(line?.kind ?? "ALTERNATE");

  return (
    <ActionForm
      action={saveBidLine.bind(null, bidInvitationId)}
      className="flex flex-wrap items-end gap-2"
      onSuccess={onDone}
    >
      {line && <input type="hidden" name="bidLineId" value={line.id} />}
      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Kind
        <select
          name="kind"
          value={kind}
          onChange={(event) => setKind(event.target.value as BidLineKind)}
          className="rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        >
          <option value="ALTERNATE">Alternate — added or deducted if the GC takes it</option>
          <option value="UNIT_PRICE">Unit price — a rate held for changes</option>
          <option value="ALLOWANCE">Allowance — carried inside the base bid</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        Label
        <input
          name="label"
          defaultValue={line?.label ?? ""}
          placeholder="Alternate 1"
          className="w-36 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
      </label>

      {kind === "UNIT_PRICE" ? (
        <>
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Rate
            <input
              name="unitPrice"
              inputMode="decimal"
              defaultValue={line?.unitPrice?.toString() ?? ""}
              placeholder="3.10"
              className="w-24 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-label">
            Per
            <input
              name="unit"
              defaultValue={line?.unit ?? ""}
              placeholder="SF of 5/8 board"
              className="w-40 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
            />
          </label>
        </>
      ) : (
        <label className="flex flex-col gap-1 text-xs text-ink-label">
          {kind === "ALTERNATE" ? "Add (or deduct, with a minus)" : "Amount carried"}
          <input
            name="amount"
            inputMode="decimal"
            defaultValue={line?.amount?.toString() ?? ""}
            placeholder={kind === "ALTERNATE" ? "12400 or -8000" : "15000"}
            className="w-36 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
          />
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs text-ink-label">
        What it covers
        <input
          name="description"
          defaultValue={line?.description ?? ""}
          placeholder="Level 5 finish throughout"
          className="w-56 rounded-md border border-line-card bg-surface-input px-2 py-1 text-sm text-ink-body"
        />
      </label>

      <SubmitButton
        type="submit"
        className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-neutral-900"
      >
        {line ? "Save" : "Add"}
      </SubmitButton>
      <button
        type="button"
        onClick={onDone}
        className="rounded-md border border-line-card px-2 py-1 text-xs text-ink-label hover:bg-neutral-800"
      >
        Cancel
      </button>
    </ActionForm>
  );
}
