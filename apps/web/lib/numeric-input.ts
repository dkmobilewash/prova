/**
 * The one place this app decides what a typed number means.
 *
 * WHY THIS EXISTS. Fourteen separate parsers in `lib/actions/` each wrote
 * their own `const n = Number(raw); if (Number.isNaN(n)) …`, and every one
 * of them refused `2,800` — the thousands comma a contractor writes without
 * thinking. Reproduced 2026-09-21 on step 2 of the new-job wizard, on the
 * SECOND SCREEN of creating a first job: quantity `2,800`, "Add line", and
 * the line was not added. `Number("2,800")` is `NaN`, the parser threw a
 * plain `Error`, and production redacted the message to the digest
 * paragraph — so the screen said nothing about commas at all.
 *
 * Meanwhile `lib/ask/numbers.ts` — the AI command path — has always
 * accepted `$12,500`, `12,500.00` and `12500` as one amount, and its own
 * header says it normalises them "to the form the action's own
 * `decimalFromForm` accepts". The product had already decided tolerant
 * parsing was right; it just did it for the robot and not for the person.
 * That is the same contractor typing the same number into the same product
 * and getting two answers, which is why this is one module and not a
 * fifteenth parser.
 *
 * THE POLICY, in one line: strip what a human writes around a number, then
 * validate what is left STRICTLY, and refuse anything ambiguous with a
 * sentence rather than a guess.
 *
 * WHAT IS STRIPPED (all of it decoration, none of it magnitude):
 *   - surrounding whitespace, including the non-breaking and narrow spaces
 *     that come off a spreadsheet paste;
 *   - a leading currency marker: `$`, `USD`, `US$`;
 *   - a trailing `%` — a percent field's own suffix, typed back at it;
 *   - a leading `+`;
 *   - thousands separators, but ONLY in well-formed groups (see below).
 *
 * WHAT IS REFUSED, and why each one is refused rather than guessed:
 *   - `12,50`. In the US that is a typo; in Europe it is twelve and a half.
 *     Stripping the comma would silently store 1250 — a hundredfold error
 *     on an invoice. So a comma is accepted ONLY where it separates three
 *     digits from three digits: `2,800` and `1,234,567.89` are numbers,
 *     `12,50` and `1,2345` are a question this module will not answer.
 *   - `(500)`. Accountants mean -500; a contractor may mean a note. One
 *     reading is a credit and the other is a charge, so it asks.
 *   - `1e5`, `0x10`, `0b11`, `Infinity`. TODAY THESE ARE ACCEPTED, which is
 *     the quieter half of this bug: the old parser gated on
 *     `Number.isNaN(Number(value))` and then returned the RAW STRING, so
 *     `Number("0x10")` being 16 let the literal text `0x10` through to a
 *     Postgres `numeric` column, and `1e999` got there as `Infinity`.
 *     Nobody types these into a quantity box; they are what a fuzzer or a
 *     bad paste produces, and letting them reach the database is how a
 *     total becomes `Infinity`. Refused by name so the message says so.
 *
 * THE RETURN IS A NORMALISED PLAIN DECIMAL STRING, never a JS number. The
 * columns behind these fields are `@db.Decimal`, and a float round-trip is
 * exactly how money loses a cent. `"2,800"` comes back as `"2800"`,
 * `"$12,500.00"` as `"12500.00"` — the digits the person typed, with the
 * decoration removed and nothing rounded.
 *
 * NOT a "use server" module and not in the actions barrel: pure functions,
 * imported directly, same rule as `lib/actions/shared.ts`.
 */

/** What the parser gives back. `value` is safe to hand to Prisma as a
 * Decimal; `n` is the same figure as a JS number, for bounds checks and for
 * the callers whose column is an `Int`. */
export type NumericInput =
  | { ok: true; value: string; n: number }
  | { ok: false; error: string };

export type NumericInputOptions = {
  /** How the field is named in the refusal — "Quantity", "Unit price".
   * Falls back to "That value" so a message is never `"undefined" must be
   * a number`. */
  label?: string;
  /** Reject anything below this, inclusive. */
  min?: number;
  /** Reject anything above this, inclusive. */
  max?: number;
  /** Reject a fractional part. For day counts, period numbers, sort order. */
  integer?: boolean;
  /** Reject more decimal places than the column can hold. The money columns
   * are `Decimal(_, 2)`, and Postgres ROUNDS a third place silently — so a
   * hand-typed 1.005 becomes 1.01 with nothing said. */
  maxDecimals?: number;
  /** What to call the unit in a bounds message: "10" reads better as
   * "between 0 and 100%" than "between 0 and 100". */
  unit?: string;
};

/**
 * Unicode whitespace that a paste can carry into a form field and that
 * `String.prototype.trim()` alone does not always make obvious: NBSP
 * (U+00A0), the narrow no-break space Excel uses as a thousands separator
 * in some locales (U+202F), and the thin/figure spaces (U+2007, U+2009).
 * `trim()` does remove these — they are Unicode space separators — but they
 * also appear INSIDE a pasted figure ("12 500"), which trim cannot reach.
 */
const SPACE = /[\s    ]+/g;

