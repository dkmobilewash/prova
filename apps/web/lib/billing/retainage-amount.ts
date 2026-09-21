/**
 * THE retainage formula. There is exactly one, and this file is it.
 *
 * WHY IT IS ITS OWN MODULE. Until now there were two, in two files, and
 * they disagreed:
 *
 *   lib/billing/create-invoice.ts  (Number(amount) * (pct / 100)).toFixed(2)
 *   lib/actions/billing.ts         ((amount * Number(pct)) / 100).toFixed(2)
 *
 * Both are IEEE-754 arithmetic on money, and they do not associate the same
 * way, so they round to different cents. Bill $1,000.35 at 10% as a
 * lump-sum invoice and the snapshot is $100.04; bill the identical figure
 * as a pay application and it is $100.03. Swept across every cent from
 * $1,000 to $100,000 at 10%, 3.21% of amounts came out different. Measured
 * against exact decimal over 1.9M amounts, the first expression was wrong
 * 37,893 times and the second 91,200 — so this was not one good path and
 * one bad path. It was two bad paths that happened to disagree.
 *
 * `Invoice.retainageWithheld` is snapshotted at creation and deliberately
 * never recomputed (see the field comment in billing.prisma), so the wrong
 * cent is permanent, on a document the GC has already been sent, and a
 * subcontractor reconciles these against the GC's own ledger every month.
 *
 * ── HOW THE ARITHMETIC IS DONE, AND WHY NOT decimal.js ────────────────
 *
 * The obvious choice was `Prisma.Decimal`, which this repo already has:
 * every money column in billing.prisma is `Decimal @db.Decimal(12, 2)`, so
 * Prisma hands back Decimal values and takes decimal strings on the way in.
 * It is the right library and the wrong import. `@prisma/client` is not a
 * dependency of `apps/web` and does not resolve from it; the only way to
 * reach Decimal here is `import { Prisma } from "@prova/db"`, and 119 test
 * files in this package mock that module with `{ prisma }` alone. Ten of
 * them broke the moment this file imported it — not because they touch
 * retainage, but because they transitively reach an invoice write — and
 * every future mock would break the same way. That is a trap to plant in
 * the codebase, not a dependency to add.
 *
 * So the arithmetic here is exact INTEGER arithmetic on `bigint`, and it is
 * worth being precise about what that is and is not. It is NOT the
 * `Math.round(value * 100)` cent math used elsewhere in this repo
 * (`cents()` in cash-flow.ts and retainage-release.ts): that starts from a
 * float and is a rounding step wearing a conversion's clothes. Nothing
 * here is ever a float. Decimal strings are parsed digit by digit into a
 * scaled `bigint`, multiplied exactly, and divided once with an explicit
 * rounding rule.
 *
 * The identity that makes it a single multiplication: retainage in CENTS is
 * `amount x percent` exactly, since `(amount x percent / 100) x 100`
 * cancels. There is no division by 100 anywhere in this file — only the
 * division that removes the inputs' own decimal scaling.
 *
 * `retainage-amount.test.ts` checks every result against an independent
 * oracle built on real decimal.js (which a TEST may import from
 * `@prova/db`, because a test file is not on any mocked import path). Two
 * unrelated implementations agreeing over ~120,000 swept values is a
 * stronger statement than either one alone.
 *
 * ── ROUNDING: HALF-UP ────────────────────────────────────────────────
 *
 * Away from zero on an exact half, stated here because a rounding rule
 * that is not written down is a rounding rule that gets changed by
 * accident. $1,000.35 x 10% is exactly $100.035 — a real half-cent, not
 * float dust — and it becomes $100.04.
 *
 * Half-up is the commercial convention a GC's accounting department and
 * QuickBooks both use, so half-even ("banker's rounding") would make this
 * product's snapshot disagree with the certificate on the other side of the
 * table for precisely the amounts a human notices. It is also what the
 * lump-sum expression happened to produce for the reproduction case, so
 * snapshots already in the database that were written that way stay
 * correct.
 */

/** Anything a Decimal column round-trips as: a Prisma `Decimal`, the
 * decimal string a form submits, or a JS number. Structural on purpose —
 * naming `Prisma.Decimal` here would drag `@prova/db` back in, and a
 * Decimal satisfies this already. */
export type MoneyLike = string | number | { toString(): string };

/** Optional sign, digits, optional fraction, optional exponent — i.e.
 * everything `Number.prototype.toString` can produce and everything
 * Postgres returns for a `numeric`. */
const DECIMAL_TEXT = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;

/** A decimal as an exact integer and the power of ten it is scaled by, so
 * that the value is `units / 10 ** scale`. No float is constructed. */
function parseDecimal(raw: string, what: string): { units: bigint; scale: number } {
  const text = raw.trim();
  const match = DECIMAL_TEXT.exec(text);
  if (!match) {
    // A genuine bug, not a person's mistake: every caller validates its
    // input first (`decimalFromForm`, or a Decimal straight off a row).
    // CLAUDE.md's rule is that `throw` is for bugs and a returned
    // ActionResult is for refusals, and this is the former.
    throw new Error(`retainageWithheldFor: ${what} is not a decimal number: ${JSON.stringify(raw)}`);
  }
  const [, sign, whole, fraction = "", exponent = "0"] = match;
  const digits = whole + fraction;
  let units = BigInt(digits);
  // Scale after applying any exponent. "1e-7" is scale 7; "1.5e3" is 1500.
  let scale = fraction.length - Number(exponent);
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units: sign === "-" ? -units : units, scale };
}

/** `cents` as the decimal string a `Decimal(12, 2)` column stores. Never
 * exponential notation, which Postgres rejects for a numeric column. */
function formatCents(cents: bigint): string {
  const negative = cents < 0n;
  const magnitude = negative ? -cents : cents;
  const whole = magnitude / 100n;
  const remainder = magnitude % 100n;
  return `${negative ? "-" : ""}${whole}.${remainder.toString().padStart(2, "0")}`;
}

/**
 * The retainage a GC withholds from one invoice, as the decimal string the
 * `Decimal(12, 2)` column stores.
 *
 * Null when the job has no retainage rate, which is NOT the same as zero: a
 * null means "these contract terms have no retainage clause", while "0.00"
 * means a rate applies and it withheld nothing this period.
 *
 * PASS THE AMOUNT THAT WILL BE STORED ON THE INVOICE, not the running float
 * a caller happened to sum it from. The retainage has to be a function of
 * the figure printed on the document; derive it from anything else and the
 * two disagree by a cent with nothing on the page to explain why.
 * `submitPayApplication` therefore fixes its total to two decimal places
 * first and passes that same string both to this and to the `amount`
 * column.
 */
export function retainageWithheldFor(
  amount: MoneyLike,
  retainagePercent: MoneyLike | null | undefined,
): string | null {
  if (retainagePercent == null) return null;

  const a = parseDecimal(amount.toString(), "amount");
  const p = parseDecimal(retainagePercent.toString(), "retainage percent");

  // Cents, before the inputs' own decimal scaling is removed. See the
  // identity in the header: retainage in cents is amount x percent.
  const numerator = a.units * p.units;
  const denominator = 10n ** BigInt(a.scale + p.scale);

  // Truncating division, then half-up applied by hand so the rule is
  // visible rather than inherited from a library default.
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const doubled = remainder < 0n ? -remainder * 2n : remainder * 2n;
  if (doubled < denominator) return formatCents(quotient);
  return formatCents(numerator < 0n ? quotient - 1n : quotient + 1n);
}
