/**
 * Reading a dimension the way it is printed on a drawing.
 *
 * A calibration asks somebody to type what the drawing says, and what the
 * drawing says is `24'-6"`, not `24.5`. Refusing that — or worse, reading the
 * `24` and dropping the six inches — would put a 2% error into the scale of
 * every quantity taken off the sheet, silently, which is the exact failure
 * `takeoff.ts` warns about.
 *
 * THIS IS NOT A SECOND NUMBER PARSER, and the distinction matters because
 * `numericInputCensus.test.ts` exists to stop one appearing. Anything without
 * a foot or inch mark goes straight to `parseNumericInput` untouched, and even
 * the pieces of a feet-inches string are parsed by it — so the thousands
 * comma, the currency sign, the unicode space and the bounds checks all behave
 * here exactly as they do everywhere else. What this module adds is only the
 * grammar of feet and inches, and it returns the same `NumericInput` shape so
 * callers cannot tell the difference.
 *
 * Pure. No database, no React.
 */

import { isBlank, parseNumericInput, type NumericInput, type NumericInputOptions } from "@/lib/numeric-input";

/** Foot and inch marks, straight and typographic. A drawing exported from CAD
 * uses the straight ones; a person typing on a Mac gets the curly ones from
 * autocorrect, and being strict about which is which would refuse a correct
 * dimension for a reason nobody could see. */
const FOOT_MARKS = /['′’]/;
const INCH_MARKS = /["″”]/;

const nameOf = (options?: NumericInputOptions): string => options?.label ?? "That value";

/** One piece of the string — the feet, the whole inches, a numerator —
 * through the app's own parser rather than a second one. */
function piece(raw: string, label: string, options: NumericInputOptions): NumericInput {
  return parseNumericInput(raw, { ...options, label, min: 0 });
}

/**
 * Parse a dimension into DECIMAL FEET.
 *
 * Accepts what an estimator actually types:
 *
 *     24'-6"      24' 6"      24'6"      24'       6"
 *     24'-6 1/2"  24-6        24.5       24
 *
 * `24-6` is deliberately read as 24 feet 6 inches rather than as negative
 * twenty-four or as a subtraction: a bare hyphen between two numbers is how
 * the dimension is written on half the drawings in circulation, and there is
 * no competing meaning for it in this field.
 */
export function parseFeetInches(raw: unknown, options?: NumericInputOptions): NumericInput {
  const label = nameOf(options);
  const text = typeof raw === "string" ? raw : "";
  const trimmed = text.trim();

  if (isBlank(trimmed)) {
    return { ok: false, error: `${label} needs a measurement.` };
  }

  const hasFootMark = FOOT_MARKS.test(trimmed);
  const hasInchMark = INCH_MARKS.test(trimmed);
  const bareHyphen = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:\s+\d+\/\d+)?\s*$/.test(trimmed);

  // No marks and no `24-6` shape: an ordinary decimal. One parser, untouched.
  if (!hasFootMark && !hasInchMark && !bareHyphen) {
    return parseNumericInput(raw, options);
  }

  // Inches only — `6"`.
  if (!hasFootMark && hasInchMark) {
    const inches = inchesFrom(trimmed.replace(INCH_MARKS, "").trim(), label, options);
    if (!inches.ok) return inches;
    return feetResult(inches.n / 12, label, options);
  }

  // Split at the foot mark, or at the bare hyphen when there is none.
  const splitAt = hasFootMark ? trimmed.search(FOOT_MARKS) : trimmed.indexOf("-");
  const feetText = trimmed.slice(0, splitAt).trim();
  const inchText = trimmed
    .slice(splitAt + 1)
    .replace(INCH_MARKS, "")
    .replace(/^-/, "")
    .trim();

  const feet = piece(feetText, label, options ?? {});
  if (!feet.ok) return feet;

  if (!inchText) return feetResult(feet.n, label, options);

  const inches = inchesFrom(inchText, label, options);
  if (!inches.ok) return inches;

  // 18 inches in the inches slot is a typo for 1'-6", not a dimension. Saying
  // so is cheaper than silently accepting a foot and a half of scale error.
  if (inches.n >= 12) {
    return { ok: false, error: `${label}: ${inchText}" is more than a foot — write it as feet and inches.` };
  }

  return feetResult(feet.n + inches.n / 12, label, options);
}

/** Whole inches, or whole inches and a fraction: `6`, `6 1/2`, `1/2`. */
function inchesFrom(text: string, label: string, options?: NumericInputOptions): NumericInput {
  const opts = options ?? {};
  const fraction = text.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
  if (!fraction) return piece(text, label, opts);

  const [, wholeText, numeratorText, denominatorText] = fraction;
  const whole = wholeText ? piece(wholeText, label, opts) : ({ ok: true, value: "0", n: 0 } as const);
  if (!whole.ok) return whole;
  const numerator = piece(numeratorText, label, opts);
  if (!numerator.ok) return numerator;
  const denominator = piece(denominatorText, label, opts);
  if (!denominator.ok) return denominator;
  if (denominator.n === 0) {
    return { ok: false, error: `${label}: ${text}" is not a measurement.` };
  }

  const n = whole.n + numerator.n / denominator.n;
  return { ok: true, value: n.toFixed(4), n };
}

/** Re-apply the caller's bounds to the assembled figure, so `min`/`max` mean
 * the same thing whether the dimension arrived as `24.5` or as `24'-6"`. */
function feetResult(n: number, label: string, options?: NumericInputOptions): NumericInput {
  const { min, max } = options ?? {};
  if (min !== undefined && n < min) {
    return { ok: false, error: `${label} must be at least ${min} ft.` };
  }
  if (max !== undefined && n > max) {
    return { ok: false, error: `${label} must be ${max} ft or less.` };
  }
  return { ok: true, value: n.toFixed(4), n };
}

/**
 * Render decimal feet the way a drawing prints it, for reading a figure back
 * to somebody who typed one. `24.5` becomes `24'-6"`.
 *
 * Rounds to the nearest inch on purpose: this is a readback of a dimension a
 * person typed off a title block, and printing `24'-5.997"` would make a
 * correct entry look wrong.
 */
export function formatFeetInches(feet: number): string {
  if (!Number.isFinite(feet)) return "";
  const sign = feet < 0 ? "-" : "";
  const total = Math.round(Math.abs(feet) * 12);
  const wholeFeet = Math.floor(total / 12);
  const inches = total % 12;
  return `${sign}${wholeFeet}'-${inches}"`;
}