/** A canonical decimal, after decoration is removed: optional sign, digits,
 * optional fractional part. Deliberately no exponent, no `0x`, no `Infinity`
 * — see the header. `.5` and `5.` are allowed because people type them. */
const CANONICAL = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** Digits grouped in threes, the way a person writes a thousands separator:
 * `2,800`, `1,234,567`, `12,345,678`. Not `12,50`, not `1,2345`. */
const GROUPED = /^\d{1,3}(?:,\d{3})+$/;

/** Named forms JS's `Number()` accepts and a contractor never types. Kept
 * as a list so the refusal can say WHICH one was spotted — "that looks like
 * a hex number" is a sentence somebody can act on; "not a number" over the
 * text `0x10` is not. */
const NOT_TYPED_BY_A_PERSON: Array<{ test: RegExp; says: string }> = [
  { test: /^[+-]?0x[0-9a-f]+$/i, says: "hex" },
  { test: /^[+-]?0b[01]+$/i, says: "binary" },
  { test: /^[+-]?0o[0-7]+$/i, says: "octal" },
  { test: /^[+-]?infinity$/i, says: "infinity" },
  { test: /^[+-]?\d*\.?\d+e[+-]?\d+$/i, says: "scientific notation" },
];

function nameOf(options: NumericInputOptions | undefined): string {
  return options?.label ?? "That value";
}

/**
 * Parse one typed figure. `raw` is whatever `FormData.get` returned, so it
 * may be a `File`, `null` or a string.
 *
 * A blank field is `{ ok: false }` here with a "needs a number" message —
 * callers that treat blank as "not set" check for blankness themselves via
 * `isBlank` before calling, which keeps the two meanings of empty apart
 * rather than encoding both in one return.
 */
export function parseNumericInput(raw: unknown, options?: NumericInputOptions): NumericInput {
  const label = nameOf(options);
  const text = typeof raw === "string" ? raw : "";
  const trimmed = text.trim();

  if (!trimmed) {
    return { ok: false, error: `${label} needs a number.` };
  }

  // Decoration off, in the order a person writes it: currency in front,
  // percent behind, internal spaces anywhere.
  let cleaned = trimmed
    .replace(SPACE, "")
    .replace(/^(?:us\$|usd|\$)/i, "")
    .replace(/%$/, "")
    .replace(/^\+/, "");

  if (!cleaned) {
    return { ok: false, error: `${label} needs a number — ${quote(trimmed)} has no digits in it.` };
  }

  for (const { test, says } of NOT_TYPED_BY_A_PERSON) {
    if (test.test(cleaned)) {
      return {
        ok: false,
        error: `${label} doesn't take ${says}. Type the figure out in full, like 2,800 or 12500.50.`,
      };
    }
  }

  if (/^\(.*\)$/.test(cleaned)) {
    return {
      ok: false,
      error:
        `${label}: brackets can mean a negative or a note, so this asks rather than guesses. ` +
        `Type ${quote("-" + cleaned.slice(1, -1))} if you meant a negative.`,
    };
  }

  // Thousands separators. Split the sign and the fractional part off first
  // so the grouping check only ever looks at the integer digits — a comma
  // after the decimal point is never a thousands separator.
  const sign = cleaned.startsWith("-") ? "-" : "";
  const unsigned = sign ? cleaned.slice(1) : cleaned;
  const dot = unsigned.indexOf(".");
  const whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot === -1 ? "" : unsigned.slice(dot);

  if (whole.includes(",")) {
    if (!GROUPED.test(whole)) {
      return {
        ok: false,
        error:
          `${label}: ${quote(trimmed)} isn't a number this understands. A comma separates ` +
          `thousands — 2,800 or 1,234,567 — so it has to have three digits after it.`,
      };
    }
    cleaned = sign + whole.replace(/,/g, "") + fraction;
  }

  if (fraction.includes(",")) {
    return {
      ok: false,
      error: `${label}: ${quote(trimmed)} has a comma after the decimal point, so it isn't a figure this understands.`,
    };
  }

  if (!CANONICAL.test(cleaned)) {
    // An INTEGER field says so here rather than after the parse. "Sort
    // order has to be a whole number" is the sentence for `first`; the
    // generic one invites somebody to add a decimal point to it.
    return {
      ok: false,
      error: options?.integer
        ? `${label} has to be a whole number — ${quote(trimmed)} isn't one.`
        : `${label}: ${quote(trimmed)} isn't a number. Digits, one decimal point, and commas between thousands.`,
    };
  }

  const n = Number(cleaned);
  // Belt and braces: CANONICAL cannot match a form Number() rejects, but a
  // 400-digit literal overflows to Infinity while matching it fine.
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${label}: ${quote(trimmed)} is too big a number for this field.` };
  }

  const decimals = fraction ? fraction.replace(/^\./, "").length : 0;
  if (options?.maxDecimals !== undefined && decimals > options.maxDecimals) {
    return {
      ok: false,
      error:
        options.maxDecimals === 0
          ? `${label} has to be a whole number.`
          : `${label} keeps ${options.maxDecimals} decimal place${options.maxDecimals === 1 ? "" : "s"} — ` +
            `${quote(trimmed)} has ${decimals}.`,
    };
  }

  if (options?.integer && !Number.isInteger(n)) {
    return { ok: false, error: `${label} has to be a whole number.` };
  }

  const unit = options?.unit ?? "";
  if (options?.min !== undefined && n < options.min) {
    return {
      ok: false,
      error:
        options.max !== undefined
          ? `${label} has to be between ${options.min}${unit} and ${options.max}${unit}.`
          : options.min === 0
            ? `${label} can't be negative.`
            : `${label} has to be ${options.min}${unit} or more.`,
    };
  }
  if (options?.max !== undefined && n > options.max) {
    return {
      ok: false,
      error:
        options.min !== undefined
          ? `${label} has to be between ${options.min}${unit} and ${options.max}${unit}.`
          : `${label} has to be ${options.max}${unit} or less.`,
    };
  }

  // The canonical string, not `String(n)`: a float round-trip is what turns
  // 12500.00 into 12500 and 0.1 + 0.2 into a support ticket. Only the
  // decoration has gone.
  return { ok: true, value: normalise(sign, cleaned), n };
}

