// Buyout: what each scope line was budgeted at, what the vendors quoted, and
// what has been drafted or committed against it. Pure; the query hands this
// plain values.
//
// COMMITTED IS NOT COST. lib/open-commitments.ts records the agreement and the
// reason: a committed figure folded into actuals is the failure, not the fix.
// So nothing here feeds WIP, job cost or percent complete, it sits beside them.
//
// DRAFT is not a commitment either. Only ISSUED and CLOSED count.
//
// Quotes are compared per unit and never converted, the rule currentByUnit
// already follows: a price per MSF beside a line in SF is shown, not offered.

import { currentByUnit, unitKey, type QuoteData } from "@/components/vendorPricing";
import type { CostCategory } from "@/lib/cost-category";
import { money } from "@/lib/money";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type PurchaseOrderStatus = "DRAFT" | "ISSUED" | "CLOSED";

export const COMMITTED_STATUSES: readonly PurchaseOrderStatus[] = ["ISSUED", "CLOSED"];

export interface PoLineForSum {
  lineItemId: string;
  quantity: number;
  unitPrice: number;
  status: PurchaseOrderStatus;
}

export interface LineCommitment {
  /** On a PO still being written. */
  drafted: number;
  /** On an issued or closed PO. */
  committed: number;
  /** Quantity on any PO, drafted or committed. */
  quantityBought: number;
}

export function poLineAmount(line: { quantity: number; unitPrice: number }): number {
  return round2(line.quantity * line.unitPrice);
}

export function commitmentsByLine(lines: readonly PoLineForSum[]): Map<string, LineCommitment> {
  const out = new Map<string, LineCommitment>();
  for (const line of lines) {
    const row = out.get(line.lineItemId) ?? { drafted: 0, committed: 0, quantityBought: 0 };
    const amount = poLineAmount(line);
    if (COMMITTED_STATUSES.includes(line.status)) row.committed = round2(row.committed + amount);
    else row.drafted = round2(row.drafted + amount);
    row.quantityBought = round2(row.quantityBought + line.quantity);
    out.set(line.lineItemId, row);
  }
  return out;
}

/** What the Estimate tab says on a line's closed row. Null when nothing is on
 * a PO. Shown beside Actual, never added to it. */
export function commitmentNote(line: LineCommitment | undefined): string | null {
  const parts = [
    line?.committed ? `Committed ${money(line.committed)}` : "",
    line?.drafted ? `Drafted on a PO ${money(line.drafted)}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface BuyoutLineInput {
  id: string;
  description: string;
  unit: string | null;
  quantity: number;
  /** JobLineItem.budgetedUnitCost: the cost the bid carried. */
  budgetedUnitCost: number | null;
  costCategory: CostCategory | null;
  /** The catalog item this line came from; how quotes are matched to it. */
  catalogEntryId: string | null;
}

/** Labor is the sub's own crew, so there is nothing to buy out. */
export function isBuyoutLine(line: Pick<BuyoutLineInput, "costCategory">): boolean {
  return line.costCategory !== "LABOR";
}

export interface QuoteOffer {
  quoteId: string;
  vendorId: string;
  vendorName: string;
  unitPrice: number;
  quotedOn: string;
  /** What this quote comes to for the quantity still to buy. */
  extended: number;
  /** Against the budget for that quantity. Positive is over budget. Null when
   * the line carries no budgeted cost. */
  overBudget: number | null;
  cheapest: boolean;
}

export interface BuyoutRow {
  line: BuyoutLineInput;
  budget: number | null;
  drafted: number;
  committed: number;
  /** Line quantity not yet on any PO, floored at zero. */
  quantityLeft: number;
  offers: QuoteOffer[];
  /** Live quotes in a different unit: shown, never offered or converted. */
  otherUnits: { vendorName: string; unit: string | null; unitPrice: number }[];
  /** The words of every live quote above, in any unit, for the spec word search. */
  quoteTexts: { vendorName: string; description: string | null; notes: string | null }[];
}

export function buyoutRows(
  lines: readonly BuyoutLineInput[],
  quotes: readonly QuoteData[],
  commitments: ReadonlyMap<string, LineCommitment>,
  today: string,
): BuyoutRow[] {
  return lines.filter(isBuyoutLine).map((line) => {
    const done = commitments.get(line.id) ?? { drafted: 0, committed: 0, quantityBought: 0 };
    const quantityLeft = Math.max(0, round2(line.quantity - done.quantityBought));
    const forEntry = line.catalogEntryId
      ? quotes.filter((quote) => quote.catalogEntryId === line.catalogEntryId)
      : [];
    const comparisons = currentByUnit([...forEntry], today);
    const same = comparisons.find((c) => unitKey(c.unit) === unitKey(line.unit));
    const offers: QuoteOffer[] = (same?.quotes ?? []).map((quote, index) => ({
      quoteId: quote.id,
      vendorId: quote.vendorId,
      vendorName: quote.vendorName,
      unitPrice: quote.unitPrice,
      quotedOn: quote.quotedOn,
      extended: round2(quantityLeft * quote.unitPrice),
      overBudget: line.budgetedUnitCost == null ? null : round2(quantityLeft * (quote.unitPrice - line.budgetedUnitCost)),
      cheapest: index === 0,
    }));
    const otherUnits = comparisons
      .filter((c) => c !== same)
      .flatMap((c) => c.quotes.map((quote) => ({ vendorName: quote.vendorName, unit: quote.unit, unitPrice: quote.unitPrice })));
    return {
      line,
      budget: line.budgetedUnitCost == null ? null : round2(line.quantity * line.budgetedUnitCost),
      drafted: done.drafted,
      committed: done.committed,
      quantityLeft,
      offers,
      otherUnits,
      quoteTexts: comparisons.flatMap((c) =>
        c.quotes.map((quote) => ({
          vendorName: quote.vendorName,
          description: quote.description ?? null,
          notes: quote.notes ?? null,
        })),
      ),
    };
  });
}
