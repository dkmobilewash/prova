import { money } from "@/lib/money";
import { parseNumericInput } from "@/lib/numeric-input";

/**
 * "ADD A LINE FOR 40 HOURS OF CLEANUP AT $65" — THE ARITHMETIC, AND NOTHING
 * ELSE.
 *
 * The Ask command `add_estimate_line` (lib/ask/commands/estimating.ts) puts one
 * priced line on an estimate from a sentence. The model hands over the
 * person's own words — a description, the quantity, the unit and the price as
 * typed, and optionally a cost — and this module decides what those figures
 * mean, whether they are sane, and what the card says. The line total and the
 * bid after it are computed here, never by the model.
 *
 * It is the sibling of `estimate-adjustment.ts` and deliberately not the same
 * function: that one computes an AMOUNT from the bid ("add 10%"); this one
 * takes a PRICE the person stated and multiplies it by a quantity they stated.
 * Nothing on this card is derived from the bid except the "bid with this line"
 * total, which is the bid plus the product.
 *
 * Pure: no Prisma, no session, no clock.
 *
 * ── THE NUMBERS, AND THE COLUMNS THEY LAND IN ──
 *
 * `JobLineItem.quantity`, `unitPrice` and `budgetedUnitCost` are all
 * `Decimal(12, 2)`, and Postgres ROUNDS a third place silently. So every
 * figure here is parsed by the app's one numeric parser
 * (`lib/numeric-input.ts`, the same one the job page's form runs) with
 * `maxDecimals: 2`, and a third place is REFUSED rather than rounded: "$4.505
 * a foot" is a question about the person's price, not something to settle on
 * their behalf. Shorthand ("2.5k", "about 60") is refused by that parser for
 * the same reason.
 *
 * The line total is computed in integer cents (BigInt): quantity in hundredths
 * times price in cents, divided by 100, half a cent rounding away from zero —
 * the same rule `estimate-adjustment.ts` states. With both inputs at two
 * places the product can carry a fraction of a cent (12.5 × $4.45 = $55.625),
 * and the card says so when it does.
 */

export type TypedLineInput = {
  description: string;
  quantity: string;
  unit: string | undefined;
  unitPrice: string;
  unitCost: string | undefined;
  /** The bid as it stands, in whole cents, over the live lines. */
  baseCents: number;
};

export type TypedLinePlan =
  | {
      ok: true;
      description: string;
      /** Normalised decimal strings, as the form would post them. */
      quantity: string;
      unit: string | null;
      unitPrice: string;
      unitCost: string | null;
      /** quantity × price, whole cents. */
      totalCents: number;
      /** quantity × cost, whole cents, when a cost was given. */
      costCents: number | null;
      rounded: boolean;
      /** "Cleanup — 40 HR × $65.00 = $2,600.00". */
      cardLine: string;
      /** "40 HR × $40.00 = $1,600.00", when a cost was given. */
      costLine: string | null;
    }
  | { ok: false; reason: string };

export const MAX_DESCRIPTION = 120;
export const MAX_UNIT = 12;

/**
 * Units the way a contractor says them, written the way an estimate prints
 * them. Only the unambiguous ones: anything not here is kept as the person
 * typed it (clipped), because a unit is the person's word and a wrong
 * normalisation — "ft" read as square feet — would change what the price is
 * per.
 */
const UNIT_WORDS: Record<string, string> = {
  hr: "HR", hrs: "HR", hour: "HR", hours: "HR", "man hour": "HR", "man hours": "HR", "man-hours": "HR",
  sf: "SF", "sq ft": "SF", "sq. ft.": "SF", sqft: "SF", "square foot": "SF", "square feet": "SF",
  lf: "LF", "lin ft": "LF", "linear foot": "LF", "linear feet": "LF",
  sy: "SY", "square yard": "SY", "square yards": "SY",
  ea: "EA", each: "EA",
  ls: "LS", "lump sum": "LS",
  day: "DAY", days: "DAY",
};

export function unitOf(raw: string | undefined): string | null {
  const typed = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!typed) return null;
  return UNIT_WORDS[typed.toLowerCase()] ?? typed.slice(0, MAX_UNIT);
}

/** A normalised two-place decimal string as hundredths: "40" → 4000. */
function hundredthsOf(normalised: string): number {
  const [whole, fraction = ""] = normalised.replace(/^-/, "").split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** The quantity as written back: "40", "12.5". */
function quantityText(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

/** quantity (hundredths) × price (cents), in cents, half away from zero. */
export function lineTotalCents(quantityHundredths: number, priceCents: number): { cents: number; rounded: boolean } {
  const product = BigInt(quantityHundredths) * BigInt(priceCents);
  let quotient = product / 100n;
  const remainder = product % 100n;
  if (remainder * 2n >= 100n) quotient += 1n;
  return { cents: Number(quotient), rounded: remainder !== 0n };
}

function positive(raw: string, label: string): { ok: true; value: string; hundredths: number } | { ok: false; reason: string } {
  const parsed = parseNumericInput(raw, { label, maxDecimals: 2 });
  if (!parsed.ok) return { ok: false, reason: parsed.error };
  if (parsed.n <= 0) return { ok: false, reason: `${label} has to be more than zero — ${JSON.stringify(raw.trim())} isn't.` };
  if (parsed.n >= 1e10) return { ok: false, reason: `${label}: ${JSON.stringify(raw.trim())} is too big a number for an estimate line.` };
  return { ok: true, value: parsed.value, hundredths: hundredthsOf(parsed.value) };
}

export function planTypedLine(input: TypedLineInput): TypedLinePlan {
  const description = input.description.trim().replace(/\s+/g, " ").slice(0, MAX_DESCRIPTION).trim();
  if (!description) return { ok: false, reason: "The line needs a description." };

  const quantity = positive(input.quantity, "The quantity");
  if (!quantity.ok) return quantity;
  const price = positive(input.unitPrice, "The unit price");
  if (!price.ok) return price;
  const cost = input.unitCost?.trim() ? positive(input.unitCost, "The unit cost") : null;
  if (cost && !cost.ok) return cost;

  const unit = unitOf(input.unit);
  const per = unit ? ` ${unit}` : "";
  const qty = quantityText(quantity.hundredths);
  const total = lineTotalCents(quantity.hundredths, price.hundredths);
  const costTotal = cost ? lineTotalCents(quantity.hundredths, cost.hundredths) : null;

  return {
    ok: true,
    description,
    quantity: quantity.value,
    unit,
    unitPrice: (price.hundredths / 100).toFixed(2),
    unitCost: cost ? (cost.hundredths / 100).toFixed(2) : null,
    totalCents: total.cents,
    costCents: costTotal ? costTotal.cents : null,
    rounded: total.rounded || (costTotal?.rounded ?? false),
    cardLine: `${description} — ${qty}${per} × ${money(price.hundredths / 100)} = ${money(total.cents / 100)}`,
    costLine: cost && costTotal ? `${qty}${per} × ${money(cost.hundredths / 100)} = ${money(costTotal.cents / 100)}` : null,
  };
}
