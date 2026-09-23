/**
 * THE NUMBER-PROVENANCE GUARD: every number the answer says out loud must
 * appear in a tool result.
 *
 * WHY THIS EXISTS, AND WHY A PROMPT LINE IS NOT ENOUGH. `answer.ts`'s
 * system prompt already says "Never do arithmetic", in those words, with
 * the reason: every figure a tool hands over was computed by the same code
 * that renders the screens this person looks at, so a number the model
 * works out itself can disagree with their own dashboard — and then they
 * have two answers and no way to tell which is right. That instruction has
 * already been broken once in production. Ask answered "three overdue
 * invoices" and listed four, against a tile reading four, because it had
 * been handed rows and no count; the fix was to hand it a count, and the
 * lesson recorded in `forModel` was that a number the model derives can
 * drift between two runs of the same question.
 *
 * A prompt line is a promise. This file is a check. It is the safety catch
 * Cyrus asked for before the box is allowed to COMBINE several tool results
 * into prose — the composition itself is a later change, and the only thing
 * that makes it safe to attempt is that an untraceable figure cannot reach
 * the person.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS TRACEABLE
 *
 * Two sources, and deliberately only two:
 *
 *   1. THE TOOL RESULTS OF THIS TURN, as the strings the model was actually
 *      handed — `outcome.content`, after `forModel` has capped the rows and
 *      added the count. Not `result.data`: the model never saw that, and a
 *      guard that checks a richer set than the model was given would pass
 *      figures the model could not have read.
 *   2. THE PERSON'S OWN QUESTION. "log a 12,500 check against invoice 3" and
 *      then an answer repeating 12,500 is the person's own number coming
 *      back, not an invention.
 *
 * NOT prior turns. A figure quoted from an earlier answer is a figure that
 * may have stopped being true, which is exactly what `turns.ts` says memory
 * must never carry; if the model re-read the rows it is in a tool result and
 * passes anyway. NOT the system prompt.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THERE IS ALMOST NO "IGNORE" LIST
 *
 * The obvious design is to classify numbers and check only the "real"
 * figures — skipping dates, years, job numbers, phone numbers, RFI numbers.
 * That is backwards here, and the reason is the system prompt's own
 * standing rule: "Every fact in your answer must come from a tool call in
 * this conversation. You have no other knowledge of this company." A date
 * the model states came from a tool. An RFI number came from a tool. A
 * phone number came from `contact_lookup`. So those do not need to be
 * exempted — they PASS, because they are in the tool text, and a date or a
 * case number that is NOT in the tool text is a fabrication worth catching.
 *
 * What they need is not an exemption but the right kind of match, which is
 * why a claim has two shapes:
 *
 *   - a FIGURE ("1,173.70", "35.3", "42", "62.5%", "2026") is matched by
 *     VALUE, so formatting cannot break it;
 *   - an IDENTIFIER — anything joined by `/`, `-` or `:`, which is every
 *     date ("2026-09-08", "10/3"), phone number ("555-0142"), sheet size
 *     ("5/8") and clock time ("3:30") this app produces — is matched by its
 *     digit groups appearing LITERALLY in the source text. A weaker check,
 *     honestly weaker, and the right one: these are strings the model copied
 *     rather than arithmetic it did.
 *
 * Exactly ONE thing is ignored outright: a list marker ("1." or "2)" at the
 * start of a line). It is punctuation, not a claim. The prompt forbids
 * numbered lists anyway — bullets are "• " — so this is belt and braces.
 *
 * Numbers inside a quoted tool message need no rule at all: quoting a tool
 * puts its digits in the tool text by definition.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ROUNDING RULE, AND WHY THIS ONE
 *
 * "About $47" from 46.95 is legitimate and useful. "$47" from 41.20 is the
 * exact failure this file exists to catch. The line between them has to be
 * drawn somewhere, and it is drawn here:
 *
 *   A figure written with `p` decimal places accounts for a source value
 *   `V` when `|V - figure| <= 0.5 / 10^p` — that is, when the figure is
 *   what you get by rounding `V` to the precision the figure was
 *   ACTUALLY WRITTEN WITH.
 *
 * So "47" (no decimals) accepts anything in [46.5, 47.5): 46.95 passes,
 * 46.5 passes, 46.49 does not, 41.20 does not. "$1,173.70" (two decimals)
 * accepts [1173.695, 1173.705), so `1173.7` passes and `1173.71` does not.
 * "35.3" accepts the floating-point sum `35.300000000000004` that
 * `render-hours.ts` exists to clean up.
 *
 * WHAT THIS RULE DELIBERATELY REFUSES: "about $47,000" from 46,950. The
 * figure is written to the units place, so the window is half a dollar, not
 * five hundred. Allowing significant-figure rounding instead would let
 * "$47,000" stand for anything in [46,500, 47,500) — a five-hundred-dollar
 * window on a figure somebody takes to a GC. The prompt already forbids the
 * model from rounding at all ("not 'roughly'"), and every tool returns an
 * exact figure, so the cost of this is a sentence style the model was told
 * not to use.
 *
 * SIGN IS NOT MATCHED. `money()` renders a negative as "-$500.00" and this
 * app's answers carry direction in words — owed, held, over, under — so
 * both sides are compared unsigned. A figure whose SIGN is wrong is a real
 * defect and this guard does not see it; it is not the defect this guard is
 * for.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THIS CANNOT DO, said plainly rather than discovered later
 *
 *   - SMALL INTEGERS ARE BARELY GUARDED. A tool result of forty rows holds
 *     hundreds of numbers, so almost any integer under about 30 is already
 *     somewhere in the source text. The guard is strong exactly where the
 *     money is — anything with more than two significant digits — and weak
 *     on "three of them are late". `count` is in every rowed tool result
 *     precisely so the model does not have to derive one.
 *   - A NUMBER SPELLED OUT IN WORDS ("three overdue invoices") carries no
 *     digits and is invisible here. That is the original production defect,
 *     and it is `forModel`'s count that addresses it, not this file.
 *   - WEB-SEARCH AND ATTACHMENT ANSWERS ARE NOT CHECKED AT ALL, by the
 *     caller rather than here — see `answer.ts`. A server-side web search's
 *     results never reach `execute`, and a PDF the person attached is not
 *     text this process can read, so in both cases the legitimate source is
 *     invisible and every real answer would be refused.
 */

