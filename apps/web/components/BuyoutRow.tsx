"use client";

import { useState, useTransition } from "react";
import { closePurchaseOrder, draftPurchaseOrderLine, issuePurchaseOrder, removePurchaseOrderLine } from "@/lib/actions";
import type { PurchaseOrderDocument } from "@/lib/purchase-order-pdf";
import { ConfirmDelete, RowActions } from "@/components/RowActions";
import { Disclosure } from "@/components/Disclosure";
import { money } from "@/lib/money";
import type { BuyoutFinding } from "@/lib/buyout-spec-check";
import { SPEC_FINDING_LABEL } from "@/lib/specs/spec-findings";
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

/** Spec findings a person compares for themselves. Shown, not judged: nothing
 * here says the quote meets or misses them. Each carries its quote and page. */
export function SpecFindingList({ findings, summary }: { findings: BuyoutFinding[]; summary: string }) {
  return (
    <Disclosure variant="plain" summary={summary}>
      <ul className="flex flex-col gap-2">
        {findings.map((finding) => (
          <li key={`${finding.sectionNumber}-${finding.ordinal}-${finding.label}`} className="text-xs text-ink-body">
            <span className="font-medium text-ink-label">
              {SPEC_FINDING_LABEL[finding.kind]} · {finding.sectionNumber}
              {finding.sourcePageLabel ? ` · p ${finding.sourcePageLabel}` : ""}
            </span>
            <span className="block">{finding.requirement}</span>
            <span className="block text-ink-muted">&ldquo;{finding.quote}&rdquo;</span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/** One scope line: what it was budgeted at, what is drafted and committed,
 * the quotes on file in its own unit, and a typed price for everything else. */
export function BuyoutRow({
  jobId,
  row,
  vendors,
  findings = [],
}: {
  jobId: string;
  row: BuyoutRowData;
  vendors: { id: string; name: string }[];
  findings?: BuyoutFinding[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(String(row.quantityLeft || row.line.quantity));
  const boughtOut = row.quantityLeft === 0 && row.line.quantity > 0;

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
      {findings.length > 0 && (
        <SpecFindingList
          findings={findings}
          summary={`Spec says · ${findings.length} to compare before buying`}
        />
      )}
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

      {boughtOut && <p className="text-xs text-ink-muted">All {row.line.quantity} is on a purchase order, so no quote is offered.</p>}
      {!boughtOut && row.offers.length === 0 && <p className="text-xs text-ink-muted">No current quote on file in this unit.</p>}
      <ul className="flex flex-col gap-1">
        {!boughtOut && row.offers.map((offer) => (
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

/**
 * Download, issue and close. Issuing commits the money, so it is its own
 * deliberate step with a date a person enters, and it says nothing is sent.
 * The PDF and pdf-lib load only when pressed.
 */
export function PurchaseOrderActions({
  id,
  status,
  document: doc,
}: {
  id: string;
  status: "DRAFT" | "ISSUED" | "CLOSED";
  document: PurchaseOrderDocument;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Starts empty. The date a PO was issued or closed is entered, never assumed.
  const [date, setDate] = useState("");

  function move(action: typeof issuePurchaseOrder, key: string) {
    const form = new FormData();
    form.set(key, date);
    setError(null);
    startTransition(async () => {
      try {
        const result = await action(id, form);
        if (result.ok) setDate("");
        else setError(result.error);
      } catch {
        setError("That did not go through. Reload the page and check before trying again.");
      }
    });
  }

  async function download() {
    setError(null);
    try {
      const { buildPurchaseOrderPdf, purchaseOrderFileName } = await import("@/lib/purchase-order-pdf");
      const bytes = await buildPurchaseOrderPdf(doc);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const link = window.document.createElement("a");
      link.href = url;
      link.download = purchaseOrderFileName(doc);
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("That PDF could not be built.");
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => void download()}>
          Download PDF
        </button>
        {status !== "CLOSED" && (
          <>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              {status === "DRAFT" ? "Date issued" : "Date closed"}
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={inputClass} />
            </label>
            {status === "DRAFT" ? (
              <button type="button" disabled={isPending || !date} className={btn} onClick={() => move(issuePurchaseOrder, "issuedOn")}>
                Mark as issued
              </button>
            ) : (
              <button type="button" disabled={isPending || !date} className={btn} onClick={() => move(closePurchaseOrder, "closedOn")}>
                Close
              </button>
            )}
          </>
        )}
      </div>
      {status === "DRAFT" && (
        <p className="max-w-xs text-right text-xs text-ink-muted">
          Marking as issued counts this as committed and locks its lines. Nothing is sent to the vendor.
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
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
