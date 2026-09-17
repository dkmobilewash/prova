import { Prisma } from "@prova/db";
import { money } from "./money";

/**
 * Overhead and profit — the explicit line between the subtotal and the
 * total on a change-order request.
 *
 * WHY THIS IS ITS OWN MODULE. Three surfaces print this block: the change
 * order on /jobs/[id], the same change order on the GC's /portal page, and
 * the approval that turns the amount into a real JobLineItem. If any two of
 * them did their own arithmetic they would eventually disagree about a
 * number a GC is holding a signed copy of, which is the #46/#97 shape (two
 * retainage figures eighteen inches apart) applied in advance.
 *
 * THE ONE RULE EVERYTHING ELSE FOLLOWS FROM: an unset rate is NOT a zero
 * rate.
 *
 *   null  -> nobody has recorded a rate. The line prints "Not set", the
 *            amount is null, and the total EQUALS the subtotal because
 *            nothing was added — not because zero was.
 *   0     -> somebody said zero. The line prints "0%" and "$0.00", and the
 *            total equals the subtotal because zero was added.
 *
 * Both totals are the same number and they are different claims, and only
 * one of them should make a PM go and check the contract. This is the same
 * refusal-to-guess `estimateBurdenedLaborCost` makes about a fringe
 * schedule and `lib/wip.ts` makes about a line with no cost forecast:
 * showing a wrong burden is worse than showing none, because a wrong one
 * gets bid.
 *
 * Decimal throughout, never `number`. The amount computed here is written
 * to a `Decimal(12,2)` column on a document a GC signs; routing it through
 * a float first is how a total comes to end in a cent nobody can account
 * for.
 */

/** The label on the line itself, wherever it prints. */
export const OVERHEAD_AND_PROFIT_LABEL = "Overhead and profit";

/** What prints where the money would go when no rate has been recorded.
 * Deliberately a sentence fragment a reader will not mistake for a number. */
export const OVERHEAD_AND_PROFIT_NOT_SET = "Not set";

/**
 * The sentence shown under an unset line. It says what the total DOES —
 * "this is a subtotal wearing the word Total" — rather than naming a
 * missing field, because the consequence is what makes somebody act.
 */
export const OVERHEAD_AND_PROFIT_UNSET_NOTE =
  "No overhead and profit rate has been recorded, so none is included in this total. Set one on the change order, or a company default in Settings → Company.";

/* NOTHING IS READ OFF `Prisma` AT MODULE LOAD, and that is load-bearing
   rather than style. `parseOverheadAndProfitPercent` below is pure string
   work, and it is imported by `lib/actions/company.ts` — which is executed
   by `lib/action-capability-guards.test.ts` against a Prisma stub that
   THROWS on every property read, precisely so it can prove an action
   refuses before it queries anything. A top-level `new Prisma.Decimal(0)`
   made that whole module fail to import, and took two suites down with it.
   So the Decimal machinery is touched only inside the functions that do
   arithmetic. */

/** A rate as it arrives from Prisma or a form: a Decimal, a numeric string,
 * or null for "nobody has said". */
export type PercentInput = Prisma.Decimal | string | number | null | undefined;

function toDecimal(value: Prisma.Decimal | string | number): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/**
 * The subtotal / overhead-and-profit / total block for one document.
 *
 * `percent` null is the unset case and is the only case where `amount` is
 * null. Callers that render this must branch on `isSet` rather than on
 * `amount === 0` — the whole point is that those are different.
 */
export interface OverheadAndProfitBlock {
  /** What the line items come to, before any markup. */
  subtotal: Prisma.Decimal;
  /** The rate, or null when none has been recorded. Never coerced to 0. */
  percent: Prisma.Decimal | null;
  /** subtotal x percent / 100, rounded half-up to the cent. Null — NOT
   * zero — when no rate has been recorded. */
  amount: Prisma.Decimal | null;
  /** subtotal + amount. Exactly `subtotal` when the rate is unset, because
   * an unset rate is EXCLUDED from the total rather than added as zero. */
  total: Prisma.Decimal;
  /** Whether a rate has been recorded at all. */
  isSet: boolean;
}

/**
 * Builds the block. The only arithmetic in the feature.
 *
 * A negative subtotal (a credit change order) carries its markup back with
 * it: the GC gets the O&P off the deducted work as well as the work. That
 * keeps `total = subtotal x (1 + rate)` true in both directions, which is
 * the identity the tests assert and the one a GC's cost engineer checks.
 */