/** One numeric run in the answer, and what became of it. Every digit
 * character in the answer belongs to exactly one of these — see
 * `digitsCovered`, which is the parse-integrity half of this file. */
export type NumberClaim = {
  /** Exactly as written, e.g. `1,173.70` out of `$1,173.70`. */
  text: string;
  start: number;
  end: number;
  kind:
    | /** Matched by value, with the rounding rule above. */ "figure"
    | /** Matched by its digit groups appearing literally. */ "identifier"
    | /** Not a claim at all. Only ever a list marker. */ "ignored";
  /** `figure` only: the value as written, unsigned. */
  value?: number;
  /** `figure` only: how many decimal places it was written with, which is
   * what sets the rounding window. */
  decimals?: number;
  /** `ignored` only: which rule, in words, for the log. */
  reason?: string;
  /** Whether a source accounts for it. Always true for `ignored`. */
  accounted: boolean;
  /** `figure` only, and only when unaccounted: the closest thing any source
   * offered. The whole point of logging a refusal — "said 47, nearest
   * figure in the rows was 41.2" is a sentence somebody can act on. */
  nearest?: number | null;
};

export type ProvenanceReport = {
  /** True when every claim is accounted for. */
  ok: boolean;
  /** The figures that are not, in the order they were written. */
  unaccounted: NumberClaim[];
  /** Every claim, including the accounted ones. */
  claims: NumberClaim[];
  /** How many claims were actually CHECKED — figures plus identifiers.
   * Asserted against a declared literal by the corpus test, because a
   * matcher that checks nothing passes everything. */
  checked: number;
  /** Digit characters in the answer, and how many of them a claim covers.
   * These MUST be equal. A pattern that stops matching makes `covered`
   * fall, which is the one failure an "is anything unaccounted?" question
   * cannot see: nothing is ever missing from an empty list. */
  digits: { total: number; covered: number };
  /** How many distinct values the sources offered. Zero on a question that
   * called no tool and typed no number, which is a legitimate state (a
   * refusal, a clarifying question) and not an error. */
  offered: number;
};

/** Every maximal run of digits, optionally joined by the characters this
 * app's own formatters put BETWEEN digits: `,` and `.` from `money()`,
 * `-` and `/` from dates and sheet sizes, `:` from clock times.
 *
 * A run always starts and ends on a digit, so a trailing sentence period
 * ("42.") is left outside it, and no digit anywhere can fall between two
 * runs — that is what makes the coverage count below meaningful rather
 * than decorative. */
const NUMERIC_RUN = /\d(?:[\d,.:/-]*\d)?/g;

/** A run that is a plain number: `42`, `2026`, `35.3`, `1,173.70`. The
 * comma form requires groups of exactly three, so `1,17` is not a number
 * with a thousands separator — it is two digit groups and gets the weaker
 * identifier treatment, which is the right answer for something nothing in
 * this app formats. */
const PLAIN_NUMBER = /^(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)$/;

/** The one thing ignored outright. `1.` or `2)` at the start of a line,
 * one or two digits. */
function isListMarker(text: string, source: string, start: number, end: number): boolean {
  if (!/^\d{1,2}$/.test(text)) return false;
  const after = source.slice(end, end + 2);
  if (!/^[.)](?:\s|$)/.test(after)) return false;
  const lineStart = source.lastIndexOf("\n", start - 1) + 1;
  return source.slice(lineStart, start).trim() === "";
}

