import { money } from "@/lib/money";
import { parseNumericInput } from "@/lib/numeric-input";

/**
 * "ADD 10% FOR NIGHT WORK" — THE ARITHMETIC, AND NOTHING ELSE.
 *
 * The Ask command `adjust_estimate` (lib/ask/commands/estimating.ts) turns a
 * contractor's sentence into one lump-sum line on an estimate. The model
 * hands over the person's own words — a kind, the figure as typed, a label —
 * and every dollar on the card is computed HERE, by code, from the bid as it
 * stands. That is the product rule ARCHITECTURE.md states for any AI feature
 * that sits on estimating numbers: the arithmetic is deterministic and the
 * model only narrates what it is handed.
 *
 * Pure: no Prisma, no session, no clock. The command reads the lines and
 * passes the bid in as whole cents; this decides what the figure means,
 * whether it is sane, and what the card and the line's description say.
 *
 * ── THE ROUNDING RULE ──
 *
 * A percentage of a bid is computed in INTEGER cents (BigInt, so a large bid
 * times a two-decimal percentage cannot lose a digit to floating point), and
 * the result is rounded to the nearest cent with HALF A CENT ROUNDING AWAY
 * FROM ZERO. The rounding is applied to the magnitude and the sign put back
 * afterwards, so 3% off and 3% on the same bid are the same number of cents
 * in opposite directions — a discount never rounds differently from the
 * charge it mirrors.
 *
 * ── WHAT IS REFUSED, AND WHY EACH IS A SENTENCE RATHER THAN A CARD ──
 *
 *   - a percentage over 100, or a discount of 100% or more: no confirmation
 *     by anybody makes "take 150% off" a bid, so there is nothing for a
 *     person to decide (the same line `> 100` draws in the sub-listing
 *     parser's percentage claim);
 *   - zero, of either kind: a line that adds nothing is not a line;
 *   - a percentage of an estimate with no priced line: 10% of $0 is $0, and
 *     a card saying so would look like a bug rather than an empty estimate;
 *   - a dollar discount as large as the whole bid: it would take the bid to
 *     nothing or below;
 *   - a minus sign without the person saying "off" or "discount": a negative
 *     figure is allowed ONLY on an explicit discount instruction, so a stray
 *     hyphen cannot turn a charge into a credit;
 *   - a figure whose own decoration contradicts its kind ("10%" sent as an
 *     amount, "$2,500" sent as a percent): the person's typing outranks the
 *     model's classification, and a mismatch is a question, not a guess.
 */

export type AdjustmentKind = "percent" | "amount";

export type AdjustmentInput = {
  /** What the model said the figure is. Absent means "infer it from how the
   * person wrote it" — a `%` or a `$` decides; neither is a question. */
  kind: string | undefined;
  /** The figure exactly as typed: "10%", "$2,500", "3". */
  value: string;
  /** The line's name in the person's words: "Night work". */
  label: string;
  /** True only when the person said off / discount / less / take away. */
  off: boolean;
  /** The bid as it stands, in whole cents, over the live lines. */
  baseCents: number;
};

export type AdjustmentPlan =
  | {
      ok: true;
      kind: AdjustmentKind;
      /** The signed figure that goes on the line, in whole cents. */
      amountCents: number;
      baseCents: number;
      /** For a percentage, its magnitude in hundredths of a percent (10% is
       * 1000). Null for a dollar figure. */
      percentHundredths: number | null;
      /** True when the percentage did not land on a whole cent. */
      rounded: boolean;
      /** "Night work — 10% of $78,350.00 = $7,835.00". */
      cardLine: string;
      /** The estimate line's description, which has to explain itself on the
       * job page long after the card is gone. */
      description: string;
      /** The unit price to post, as a plain two-place decimal: "7835.00". */
      unitPrice: string;
    }
  | { ok: false; reason: string; question?: boolean };

/** The longest label carried onto a line; the person's words, clipped. */
export const MAX_LABEL = 80;

