/**
 * What a purchase order adds up to — in dollars AND in units.
 *
 * DERIVED, NEVER STORED. No line total and no order total is a column: a
 * stored total can disagree with the numbers beneath it, and then two
 * answers to the same question are on screen at once. Same rule as actual
 * cost on `JobLineItem` and amount paid on `Invoice`.
 *
 * A plain module, imported by both the server page and the client row, so
 * neither can grow its own arithmetic. It is also why this is not exported
 * from a `"use client"` file: a constant or function exported from one
 * crosses the RSC boundary as a client-reference proxy.
 *
 * THE UNITS TOTAL TOO, and that is the half a money-only total loses. The
 * customer's own example was "Quiet Rock, 104 sheets at 32 square foot per
 * sheet" — the person reading that order needs to know it is 104 sheets as
 * much as they need to know what 104 sheets costs, because 104 sheets is
 * what arrives on the truck and what gets counted at the gate.
 *
 * QUANTITIES ARE TOTALLED PER UNIT AND NEVER ACROSS UNITS. 104 sheets plus
 * 2,400 linear feet is not 2,504 of anything. `VendorPriceQuote.unit`
 * states the same rule for the same reason: a vendor who sells by the
 * sheet has not sold by the square foot, and inventing the factor between
 * them invents a number nobody quoted.
 */

export type PurchaseOrderLineTotals = {
  quantity: number;
  unit: string | null;
  unitCost: number;
};

/** One unit's share of an order: "104 sheets", "2400 LF". */
export type UnitTotal = { unit: string; quantity: number };

/**
 * Arithmetic in whole cents, then back to dollars.
 *
 * `quantity * unitCost` in floating point gives 0.30000000000000004 for
 * 3 x 0.10, and a purchase order is a document a vendor invoices against —
 * a cent of drift on screen is a phone call. Both operands are
 * `Decimal(12, 2)` in the database, so rounding each to hundredths first is
 * lossless rather than an approximation, and the product of two hundredths
 * is exact in ten-thousandths.
 */
export function lineTotal(line: { quantity: number; unitCost: number }): number {
  const quantityHundredths = Math.round(line.quantity * 100);
  const costCents = Math.round(line.unitCost * 100);
  return Math.round((quantityHundredths * costCents) / 100) / 100;
}

/** What the whole order commits, in dollars. Sums the ROUNDED line totals,
 * because the line totals are the figures on screen and a total that does
 * not equal the visible column is the thing being checked with a
 * calculator. */
export function orderTotal(lines: PurchaseOrderLineTotals[]): number {
  const cents = lines.reduce((sum, line) => sum + Math.round(lineTotal(line) * 100), 0);
  return cents / 100;
}

/**
 * Quantity per unit, in the order the units first appear on the order.
 *
 * Grouping is case- and space-insensitive ("Sheets", "sheets" and " sheets"
 * are one unit) but the SPELLING SHOWN is the first one the person typed,
 * because it is their document and normalising their words on screen is a
 * correction nobody asked for.
 *
 * Lines with no unit are absent rather than grouped under an empty label: a
 * lump-sum line has no quantity worth counting, and a bucket called "" at
 * the bottom of the list reads like a bug.
 */
export function unitTotals(lines: PurchaseOrderLineTotals[]): UnitTotal[] {
  const byKey = new Map<string, UnitTotal & { hundredths: number }>();
  for (const line of lines) {
    const unit = (line.unit ?? "").trim();
    if (!unit) continue;
    const key = unit.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.hundredths += Math.round(line.quantity * 100);
    else byKey.set(key, { unit, quantity: 0, hundredths: Math.round(line.quantity * 100) });
  }
  return [...byKey.values()].map((entry) => ({
    unit: entry.unit,
    quantity: entry.hundredths / 100,
  }));
}

/** "104 sheets · 2,400 LF", or null when no line carries a unit. For the
 * one-line summary under an order's heading. */
export function unitSummary(lines: PurchaseOrderLineTotals[]): string | null {
  const totals = unitTotals(lines);
  if (totals.length === 0) return null;
  return totals
    .map((t) => `${t.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${t.unit}`)
    .join(" · ");
}