function decimalsOf(text: string): number {
  const dot = text.indexOf(".");
  return dot === -1 ? 0 : text.length - dot - 1;
}

/** The digit groups inside an identifier run: `2026-09-08` -> 2026, 09, 08. */
function digitGroups(text: string): string[] {
  return text.split(/[^\d]+/).filter(Boolean);
}

/** A digit group with its leading zeros gone, so the ISO date `2026-09-08`
 * in a tool result accounts for the answer writing it back as `9/8`. Both
 * spellings go into the literal set and both are looked for, because the
 * app produces both: `dates.ts` stores and renders ISO, and a person on a
 * phone reads `10/3`. */
function unpadded(group: string): string {
  return String(Number(group));
}

/** Every value the sources offer, unsigned, plus every literal digit group
 * they contain.
 *
 * Deliberately permissive: this side is not trying to be minimal, it is
 * trying to answer "could the model have read this number from what it was
 * given". Leading zeros are stripped for the value set (`08` offers 8) and
 * kept for the literal set (`08` offers the string "08"), because a date
 * written back as "September 8" is a figure and a date written back as
 * "2026-09-08" is an identifier. */
function sourcesFrom(texts: string[]): { values: Set<number>; literals: Set<string> } {
  const values = new Set<number>();
  const literals = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(NUMERIC_RUN)) {
      const run = match[0];
      if (PLAIN_NUMBER.test(run)) {
        values.add(Math.abs(Number(run.replace(/,/g, ""))));
        literals.add(run.replace(/,/g, ""));
      }
      for (const group of digitGroups(run)) {
        literals.add(group);
        literals.add(unpadded(group));
        const asNumber = Number(group);
        if (Number.isFinite(asNumber)) values.add(Math.abs(asNumber));
      }
      // The run as written, so a date copied verbatim matches verbatim.
      literals.add(run);
    }
  }
  return { values, literals };
}

/**
 * The guard.
 *
 * @param answer      what the person will read — the text the Ask panel
 *                    will show, not the raw stream. See `answer.ts` for how
 *                    that is assembled and why the two must be the same
 *                    string.
 * @param toolResults every `outcome.content` the executor returned this
 *                    turn, in any order.
 * @param question    the person's own words.
 */
export function checkNumberProvenance(
  answer: string,
  toolResults: string[],
  question: string,
): ProvenanceReport {
  const { values, literals } = sourcesFrom([...toolResults, question]);
  const claims: NumberClaim[] = [];
  let covered = 0;

  for (const match of answer.matchAll(NUMERIC_RUN)) {
    const text = match[0];
    const start = match.index;
    const end = start + text.length;
    covered += digitGroups(text).join("").length;

    if (isListMarker(text, answer, start, end)) {
      claims.push({ text, start, end, kind: "ignored", reason: "list marker", accounted: true });
      continue;
    }

    if (PLAIN_NUMBER.test(text)) {
      const value = Math.abs(Number(text.replace(/,/g, "")));
      const decimals = decimalsOf(text);
      // The rounding rule, stated once: the figure accounts for a source
      // value when it is that value rounded to the precision the figure
      // was written with. Half a unit of the last written digit, no more.
      const window = 0.5 / 10 ** decimals;
      let accounted = false;
      let nearest: number | null = null;
      let best = Infinity;
      for (const candidate of values) {
        const distance = Math.abs(candidate - value);
        if (distance < best) {
          best = distance;
          nearest = candidate;
        }
        if (distance <= window) {
          accounted = true;
          break;
        }
      }
      claims.push({
        text,
        start,
        end,
        kind: "figure",
        value,
        decimals,
        accounted,
        ...(accounted ? {} : { nearest }),
      });
      continue;
    }

    // An identifier: a date, a phone number, a sheet size, a clock time.
    // Every digit group must appear literally in the source text.
    const groups = digitGroups(text);
    const accounted =
      literals.has(text) ||
      groups.every((group) => literals.has(group) || literals.has(unpadded(group)));
    claims.push({ text, start, end, kind: "identifier", accounted, ...(accounted ? {} : { nearest: null }) });
  }

  const total = (answer.match(/\d/g) ?? []).length;
  const unaccounted = claims.filter((claim) => !claim.accounted);
  return {
    ok: unaccounted.length === 0,
    unaccounted,
    claims,
    checked: claims.filter((claim) => claim.kind !== "ignored").length,
    digits: { total, covered },
    offered: values.size,
  };
}

/** One line for the log, and for the sentence the owner reads on
 * /settings/assistant. Never the whole answer — the point of holding it
 * back is that its figures do not go in front of anybody, and a log line
 * is read by people. */
export function describeUnaccounted(report: ProvenanceReport): string {
  return report.unaccounted
    .map((claim) =>
      claim.kind === "figure" && claim.nearest != null
        ? `${claim.text} (nearest in the rows: ${claim.nearest})`
        : `${claim.text} (nothing close in the rows)`,
    )
    .join(", ");
}