/** Whole cents from a dollar total such as `bidTotalOf` returns. */
export function centsOf(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Dollars, for the card and the description, from whole cents. */
export function dollars(cents: number): string {
  return money(cents / 100);
}

/** `percentHundredths` of `baseCents`, rounded half away from zero. */
export function percentOfCents(baseCents: number, percentHundredths: number): { cents: number; rounded: boolean } {
  const product = BigInt(Math.abs(baseCents)) * BigInt(Math.abs(percentHundredths));
  let quotient = product / 10000n;
  const remainder = product % 10000n;
  if (remainder * 2n >= 10000n) quotient += 1n;
  const sign = Math.sign(baseCents) * Math.sign(percentHundredths) < 0 ? -1 : 1;
  return { cents: sign * Number(quotient), rounded: remainder !== 0n };
}

/** "10%", "2.5%", "3.33%" — the person's percentage, written back. */
export function percentText(hundredths: number): string {
  const whole = Math.trunc(hundredths / 100);
  const fraction = String(hundredths % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}%`;
}

/** A normalised decimal string ("2.5", "-3", "10") as hundredths. The
 * parser has already capped it at two places, so this is exact. */
function hundredthsOf(normalised: string): number {
  const negative = normalised.startsWith("-");
  const [whole, fraction = ""] = (negative ? normalised.slice(1) : normalised).split(".");
  const magnitude = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return negative ? -magnitude : magnitude;
}

const PERCENT_WORDS = /\s*(?:%|percent|per\s*cent|pct)\s*$/i;
const CURRENCY = /^\s*[-+]?\s*(?:\$|usd|us\$)|\b(?:dollars?|bucks)\s*$/i;

/** Which kind the person's own typing says it is, or null when it does not. */
function kindWritten(value: string): AdjustmentKind | null {
  if (PERCENT_WORDS.test(value)) return "percent";
  if (CURRENCY.test(value)) return "amount";
  return null;
}

export function planEstimateAdjustment(input: AdjustmentInput): AdjustmentPlan {
  const label = input.label.trim().replace(/\s+/g, " ").slice(0, MAX_LABEL).trim();
  const typed = input.value.trim();
  const written = kindWritten(typed);
  const said = input.kind === "percent" || input.kind === "amount" ? input.kind : null;

  if (said && written && said !== written) {
    return {
      ok: false,
      reason:
        written === "percent"
          ? `"${typed}" reads as a percentage, not a dollar figure. Say which you meant.`
          : `"${typed}" reads as a dollar figure, not a percentage. Say which you meant.`,
      question: true,
    };
  }
  const kind = written ?? said;
  if (!kind) {
    return { ok: false, reason: `Is "${typed}" a percentage of the bid or a dollar figure?`, question: true };
  }

  // The parser strips a leading `$` but not one behind a sign, and "-$500"
  // is how a discount gets typed, so the sign is moved in front of the
  // digits here. Nothing else is rewritten: the parser's refusals stand.
  const bare =
    kind === "percent"
      ? typed.replace(PERCENT_WORDS, "")
      : typed.replace(/\s*(?:dollars?|bucks)\s*$/i, "").replace(/^([-+]?)\s*(?:us\$|usd|\$)\s*/i, "$1");
  const parsed = parseNumericInput(bare, {
    label: kind === "percent" ? "The percentage" : "The amount",
    maxDecimals: 2,
  });
  if (!parsed.ok) return { ok: false, reason: parsed.error };

  if (parsed.n < 0 && !input.off) {
    return {
      ok: false,
      reason: `A minus figure takes money off the bid. If that is what you mean, say "take ${typed.replace(/^\s*-\s*/, "")} off" so it is entered as a discount.`,
    };
  }
  const off = input.off;

  if (kind === "percent") {
    const hundredths = Math.abs(hundredthsOf(parsed.value));
    if (hundredths === 0) return { ok: false, reason: "0% adds nothing, so there is no line to add." };
    if (!off && hundredths > 100_00) {
      return { ok: false, reason: `${percentText(hundredths)} is more than the whole bid again. A percentage added to a bid has to be 100% or less.` };
    }
    if (off && hundredths >= 100_00) {
      return { ok: false, reason: `Taking ${percentText(hundredths)} off would leave the bid at nothing or less. A discount has to be under 100%.` };
    }
    if (input.baseCents <= 0) {
      return {
        ok: false,
        reason: `There is no priced line on this estimate yet, so ${percentText(hundredths)} of it would be $0.00. Price the estimate first, or give a dollar figure instead.`,
      };
    }
    const { cents: magnitude, rounded } = percentOfCents(input.baseCents, hundredths);
    if (magnitude === 0) {
      return { ok: false, reason: `${percentText(hundredths)} of ${dollars(input.baseCents)} rounds to $0.00, so there is no line to add.` };
    }
    const amountCents = off ? -magnitude : magnitude;
    const pct = percentText(hundredths);
    const how = off ? `${pct} off ${dollars(input.baseCents)}` : `${pct} of ${dollars(input.baseCents)}`;
    return {
      ok: true,
      kind,
      amountCents,
      baseCents: input.baseCents,
      percentHundredths: hundredths,
      rounded,
      cardLine: `${label} — ${how} = ${dollars(amountCents)}`,
      description: `${label} — ${how} (the bid before this line)`,
      unitPrice: (amountCents / 100).toFixed(2),
    };
  }

  const magnitude = Math.abs(hundredthsOf(parsed.value));
  if (magnitude === 0) return { ok: false, reason: "$0.00 adds nothing, so there is no line to add." };
  if (off && magnitude >= input.baseCents) {
    return {
      ok: false,
      reason: `Taking ${dollars(magnitude)} off would leave the bid, ${dollars(Math.max(input.baseCents, 0))} so far, at nothing or less.`,
    };
  }
  const amountCents = off ? -magnitude : magnitude;
  return {
    ok: true,
    kind,
    amountCents,
    baseCents: input.baseCents,
    percentHundredths: null,
    rounded: false,
    cardLine: off ? `${label} — ${dollars(magnitude)} off = ${dollars(amountCents)}` : `${label} — ${dollars(amountCents)}`,
    description: off ? `${label} — ${dollars(magnitude)} off` : label,
    unitPrice: (amountCents / 100).toFixed(2),
  };
}
