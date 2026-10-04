/**
 * IS THIS QUOTE ACTUALLY ON THE PAGE?
 *
 * The spec eval's sharpest assertion: every finding must carry the sentence it
 * was read from, and that sentence must appear in the document. It is the one
 * check a plausible-sounding answer cannot satisfy, which is why it is also the
 * one that must not be loosened casually.
 *
 * IT LIVES HERE RATHER THAN IN THE EVAL because the eval costs money to run, so
 * nothing inside it is exercised on a push. A matcher that decides whether a
 * fabricated quote is caught is too important to be checked only by a paid run —
 * `spec-findings.ts` is here for the same reason, and `sheetIndex.ts` states it:
 * logic a test cannot reach is logic nobody is checking.
 *
 * ── WHY A STRAIGHT STRING COMPARE IS NOT ENOUGH, AND WHAT IT COST ──
 *
 * The first version of this was `source.includes(quote)` over whitespace-flattened,
 * lowercased text. On the first paid run it failed `buried-mock-up` with three
 * quotes, and the assertion's own message said what that means: "a paraphrase
 * presented as the spec's own words."
 *
 * It was not a paraphrase. All three quotes were character-for-character the
 * page's own sentence, THE SAME LENGTH, differing at exactly one code point:
 * the model wrote `’` (U+2019) where the fixture has `'` (U+0027). Measured
 * rather than assumed — every differing index was printed, and the only entry
 * was that pair.
 *
 * A reader that transcribes a sentence perfectly and types the apostrophe the
 * way a typesetter would has not invented anything. Failing it there would have
 * been this repo's most familiar mistake wearing new clothes: a check that was
 * not lying, but was answering a question nobody asked — "are these bytes
 * identical" instead of "is this sentence on the page".
 *
 * ── WHAT THE NORMALISATION IS ALLOWED TO DO ──
 *
 * Only map a character to its ASCII twin. Each replacement below is a
 * typographic variant of a character a keyboard produces, so **no substitution
 * here can turn one word into another** — which is the property that keeps a
 * real fabrication failing. Deliberately NOT done: stripping punctuation,
 * collapsing word stems, dropping short words, or any fuzzy or percentage
 * match. Those would all let a paraphrase through, and a paraphrase is the
 * exact thing this is for.
 *
 * `quoteMatch.test.ts` holds both directions, because only the second one is a
 * guard: the smart-quote variants that MUST match, and the paraphrases and
 * fabrications that MUST NOT. Loosening this function without reddening that
 * file is not possible, which is the point.
 */

/**
 * Typographic characters mapped to the ASCII they stand in for.
 *
 * Named as a table rather than inlined so the test can assert its SIZE and
 * walk every entry — a regex that silently stopped matching would otherwise
 * narrow this with nothing to say so, which is the `scratch-cleanup-order`
 * scar (a pattern that parsed 180 of 181 and passed).
 */
export const TYPOGRAPHIC_EQUIVALENTS: { readonly ascii: string; readonly variants: readonly string[] }[] = [
  // Apostrophes and single quotes. U+2019 is the one the first paid run hit.
  { ascii: "'", variants: ["‘", "’", "‚", "‛", "′", "‵"] },
  { ascii: '"', variants: ["“", "”", "„", "‟", "″", "‶"] },
  // Hyphens and dashes — a spec says "8 feet long by full height" with any of
  // these, and "mock-up" is hyphenated on every page that mentions one.
  { ascii: "-", variants: ["‐", "‑", "‒", "–", "—", "―", "−"] },
  // Spaces that are not U+0020. These survive `\s+` collapsing in some
  // engines and not others, so they are mapped explicitly rather than trusted.
  { ascii: " ", variants: [" ", " ", " ", " ", " ", " ", " ", " "] },
  { ascii: "...", variants: ["…"] },
];

/** The shortest quote that counts as evidence of anything.
 *
 *  A three-word fragment is not a citation: "Level 5" appears verbatim in a
 *  section whose entire point is that Level 5 is NOT required, so a short quote
 *  can be genuinely present and still support a finding the page contradicts.
 *  Twelve characters is roughly two words of spec prose and is the floor the
 *  eval used from the start; it is here so the number has one home. */
export const MIN_QUOTE_LENGTH = 12;

/** Lowercase, single-spaced, ASCII punctuation. */
export function normaliseForQuoteMatch(value: string): string {
  let out = value;
  for (const { ascii, variants } of TYPOGRAPHIC_EQUIVALENTS) {
    for (const variant of variants) {
      out = out.split(variant).join(ascii);
    }
  }
  return out.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Whether `quote` is a sentence from `documentLines`.
 *
 * The lines are joined with a space before matching, because a quote taken off
 * a page spans the places the page wrapped — the mock-up sentence in
 * `specCases.ts` is four source lines — and a reader quoting it correctly
 * returns one sentence.
 *
 * Returns false for a quote under `MIN_QUOTE_LENGTH`, so "too short to be
 * evidence" and "not on the page" are one answer to the caller. `whyNot` gives
 * the two apart when a report needs to say which.
 */
export function quoteIsInDocument(quote: string, documentLines: readonly string[]): boolean {
  return whyNot(quote, documentLines) === null;
}

/** `null` when the quote is good, otherwise the reason — for a report that
 *  should not make a reader guess which rule a quote broke. */
export function whyNot(quote: string, documentLines: readonly string[]): "too-short" | "not-in-document" | null {
  const needle = normaliseForQuoteMatch(quote);
  if (needle.length < MIN_QUOTE_LENGTH) return "too-short";
  const haystack = normaliseForQuoteMatch(documentLines.join(" "));
  return haystack.includes(needle) ? null : "not-in-document";
}
