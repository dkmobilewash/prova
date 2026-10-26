/**
 * WHAT ONE GC IS QUOTED — the estimate's total plus that GC's own adjustment.
 *
 * A sub prices a job once and sends it to several GCs, often at different
 * numbers: a GC who always pays late gets a bump, a GC who is holding two
 * other jobs for you gets a discount, a GC who wants the stocking left out
 * gets a deduct. The estimate stays ONE estimate. Each invitation carries only
 * the DIFFERENCE — a dollar amount or a percent, signed, plus a short reason —
 * and the price is this function applied to the estimate's total.
 *
 * NOTHING DERIVED IS STORED. The price a GC is quoted is `estimate total +
 * adjustment`, recomputed every time, so a line edited on the estimate moves
 * every GC's price with it and no column can disagree with the lines. (What
 * the invitation's `bidAmount` records is a different fact: the number that
 * was actually SENT, entered by a person.)
 *
 * WHOLE CENTS, ARITHMETIC IN INTEGERS. A percent is stored in thousandths of a
 * percent (`7.25` is 7250), so the adjustment is
 * `round(estimateCents × thousandths / 100000)` with every operand an integer:
 * no float dust decides which side of a half-cent a price lands on. Halves
 * round away from zero, so +0.5¢ and −0.5¢ are the same size.
 *
 * A PRICE OF NOTHING IS REFUSED, in words. An adjustment that takes the price
 * to zero or below is a typo (−1,000 for −10%), not a quote, and a proposal
 * printed with it would be a document nobody should send.
 *
 * Pure. No database, no React.
 */

export type GcAdjustment = {
  /** Signed dollars added to (or, negative, taken off) the estimate total. */
  amount?: number | null;
  /** Signed percent of the estimate total. Never both this and `amount`. */
  percent?: number | null;
};

export type GcPrice =
  | {
      ok: true;
      kind: "none" | "amount" | "percent";
      estimateCents: number;
      /** Signed. Zero when there is no adjustment. */
      adjustmentCents: number;
      priceCents: number;
    }
  | { ok: false; error: string };

/** Dollars to whole cents without float dust (`1.005 * 100` is 100.49999…). */
export function toCents(dollars: number): number {
  const sign = dollars < 0 ? -1 : 1;
  return sign * Math.round(Number((Math.abs(dollars) * 100).toFixed(6)));
}

/** The percent's integer form, thousandths of a percent. */
export function toThousandths(percent: number): number {
  const sign = percent < 0 ? -1 : 1;
  return sign * Math.round(Number((Math.abs(percent) * 1000).toFixed(6)));
}

/** `estimateCents × thousandths-of-a-percent`, rounded half away from zero. */
export function percentOfCents(estimateCents: number, thousandths: number): number {
  const sign = (estimateCents < 0 ? -1 : 1) * (thousandths < 0 ? -1 : 1);
  const product = Math.abs(estimateCents) * Math.abs(thousandths);
  return sign * Math.floor((product + 50000) / 100000);
}

const MAX_PERCENT = 100;

export function gcPrice(estimateTotal: number, adjustment: GcAdjustment | null | undefined): GcPrice {
  const estimateCents = toCents(estimateTotal);
  const amount = adjustment?.amount ?? null;
  const percent = adjustment?.percent ?? null;

  if (amount !== null && percent !== null) {
    return { ok: false, error: "A GC's adjustment is a dollar amount or a percent, not both." };
  }
  if ((amount !== null && !Number.isFinite(amount)) || (percent !== null && !Number.isFinite(percent))) {
    return { ok: false, error: "That adjustment isn't a number." };
  }
  if (percent !== null && Math.abs(percent) > MAX_PERCENT) {
    return { ok: false, error: `A percent adjustment can't be more than ${MAX_PERCENT}% either way.` };
  }

  const kind = amount !== null ? "amount" : percent !== null ? "percent" : "none";
  const adjustmentCents =
    amount !== null ? toCents(amount) : percent !== null ? percentOfCents(estimateCents, toThousandths(percent)) : 0;
  const priceCents = estimateCents + adjustmentCents;

  if (kind !== "none" && priceCents <= 0) {
    return {
      ok: false,
      error: "That adjustment would take this GC's price to zero or below. Check the amount or percent.",
    };
  }
  return { ok: true, kind, estimateCents, adjustmentCents, priceCents };
}