export function overheadAndProfitBlock(
  subtotal: Prisma.Decimal | string | number,
  percent: PercentInput,
): OverheadAndProfitBlock {
  const sub = toDecimal(subtotal);

  if (percent === null || percent === undefined) {
    return { subtotal: sub, percent: null, amount: null, total: sub, isSet: false };
  }

  const rate = toDecimal(percent);
  /* Half-up to the cent, the rounding a printed dollar amount implies.
     `Prisma.Decimal` is decimal.js, whose ROUND_HALF_UP is 4; the constant
     is read off the class rather than hardcoded so an upgrade that
     renumbered them could not silently change every change order's total. */
  const amount = sub.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  return { subtotal: sub, percent: rate, amount, total: sub.add(amount), isSet: true };
}

/**
 * "15%", "12.5%", or "Not set".
 *
 * Trailing zeros go, because the column stores 15.00 and nobody writes a
 * change order for fifteen point zero zero percent. `Decimal.toString()`
 * already drops them; this exists so the three surfaces cannot each invent
 * their own formatting for the same stored value.
 */
export function formatOverheadAndProfitPercent(percent: PercentInput): string {
  if (percent === null || percent === undefined) return OVERHEAD_AND_PROFIT_NOT_SET;
  return `${toDecimal(percent).toDecimalPlaces(2).toString()}%`;
}

/** The label with its rate in it: "Overhead and profit (15%)", or plain
 * "Overhead and profit" when there is no rate to name. */
export function overheadAndProfitLineLabel(percent: PercentInput): string {
  if (percent === null || percent === undefined) return OVERHEAD_AND_PROFIT_LABEL;
  return `${OVERHEAD_AND_PROFIT_LABEL} (${formatOverheadAndProfitPercent(percent)})`;
}

/**
 * What prints in the amount column of the line: a dollar figure, or "Not
 * set".
 *
 * This is the function that must never return "$0.00" for an unset rate,
 * and the reason it takes the whole block rather than the amount: an
 * `amount` of null formatted by a caller doing `money(Number(amount ?? 0))`
 * is exactly the bug, and it is one keystroke away at every call site.
 */
export function formatOverheadAndProfitAmount(block: OverheadAndProfitBlock): string {
  if (!block.isSet || block.amount === null) return OVERHEAD_AND_PROFIT_NOT_SET;
  return money(block.amount.toNumber());
}

/** The description written onto the JobLineItem an approved change order
 * creates for its overhead and profit, so the line reads as what it is
 * wherever it turns up — the contract summary, a pay application, the GC's
 * portal. */
export function overheadAndProfitLineDescription(
  changeOrderNumber: number,
  percent: Prisma.Decimal | string | number,
): string {
  return `${OVERHEAD_AND_PROFIT_LABEL} (${formatOverheadAndProfitPercent(percent)}) — CO #${changeOrderNumber}`;
}

/** A validated rate, or the sentence to show instead. Never a throw:
 * production redacts a thrown Server Action message to a digest, so a
 * refusal has to travel as data. */
export type ParsedPercent = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * Reads a rate off a form.
 *
 * Blank means NOT SET and is valid — clearing the field is how somebody
 * says "we have not decided", and refusing it would force a fake zero,
 * which is the exact confusion this whole module exists to prevent.
 *
 * The bounds are not decoration. A negative markup is a discount somebody
 * typed by accident, and a rate above 100 is nearly always a decimal
 * mistyped as a percentage (0.15 entered as 15 is fine; 15 entered as 1500
 * is not) — either one silently rewrites the total on a document that goes
 * to a GC.
 */
export function parseOverheadAndProfitPercent(raw: string): ParsedPercent {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };

  const cleaned = trimmed.endsWith("%") ? trimmed.slice(0, -1).trim() : trimmed;
  const parsed = Number(cleaned);
  if (cleaned === "" || !Number.isFinite(parsed)) {
    return {
      ok: false,
      error:
        "Overhead and profit has to be a percentage, like 15 for 15%. Leave it blank if you have not decided — blank reads as “not set”, not as zero.",
    };
  }
  if (parsed < 0) {
    return {
      ok: false,
      error:
        "Overhead and profit cannot be negative. A credit change order already carries the markup back with it — the negative sign belongs on the scope, not on the rate.",
    };
  }
  if (parsed > 100) {
    return {
      ok: false,
      error: `${cleaned}% overhead and profit would more than double the total. Enter it as a percentage — 15 for 15%, not 1500.`,
    };
  }

  return { ok: true, value: cleaned };
}
