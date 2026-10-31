// The word search behind "possible match" and "no match found" on a Buyout row.
// Pure and deterministic, with no model read and nothing from lib/takeoff.
//
// A HINT, NEVER A VERDICT. It only says whether words from a spec finding appear
// in the text on file. "Possible match" does not mean a quote meets the spec, and
// "no match found" does not mean it misses, because a quote rarely prints a brand
// or a rating even when it carries them. So the screen shows where it looked, and
// a finding with nothing searchable gets no result, not "no match found".

import type { BuyoutFinding } from "@/lib/buyout-spec-check";
import type { BuyoutRow } from "@/lib/purchase-orders";

export type TextSource = { label: string; text: string };

export type SpecHint =
  | { state: "POSSIBLE"; hits: { term: string; where: string; text: string }[] }
  | { state: "NONE"; terms: string[]; searched: string[] }
  | { state: "NOTHING_TO_SEARCH" };

/** Words that open or fill a spec sentence, and trade words every quote shares.
 * A hit on any of these would say nothing about a product. */
const NOT_A_NAME = new Set(
  `a all an and any approved as at basis be board boards by ceiling ceilings contractor design division each equal
   fire fireproofing for framing from general gypsum in install insulation joint manufacturer manufacturers metal
   no not of on or panel panels part plaster product products provide rated section shall spray steel stud studs
   submit substitution substitutions that the this track type use used wall walls where with
   co company corp corporation inc llc ltd`.split(/\s+/),
);

/** One spelling for both sides, so "2-hr" finds "two hour" and "NRC .70" finds
 * "NRC 0.7", and "UL 263" does not find "UL 2630". */
export function normalise(text: string): string {
  return ` ${text.toLowerCase()} `
    .replace(/\b(one|two|three|four)[\s-]+h/g, (_, word: string) => `${["one", "two", "three", "four"].indexOf(word) + 1} h`)
    .replace(/[^a-z0-9./]+/g, " ")
    .replace(/\.(?=\s)/g, " ")
    .replace(/ \.(\d)/g, " 0.$1")
    .replace(/(\.\d*?)0+(?=\s)/g, "$1")
    .replace(/\b(\d+) ?(?:hrs?|hours?)(?=\s)/g, "$1 hour")
    .replace(/\b(\d+) ?(?:ga|gauge)(?=\s)/g, "$1 gauge")
    .replace(/ ([a-z]) (\d{2,})(?=\s)/g, " $1$2")
    .replace(/\s+/g, " ");
}

const CRITERIA = [
  /\b\d hour\b/g,
  /\bul (?:design )?(?:no )?[a-z]?\d+\b/g,
  /\bastm [a-z]\d+\b/g,
  /\b(?:stc|cac) \d+\b/g,
  /\bnrc 0?\.\d+\b/g,
  /\blevel \d\b/g,
  /\btype [a-z]\b/g,
  /\b\d+ (?:gauge|mil)\b/g,
];

/** Ratings and standards, read exactly: STC 50 is not STC 45. */
function criteria(text: string): string[] {
  const flat = normalise(text);
  return CRITERIA.flatMap((pattern) => flat.match(pattern) ?? []);
}

/** Capitalised words that are not ordinary spec language. The first word of a
 * sentence is capitalised anyway, so it counts only in capitals or before another
 * capitalised word. */
function nameWords(text: string): string[] {
  return text.split(/(?<=[.;:])\s+/).flatMap((sentence) => {
    const words = sentence.split(/\s+/).map((word) => word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""));
    return words.filter((word, index) => {
      if (word.length < 3 || !/^[A-Z]/.test(word) || NOT_A_NAME.has(word.toLowerCase())) return false;
      return index > 0 || word === word.toUpperCase() || /^[A-Z]/.test(words[1] ?? "");
    });
  });
}

/** What to look for. Only a named-product finding offers brand words. */
export function searchTerms(finding: Pick<BuyoutFinding, "kind" | "label" | "requirement" | "quote">): string[] {
  const text = [finding.label, finding.requirement, finding.quote].join(". ");
  const names = finding.kind === "NAMED_PRODUCT" ? nameWords(text) : [];
  const seen = new Set<string>();
  return [...criteria(text), ...names].filter((term) => {
    const key = normalise(term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function specHint(finding: BuyoutFinding, sources: readonly TextSource[]): SpecHint {
  const terms = searchTerms(finding);
  if (terms.length === 0) return { state: "NOTHING_TO_SEARCH" };
  const hits = sources.flatMap((source) => {
    const flat = normalise(source.text);
    return terms.filter((term) => flat.includes(normalise(term))).map((term) => ({ term, where: source.label, text: source.text }));
  });
  if (hits.length > 0) return { state: "POSSIBLE", hits };
  return { state: "NONE", terms, searched: [...new Set(sources.map((source) => source.label))] };
}

/** Everything on file for a row. Each quote is one place, whatever its unit. */
export function rowSources(row: Pick<BuyoutRow, "line" | "quoteTexts">): TextSource[] {
  return [
    { label: "the item", text: row.line.description },
    ...row.quoteTexts.map((quote) => ({
      label: `${quote.vendorName}'s quote`,
      text: [quote.vendorName, quote.description, quote.notes].filter(Boolean).join(" · "),
    })),
  ];
}

const list = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

export function specHintSentence(hint: SpecHint): string {
  if (hint.state === "NOTHING_TO_SEARCH") return "No name or rating here to search for. Compare it yourself.";
  if (hint.state === "NONE") {
    return `No match found for ${list(hint.terms)} in ${list(hint.searched)}. The text may just not say, so ask.`;
  }
  const places = [...new Set(hint.hits.map((hit) => hit.where))].map(
    (where) => `${list(hint.hits.filter((hit) => hit.where === where).map((hit) => hit.term))} in ${where}`,
  );
  return `Possible match: ${list(places)}. This is a word search, so read the text yourself.`;
}

/** The tally on the collapsed row. Silent about what was not searched. */
export function specHintTally(hints: readonly SpecHint[]): string {
  const possible = hints.filter((hint) => hint.state === "POSSIBLE").length;
  const none = hints.filter((hint) => hint.state === "NONE").length;
  return [possible ? `${possible} possible match${possible === 1 ? "" : "es"}` : "", none ? `${none} no match found` : ""]
    .filter(Boolean)
    .join(", ");
}
