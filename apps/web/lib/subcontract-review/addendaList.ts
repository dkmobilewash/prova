/**
 * WHICH ADDENDA A CONTRACT SAYS IT INCORPORATES, read by code from the quote
 * of an ADDENDA_LIST finding. The model finds the clause; the NUMBERS come from
 * its words, so a number the clause does not print cannot appear here.
 *
 * Handles the forms subcontracts actually use: "Addenda 1, 2 and 3",
 * "Addendum No. 1 dated 3/2/2026 and Addendum No. 2", "Addenda #1 through #4",
 * "Addendum 1-3". Dates are removed first so "3/2/2026" is not read as
 * addenda 3, 2 and 2026. Numbers outside 1-99 are ignored, the same rule as
 * `addendumNumber()` in lib/addenda-acknowledgement.ts.
 */

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const DATE_PATTERNS = [
  /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(`\\b(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b`, "gi"),
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})[a-z]*\\.?,?\\s+\\d{4}\\b`, "gi"),
];

export function addendaListedIn(quote: string): number[] {
  let text = quote;
  for (const pattern of DATE_PATTERNS) text = text.replace(pattern, " ");
  const found = new Set<number>();
  for (const match of text.matchAll(/addend(?:um|a)\b/gi)) {
    // The list runs from the word to the end of its clause.
    const rest = text.slice(match.index! + match[0].length);
    const stop = rest.search(/[;:]|\.\s+[A-Z]|\bdrawings?\b|\bspecifications?\b|\bexhibit\b/i);
    const segment = stop === -1 ? rest.slice(0, 120) : rest.slice(0, stop);
    for (const range of segment.matchAll(/#?(\d{1,2})\s*(?:through|thru|to|-|–)\s*#?(\d{1,2})/gi)) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (from >= 1 && to <= 99 && from <= to && to - from < 50) for (let n = from; n <= to; n++) found.add(n);
    }
    for (const single of segment.matchAll(/\d+/g)) {
      const n = Number(single[0]);
      if (n >= 1 && n <= 99) found.add(n);
    }
  }
  return [...found].sort((a, b) => a - b);
}