/** `.5` -> `0.5`, `5.` -> `5`, `-0` -> `0`, `007` -> `7`. Postgres takes all
 * four, but the string is also what an Ask card and a confirm dialog print
 * back, and `5.` on a confirmation reads like a truncation. */
function normalise(sign: string, cleaned: string): string {
  const unsigned = sign ? cleaned.slice(1) : cleaned;
  const dot = unsigned.indexOf(".");
  let whole = dot === -1 ? unsigned : unsigned.slice(0, dot);
  let fraction = dot === -1 ? "" : unsigned.slice(dot + 1);
  whole = whole.replace(/^0+(?=\d)/, "");
  if (whole === "") whole = "0";
  fraction = fraction.replace(/0+$/, "");
  const body = fraction ? `${whole}.${fraction}` : whole;
  if (body === "0" || /^0\.0*$/.test(body)) return "0";
  return sign + body;
}

function quote(text: string): string {
  // Long paste, short message: a person does not need 300 characters of
  // their own typo read back at them.
  const shown = text.length > 24 ? `${text.slice(0, 24)}…` : text;
  return `“${shown}”`;
}

/** True when a field was left empty — the "not set" case, distinct from
 * "typed something that is not a number". Uses the same whitespace rule as
 * the parser so the two can never disagree about what empty means. */
export function isBlank(raw: unknown): boolean {
  return (typeof raw === "string" ? raw : "").trim() === "";
}

/**
 * "unitPrice" -> "Unit price", "daysAway" -> "Days away".
 *
 * Every parser call site passes a form key, and the old messages read it
 * back verbatim — `"unitPrice" must be a number`, quotes and camelCase and
 * all, which is a name out of the HTML rather than anything on the screen.
 * A caller that wants better still passes `label`; this is what the rest
 * get for free.
 */
export function labelFromKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  if (!spaced) return "That value";
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The two form readers a module needs, throwing ITS OWN error class.
 *
 * WHY A FACTORY AND NOT TWO EXPORTED FUNCTIONS. Ten action modules each
 * declare a private `class InputError extends Error {}` and each catches
 * `err instanceof InputError` against its own copy. A shared helper
 * throwing the shared class would sail straight through every one of those
 * catches and land in production as a redacted digest — the exact failure
 * this whole change exists to remove, reintroduced by the fix for it. So
 * the RULE about what a number is stays in one place and the error plumbing
 * stays where the catch is:
 *
 *     const { number, optionalNumber } = numericReaders((m) => { throw new InputError(m); });
 *
 * `raise` returns `never`, so TypeScript narrows the failure branch away
 * and callers get `{ ok: true; value; n }` with no check of their own.
 */
export function numericReaders(raise: (message: string) => never) {
  function number(formData: FormData, key: string, options?: NumericInputOptions) {
    const parsed = parseNumericInput(formData.get(key), { label: labelFromKey(key), ...options });
    if (!parsed.ok) raise(parsed.error);
    return parsed;
  }

  /** null means the field was left blank, which is a valid "not recorded"
   * for every caller that uses this reader rather than `number`. */
  function optionalNumber(formData: FormData, key: string, options?: NumericInputOptions) {
    const raw = formData.get(key);
    if (isBlank(raw)) return null;
    return number(formData, key, options);
  }

  return { number, optionalNumber };
}

/**
 * The bounds a percentage field carries, in one place because getting them
 * wrong is silent.
 *
 * `Job.retainagePercent` is `Decimal(5, 2)` with NO application bound, so
 * typing `0.10` meaning ten percent stored one TENTH of one percent, and
 * every invoice made afterwards withheld a hundredth of what the contract
 * said. Nothing on the screen contradicted it. A percent is a number
 * between 0 and 100 here — never a fraction of one — and the inputs say so
 * with a `%` next to the box, because a bound alone cannot tell the
 * difference between 0.10 meaning a tenth of a percent and 0.10 typed by
 * somebody thinking in fractions.
 */
export const PERCENT_BOUNDS = { min: 0, max: 100, unit: "%" } as const;
