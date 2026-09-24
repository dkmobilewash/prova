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
 * THE OUTBOUND HALF. A row starts life as a REQUEST — somebody asked, nobody
 * has answered — and becomes a quote when a price arrives. That gives this
 * module a second way to be dangerous, and it is worse than the first: a null
 * amount sorts to the FRONT of an ascending sort, so a supplier who never
 * replied would be printed as the low bid. Every comparison here therefore
 * takes `AnsweredQuote`, `levelPackage` filters to those before it sorts
 * anything, and what was asked for and not answered is reported separately
 * under `outstanding` — visible, and not in the arithmetic.
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
  /** NULL until they answer. See `outstanding` below for why that cannot be
   * allowed to reach the comparison. */
  amount: number | null;
  quotedOn: string | null;
  /** One per line, as the sub wrote it. Empty when they excluded nothing. */
  exclusions: string | null;
  /** When we asked, when we need it back, and whether they said no. All null
   * on a quote that simply arrived unasked. */
  requestedOn?: string | null;
  dueBy?: string | null;
  declinedAt?: string | null;
};

/** A quote with a price on it. The type-level half of the guard below: every
 * comparison in this file takes these, so an unanswered request cannot be
 * passed to one by accident. */
export type AnsweredQuote<T extends LevelQuote = LevelQuote> = T & { amount: number };

export function isAnswered<T extends LevelQuote>(quote: T): quote is AnsweredQuote<T> {
  return typeof quote.amount === "number" && Number.isFinite(quote.amount) && quote.declinedAt == null;
}

export type RequestState = "ANSWERED" | "DECLINED" | "OVERDUE" | "AWAITED";

/**
 * Where one request has got to, DERIVED and never stored.
 *
 * `today` is passed in rather than read from a clock, for the reason every
 * other date-sensitive module here gives: a figure that changes depending on
 * when the server happens to render it is a figure a test cannot hold still,
 * and "overdue" is exactly that kind of figure.
 */
export function requestState(quote: LevelQuote, today: string): RequestState {
  if (quote.declinedAt) return "DECLINED";
  if (isAnswered(quote)) return "ANSWERED";
  if (quote.dueBy && quote.dueBy < today) return "OVERDUE";
  return "AWAITED";
}

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
  /** Sorted cheapest first. ONLY the ones with a price — see `levelPackage`.
   * Generic so a caller keeps its OWN row type: the levelling needs only
   * these fields, and forcing callers to look their rows back up by id to
   * render a note is how two lists drift apart. */
  quotes: AnsweredQuote<T>[];
  /** Asked, not answered, not declined. Reported rather than dropped: "who
   * have I not heard from" is the question bid day actually turns on. */
  outstanding: T[];
  /** They said no. Kept because "Gamma declined" is the answer to "why only
   * two prices", and next time it says who not to wait on. */
  declined: T[];
  cheapest: AnsweredQuote<T> | null;
  dearest: AnsweredQuote<T> | null;
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
  // ANYTHING WITHOUT A PRICE IS NOT IN THE COMPARISON. A null amount sorts to
  // the front of an ascending sort, so an unanswered request would otherwise
  // become the winning quote — the loudest possible version of this feature's
  // own failure mode. Outstanding requests are reported separately instead,
  // the same posture `bid-outcome.ts` takes toward unfinished jobs.
  const answered = quotes.filter(isAnswered);
  const outstanding = quotes.filter((quote) => !isAnswered(quote) && !quote.declinedAt);
  const declined = quotes.filter((quote) => Boolean(quote.declinedAt));
  const sorted = [...answered].sort((a, b) => a.amount - b.amount);
  const cheapest = sorted[0] ?? null;
  const dearest = sorted.length > 0 ? sorted[sorted.length - 1] : null;

  if (sorted.length < 2) {
    return {
      packageLabel,
      quotes: sorted,
      outstanding,
      declined,
      cheapest,
      dearest,
      spread: null,
      comparable: null,
      caution:
        sorted.length === 1
          ? "Only one quote on this package — there is nothing to compare it against yet."
          : outstanding.length > 0
            ? `No prices back yet on this package — ${outstanding.length} still outstanding.`
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
    outstanding,
    declined,
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
function cautionFor(sorted: AnsweredQuote[], sets: Set<string>[]): string {
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
  // An amount is optional NOW: a row may be a request that has not been
  // answered yet. What is refused is a nonsense amount, not a missing one.
  if (quote.amount !== null && (!Number.isFinite(quote.amount) || quote.amount <= 0)) {
    return "A quote of zero or less is not a quote.";
  }
  return null;
}

/** What a package still needs before its comparison means anything. Null when
 * every request is in. */
export function outstandingNote(group: LevelledPackage, today: string): string | null {
  if (group.outstanding.length === 0) return null;
  const overdue = group.outstanding.filter((quote) => requestState(quote, today) === "OVERDUE");
  const names = group.outstanding.map((quote) => quote.vendorName);
  const who = names.length <= 3 ? listOf(names) : `${names.length} suppliers`;
  if (overdue.length > 0) {
    return `Still waiting on ${who} — ${overdue.length} past the date you asked for. Any comparison here is incomplete.`;
  }
  return `Still waiting on ${who}. Any comparison here is incomplete.`;
}
