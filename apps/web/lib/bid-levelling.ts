/**
 * Laying the quotes for one scope package side by side.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THE POINT IS NOT "WHO IS CHEAPEST". IT IS "ARE THEY BIDDING THE SAME THING".
 * ───────────────────────────────────────────────────────────────────────────
 *
 * A sub who left the soffits out is cheaper and is not comparable. Reading the
 * low number off a column without reading the exclusions is how a contractor
 * buys a hole in their own scope and finds it on site — and an app that printed
 * "Acme, $82,000, lowest" in bold would be actively helping them do it.
 *
 * So nothing here returns a "lowest" on its own. `levelPackage` returns the
 * cheapest quote AND whether the quotes are comparable, in one object, and the
 * caution is not optional: when the exclusions differ the sentence says which
 * quote carries what the others do not. A comparison that cannot say that is
 * worth less than no comparison, because it reads as an answer.
 *
 * WHAT IS DELIBERATELY NOT HERE. No scoring, no weighting, no "adjusted"
 * price that adds an estimate of the excluded work back onto the low bid. That
 * number would be this app's guess at somebody else's scope, printed beside
 * three real quotes and indistinguishable from them. The exclusions are shown;
 * the judgement stays with the estimator.
 *
 * Pure. No database, no React.
 */

export type LevelQuote = {
  id: string;
  packageLabel: string;
  vendorName: string;
  amount: number;
  quotedOn: string;
  /** One per line, as the sub wrote it. Empty when they excluded nothing. */
  exclusions: string | null;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/** Exclusions as a comparable set: trimmed, blank lines dropped, compared
 * case-insensitively. NOT a fuzzy match — "no soffits" and "soffits excluded"
 * stay different, because pretending to understand them is how the caution
 * that matters gets suppressed. Two subs who wrote the same thing differently
 * will read as different, which is the safe direction to be wrong in. */
export function exclusionLines(exclusions: string | null): string[] {
  if (!exclusions) return [];
  return exclusions
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

const keyOf = (line: string) => line.toLowerCase();

export type LevelledPackage<T extends LevelQuote = LevelQuote> = {
  packageLabel: string;
  /** Sorted cheapest first. Generic so a caller keeps its OWN row type —
   * the levelling needs only these fields, and forcing callers to look their
   * rows back up by id to render a note is how two lists drift apart. */
  quotes: T[];
  cheapest: T | null;
  dearest: T | null;
  /** Dearest minus cheapest. Null with fewer than two quotes — a spread needs
   * something to spread between. */
  spread: number | null;
  /** True only when every quote in the package carries the SAME exclusions.
   * With one quote it is null: a single quote is not comparable to anything,
   * and saying "comparable" of it would be saying nothing true. */
  comparable: boolean | null;
  /** What the cheapest quote excludes that at least one other does not — the
   * sentence that stops the low number being read as the best one. Null when
   * there is nothing to say. */
  caution: string | null;
};

export function levelPackage<T extends LevelQuote>(packageLabel: string, quotes: T[]): LevelledPackage<T> {
  const sorted = [...quotes].sort((a, b) => a.amount - b.amount);
  const cheapest = sorted[0] ?? null;
  const dearest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  if (sorted.length < 2) {
    return {
      packageLabel,
      quotes: sorted,
      cheapest,
      dearest,
      spread: null,
      comparable: null,
      caution:
        sorted.length === 1
          ? "Only one quote on this package — there is nothing to compare it against yet."
          : null,
    };
  }

  const sets = sorted.map((quote) => new Set(exclusionLines(quote.exclusions).map(keyOf)));
  const first = sets[0];
  const comparable = sets.every(
    (set) => set.size === first.size && [...set].every((line) => first.has(line)),
  );

  return {
    packageLabel,
    quotes: sorted,
    cheapest,
    dearest,
    spread: round2((dearest?.amount ?? 0) - (cheapest?.amount ?? 0)),
    comparable,
    caution: comparable ? null : cautionFor(sorted, sets),
  };
}

/**
 * What the cheapest quote leaves out that somebody else covers.
 *
 * Named rather than counted: "excludes 2 things the others include" tells an
 * estimator to go and read three PDFs. "excludes soffits and firestopping,
 * which Beta includes" tells them what to price.
 */
function cautionFor(sorted: LevelQuote[], sets: Set<string>[]): string {
  const cheapest = sorted[0];
  const cheapestSet = sets[0];
  const others = sorted.slice(1);

  // Lines the cheapest excludes that at least one other quote does not.
  const uniqueToCheapest = exclusionLines(cheapest.exclusions).filter((line) =>
    others.some((_, i) => !sets[i + 1].has(keyOf(line))),
  );

  if (uniqueToCheapest.length > 0) {
    const covered = others
      .filter((_, i) => uniqueToCheapest.some((line) => !sets[i + 1].has(keyOf(line))))
      .map((quote) => quote.vendorName);
    const who = covered.length === 1 ? covered[0] : `${covered.length} of the others`;
    return `${cheapest.vendorName} is lowest but excludes ${listOf(uniqueToCheapest)} — ${who} ${
      covered.length === 1 ? "does" : "do"
    } not. These are not the same bid.`;
  }

  // The cheapest excludes nothing extra, but the quotes still differ — so
  // somebody ELSE is carrying an exclusion. Worth saying, because it means the
  // dearer quote may be dearer for a reason that does not apply.
  const otherExclusions = others.filter((_, i) => sets[i + 1].size > cheapestSet.size);
  if (otherExclusions.length > 0) {
    return `These quotes carry different exclusions — ${listOf(
      otherExclusions.map((quote) => quote.vendorName),
    )} ${otherExclusions.length === 1 ? "leaves" : "leave"} out work ${
      cheapest.vendorName
    } covers. Read them before comparing the numbers.`;
  }

  return "These quotes carry different exclusions, so the numbers are not directly comparable. Read them side by side.";
}

/** "a, b and c" — the Oxford-less form the rest of the app's prose uses. */
function listOf(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * Every package on a bid, each levelled.
 *
 * Grouped by the package label EXACTLY as typed. A typo therefore shows as two
 * headings rather than silently merging two scopes into one comparison — the
 * visible failure rather than the quiet one.
 */
export function levelBid<T extends LevelQuote>(quotes: T[]): LevelledPackage<T>[] {
  const byPackage = new Map<string, T[]>();
  for (const quote of quotes) {
    const existing = byPackage.get(quote.packageLabel);
    if (existing) existing.push(quote);
    else byPackage.set(quote.packageLabel, [quote]);
  }
  return [...byPackage.entries()]
    .map(([label, rows]) => levelPackage(label, rows))
    .sort((a, b) => a.packageLabel.localeCompare(b.packageLabel));
}

/** What is wrong with a quote as typed, or null. */
export function bidQuoteProblem(quote: {
  packageLabel: string;
  vendorName: string;
  amount: number | null;
}): string | null {
  if (!quote.packageLabel.trim()) {
    return "Say what this quote is for — the package you are buying out.";
  }
  if (!quote.vendorName.trim()) {
    return "A quote needs whoever gave it. You cannot ring up a price with nobody behind it.";
  }
  if (quote.amount === null || !Number.isFinite(quote.amount)) {
    return "A quote needs an amount.";
  }
  if (quote.amount <= 0) {
    return "A quote of zero or less is not a quote.";
  }
  return null;
}
