/**
 * Trade words as a phone's dictation writes them, folded to how a drawing
 * or an estimate line writes them — so "five-eighths type ex" finds the
 * line called `5/8" Type X gypsum board`.
 *
 * Used only for MATCHING a name the person said against rows that exist.
 * It never produces a figure that is written anywhere: a quantity still
 * goes through the strict parsers in ./numbers.ts.
 */

const FRACTIONS: [RegExp, string][] = [
  [/\bfive[\s-]*eighths?\b/g, "5/8"],
  [/\bthree[\s-]*eighths?\b/g, "3/8"],
  [/\bseven[\s-]*eighths?\b/g, "7/8"],
  [/\bone[\s-]*eighth\b/g, "1/8"],
  [/\bthree[\s-]*quarters?\b/g, "3/4"],
  [/\bone[\s-]*quarter\b/g, "1/4"],
  [/\b(?:(?:one|a)[\s-]*)?half\b/g, "1/2"],
  [/\b(\d)\s+(\d)(?:ths|th|s)\b/g, "$1/$2"], // "5 8ths"
];

export function normalizeSpoken(text: string): string {
  let out = text.toLowerCase().replace(/[“”″"]/g, "").replace(/[‐–—]/g, "-");
  for (const [pattern, to] of FRACTIONS) out = out.replace(pattern, to);
  return out
    .replace(/\btype[\s-]*(?:x|ex)\b/g, "type x")
    .replace(/\btype[\s-]*c\b|\btype[\s-]*see\b/g, "type c")
    .replace(/\b(?:sheet\s?rock|gyp(?:sum)?\s+board|gyp)\b/g, "drywall")
    .replace(/\s+/g, " ")
    .trim();
}

const NOISE = new Set(["of", "the", "a", "an", "for", "to", "and", "sheets", "sheet", "pieces", "pcs", "ea", "each", "board", "boards"]);

/** The words of a spoken phrase worth matching on. */
export function matchWords(text: string): string[] {
  return normalizeSpoken(text)
    .split(/[\s,]+/)
    .map((word) => word.replace(/^[^a-z0-9/]+|[^a-z0-9/]+$/g, ""))
    .filter((word) => word.length > 0 && !NOISE.has(word));
}

/** How many of `words` appear in `candidate`, after the same folding. */
export function matchScore(words: string[], candidate: string): number {
  const haystack = ` ${normalizeSpoken(candidate).replace(/[^a-z0-9/]+/g, " ")} `;
  return words.filter((word) => haystack.includes(` ${word} `)).length;
}