// ── what a person typed ───────────────────────────────────────────────────

export type GcAdjustmentInput = {
  kind: string;
  value: string;
  reason: string;
};

export type ParsedAdjustment =
  | { ok: true; amount: number | null; percent: number | null; reason: string | null }
  | { ok: false; error: string; field: "value" | "reason" | "kind" };

const REASON_MAX = 200;
const AMOUNT_MAX = 100_000_000;

/** "1,250.50", "-$300", "(300)" → a number, or null when it isn't one. */
function parseSigned(raw: string): number | null {
  let text = raw.trim().replace(/[$,\s]/g, "");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  text = text.replace(/%$/, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const value = Number(text);
  return negative ? -value : value;
}

/**
 * The form's three fields as an adjustment. `kind` is "none" (clear it),
 * "amount" or "percent". A value is a SIGNED number — minus is a discount —
 * and a reason is required whenever there is an adjustment, because "why does
 * this GC pay 4% more" is the question the next person will ask.
 */
export function parseGcAdjustment(input: GcAdjustmentInput): ParsedAdjustment {
  if (input.kind === "none" || input.kind === "") {
    return { ok: true, amount: null, percent: null, reason: null };
  }
  if (input.kind !== "amount" && input.kind !== "percent") {
    return { ok: false, field: "kind", error: "Pick a dollar amount, a percent, or no adjustment." };
  }
  const value = parseSigned(input.value);
  if (value === null) {
    return {
      ok: false,
      field: "value",
      error: input.kind === "amount" ? "Enter the amount in dollars, e.g. -2,500 or 1,200." : "Enter the percent, e.g. -3 or 4.5.",
    };
  }
  if (value === 0) {
    return { ok: false, field: "value", error: "An adjustment of zero is no adjustment. Pick “No adjustment” instead." };
  }
  if (input.kind === "amount" && Math.abs(value) > AMOUNT_MAX) {
    return { ok: false, field: "value", error: "That amount is too large." };
  }
  if (input.kind === "percent" && Math.abs(value) > MAX_PERCENT) {
    return { ok: false, field: "value", error: `A percent can't be more than ${MAX_PERCENT}% either way.` };
  }
  const reason = input.reason.trim();
  if (!reason) {
    return { ok: false, field: "reason", error: "Say why in a few words, e.g. “pays net 60” or “second job for them”." };
  }
  if (reason.length > REASON_MAX) {
    return { ok: false, field: "reason", error: `Keep the reason under ${REASON_MAX} characters.` };
  }
  return input.kind === "amount"
    ? { ok: true, amount: value, percent: null, reason }
    : { ok: true, amount: null, percent: value, reason };
}

// ── the words ─────────────────────────────────────────────────────────────

/** "+$1,200.00", "−$300.00", "+4.5%" — the adjustment as it was entered. */
export function adjustmentLabel(adjustment: GcAdjustment | null | undefined, format: (dollars: number) => string): string | null {
  if (!adjustment) return null;
  if (adjustment.amount != null) {
    return `${adjustment.amount < 0 ? "−" : "+"}${format(Math.abs(adjustment.amount))}`;
  }
  if (adjustment.percent != null) {
    return `${adjustment.percent < 0 ? "−" : "+"}${Math.abs(adjustment.percent)}%`;
  }
  return null;
}

// ── a project's GCs side by side ──────────────────────────────────────────

export type GcPriceRowInput = {
  invitationId: string;
  adjustment: GcAdjustment | null;
};

export type GcPriceRow =
  | { invitationId: string; ok: true; price: Extract<GcPrice, { ok: true }> }
  | { invitationId: string; ok: false; error: string };

/**
 * Every invitation's price off ONE estimate total. `null` total (no estimate
 * yet) yields no rows' prices at all rather than prices off zero.
 */
export function projectGcPrices(estimateTotal: number | null, invitations: readonly GcPriceRowInput[]): GcPriceRow[] {
  if (estimateTotal === null) return [];
  return invitations.map((invitation) => {
    const price = gcPrice(estimateTotal, invitation.adjustment);
    return price.ok
      ? { invitationId: invitation.invitationId, ok: true as const, price }
      : { invitationId: invitation.invitationId, ok: false as const, error: price.error };
  });
}
