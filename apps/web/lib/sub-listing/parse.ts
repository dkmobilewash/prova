import { TRADE_SCOPE_OPTIONS } from "@/lib/trade-scopes";

/**
 * READING THE SUBCONTRACTOR LISTING OFF A PUBLIC BID OR AWARD DOCUMENT.
 *
 * The motion: find a project out to bid or recently awarded, find the subs named
 * on it, and reach each one about THEIR OWN job. Which makes the failure mode
 * expensive: *a generic email that is vague is forgettable; a specific email
 * that is wrong is disqualifying.* Being wrong about a man's own job costs the
 * relationship, and in a trade this small it costs the ones you have not
 * contacted yet.
 *
 * ── A CLAIM IS THE DOCUMENT'S OWN WORDS, WITH THE LINE IT CAME FROM ──
 *
 * Nothing here paraphrases or infers. `sourceText` is the verbatim line, `line`
 * is where to find it, and `signals.ts` assembles sentences from those spans
 * rather than composing about them. There is no model anywhere in this
 * directory, so the invention failure `lib/research/bidResearch.eval.ts` is
 * built around — a confident fact about a similarly-named project, carrying a
 * citation that passes every code-level guard — has no mechanism here.
 *
 * ── EVERY NON-BLANK LINE IS ACCOUNTED FOR, AND THAT SENTENCE IS THE WHOLE
 *    DESIGN. READ WHY IT IS PHRASED THAT WAY. ──
 *
 * The first version of this file counted "candidate" lines with a predicate
 * (`looksLikeData`: does the line carry money, a percentage, a licence or a
 * registration number?) and computed `unread` as candidates minus rows. Its
 * header claimed the counting expression and the parsing expression "share
 * nothing", so nothing could go missing.
 *
 * **That was false, and an adversarial review demonstrated it three ways.** The
 * two expressions shared the only thing a set difference depends on: THE
 * UNIVERSE. A line the predicate rejected was in neither set — not a row, not
 * unread, not counted — and `agreed` then read `true` while the screen printed
 * a green "every line was read" sentence over the loss:
 *
 *   - a row with no money, percent, licence or registration token at all
 *     vanished. California's §4104 carries NO dollar field, so whether a row
 *     has any numeric token depends entirely on whether the licence column
 *     happened to be inside the person's paste selection. Four subs in, one
 *     out, `agreed: true`;
 *   - `TOTAL_LINE` was matched against the whole line, so a sub listed under
 *     "Alternate No. 2 — gypsum board" vanished, and so did **Total Western,
 *     Inc.**, which is a real California contractor;
 *   - a licence outside 5–8 digits (Washington's UBI shapes) left
 *     `candidateLines: 0` and lost every sub on the page.
 *
 * It is the family CLAUDE.md names twice — *nothing is ever missing from a
 * directory you do not walk; nothing is ever missing from a list nobody
 * imports.* A guard was built and then a gate was put in front of it.
 *
 * So the universe is now **every non-blank line**, and each one is classified
 * into exactly one bucket: a `row`, a header line, an `ignored` line whose
 * reason is NAMED, or `unread`. `reconciliation.accountedFor` is their sum and
 * must equal `nonBlankLines` — a partition, asserted in the tests rather than
 * assumed.
 *
 * ── AND READ THE NEXT PARAGRAPH, BECAUSE THIS ONE USED TO OVERCLAIM AND THE
 *    OVERCLAIM IS WHAT LET THE DEFECT BACK IN ──
 *
 * It said: *"There is no predicate left that can decline to admit a line,
 * because there is no predicate."* That was false when written.
 * `furnitureReason` is a predicate, it declines lines, and a second review
 * proved it declined the majority of rows on the document type this feature
 * exists for — see its own header for the reproduction.
 *
 * **What the partition actually guarantees is narrower than it reads.**
 * `accountedFor === nonBlankLines` proves no line fell off the page. It proves
 * NOTHING about whether a line is in the bucket it belongs in, and a bucket
 * with a confident wrong reason loses a subcontractor exactly as thoroughly as
 * no bucket at all. The two guarantees are:
 *
 *   - nothing VANISHES — the partition, asserted;
 *   - nothing is MISFILED — `hasDataEvidence` plus the converse tests in
 *     `parse.test.ts` ("furniture is only furniture"), which is the half that
 *     was missing and the half no arithmetic can supply.
 *
 * `looksLikeData` is gone and `furnitureReason` is narrower, but the lesson is
 * not about either function: **a guard and its converse are two tests, and
 * writing one of them reads exactly like finishing.**
 *
 * ── RECOGNISE, NEVER REJECT ──
 *
 * A licence or registration token fills a field when it is there and is never a
 * validity test. The formats are written from their shape and are NOT verified
 * against the issuing agencies — so a row whose licence looks wrong still
 * parses, it simply gets `licence: null`. Dropping a sub because an unverified
 * regex disliked their number is the silent loss above, wearing a different hat.
 *
 * ── WHAT IS NOT VERIFIED, SAID PLAINLY ──
 *
 * The egress proxy in this container blocks every general web host (403 on
 * CONNECT), so **no real bid or award document was read while writing this.**
 * The fixtures are synthetic and say so in their own header. Column orders,
 * wrapping and the exact field set of a real agency's form are UNCONFIRMED, and
 * that is the next thing to fix: paste one real document in, read what `unread`
 * and `problems` say, and widen from the evidence.
 *
 * The parser is built to survive being wrong about it. It requires no column
 * order, requires no header, and anything it cannot read it hands back.
 */

type TradeScopeValue = (typeof TRADE_SCOPE_OPTIONS)[number]["value"];

/**
 * Keywords that identify a portion of work as one of our five trades.
 *
 * A total `Record` over the canonical list ON PURPOSE: add a sixth trade to
 * `lib/trade-scopes.ts` and this stops compiling until it is given keywords. A
 * trade that is storable but that no document can match is the "storable,
 * parseable and impossible to type in" hole from #526. Keys are identifiers, so
 * this is not a seventh copy of the trade list — the list is imported and this
 * only decorates it. (Issue #608: there are six hand-rolled copies of that list
 * in this app already, and no census can see them.)
 */
const TRADE_KEYWORDS: Record<TradeScopeValue, readonly string[]> = {
  METAL_FRAMING_DRYWALL: [
    "drywall",
    "gypsum",
    "metal stud",
    "metal framing",
    "light gauge",
    "light-gauge",
    "cold formed",
    "cold-formed",
    "wallboard",
    "sheetrock",
    "taping",
    "interior framing",
    "framing & drywall",
    "framing and drywall",
  ],
  LATH_PLASTER: ["lath", "plaster", "stucco", "cement plaster", "veneer plaster"],
  EIFS: ["eifs", "exterior insulation", "synthetic stucco", "insulation finish"],
  ACOUSTICAL_CEILINGS: [
    "acoustical",
    "acoustic",
    "ceiling",
    "suspended ceiling",
    "grid ceiling",
    "act ceiling",
  ],
  FIREPROOFING: [
    "fireproofing",
    "fire proofing",
    "fire-proofing",
    "sfrm",
    "spray applied fire",
    "spray-applied fire",
    "intumescent",
    "firestopping",
    "fire stopping",
    "fire-stopping",
  ],
};

/**
 * Which trade wins when two of ours match equally well.
 *
 * "Drywall and ceilings" is how a drywall sub's scope is most often written, and
 * `drywall` and `ceiling` are both seven characters. The first version returned
 * `null` on that tie — so the commonest row in the whole corpus matched nothing,
 * defaulted to unticked, and (with the dead checkbox this shipped beside) could
 * not be imported at all.
 *
 * A tie between two of OUR OWN trades is not an unknown: the row is ours either
 * way, and refusing to say which is worse than picking one and saying so. So
 * ties resolve in this order and the row carries a concern naming the other
 * match. Metal framing and drywall leads because it is the core trade and the
 * one a combined scope is usually sold as.
 */
const TRADE_PRIORITY: readonly TradeScopeValue[] = [
  "METAL_FRAMING_DRYWALL",
  "ACOUSTICAL_CEILINGS",
  "LATH_PLASTER",
  "EIFS",
  "FIREPROOFING",
];

/** One subcontractor as the document lists them. */
export type ListedSub = {
  /** The company name exactly as the document spells it. Never normalised. */
  name: string;
  /** The verbatim text this row was read from. This is the claim's evidence. */
  sourceText: string;
  /** 1-based line number within the pasted text, so a person can go and look. */
  line: number;
  /** The document's own words for the portion of work, verbatim. */
  portionOfWork: string | null;
  /** One of our five trades, when the portion of work matches. */
  tradeScope: TradeScopeValue | null;
  /** A contractor licence number as printed. Recognised, never validated. */
  licence: string | null;
  /** A public-works contractor registration number as printed. */
  registration: string | null;
  city: string | null;
  /** Whole dollars. Only ever rendered into a sentence, never stored as money. */
  amount: number | null;
  percentOfBid: number | null;
  /**
   * Things about this row a person must look at before believing it.
   *
   * Not errors — the row parsed. These are where what was read is probably
   * INCOMPLETE or AMBIGUOUS, which is more dangerous than unreadable: a scope
   * that wrapped parses as a whole phrase ending in "and", and that phrase then
   * goes into a claim somebody reads down a telephone.
   */
  concerns: string[];
};

/** A line this parser could not turn into a row. */
export type UnreadLine = { line: number; text: string; why: string };

/** A line deliberately not treated as a row, with the reason NAMED. */
export type IgnoredLine = { line: number; text: string; why: string };

export type SubListingParse = {
  header: {
    project: string | null;
    agency: string | null;
    /** Null when the document names more than one — see `problems`. */
    prime: string | null;
    bidDate: string | null;
  };
  rows: ListedSub[];
  unread: UnreadLine[];
  /** Furniture — totals, column headings, prose — each with its reason. */
  ignored: IgnoredLine[];
  /**
   * Document-level problems that make the whole parse untrustworthy, as
   * distinct from a single unreadable line. A multi-prime packet is the one
   * that matters: it cannot be resolved per row, so claims must not name a
   * prime at all.
   */
  problems: string[];
  /**
   * The partition. `accountedFor` is the sum of the four buckets and must equal
   * `nonBlankLines` — if it does not, this parser has a hole and the screen must
   * say so rather than imply completeness.
   */
  reconciliation: {
    nonBlankLines: number;
    rowsParsed: number;
    headerLines: number;
    ignoredLines: number;
    unreadLines: number;
    accountedFor: number;
    /** Every line accounted for AND nothing unread AND no document problem. */
    agreed: boolean;
  };
};

/**
 * Money, and it REQUIRES a currency symbol.
 *
 * The first version also accepted any comma-grouped number, which turned a
 * quantity column — "12,500 SF" — into "$12,500" in a claim. `signals.ts` says
 * money is "the one specificity that disqualifies, since money is the thing
 * they would be hiring us for", and a square-foot count rendered as dollars is
 * exactly that. Missing a real amount costs a clause; inventing one costs the
 * prospect. So: a `$`, or nothing.
 */
const MONEY = /\$\s?(\d[\d,]*(?:\.\d+)?)\s*(k|m|mm|million|thousand)?\b/i;
const PERCENT = /\b(\d{1,3}(?:\.\d+)?)\s?%/;
/**
 * A contractor licence as printed: 6–8 digits, optionally behind a class.
 *
 * SIX, not five, because a five-digit run is a ZIP code — and a ZIP sitting in
 * the place-of-business column beat the real licence, so the claim read "Listed
 * with licence 92335". CSLB numbers are six or seven digits, so the floor costs
 * nothing real.
 */
const LICENCE = /\b(?:lic(?:ense|ence)?\.?\s*(?:no\.?|#)?\s*)?((?:[A-C]-?\d{1,2}\s+)?\d{6,8})\b/i;
/** A public-works registration number as printed: 10 digits starting with 1. */
const REGISTRATION = /\b(1\d{9})\b/;

/** A field that visibly does not finish — the printed evidence of a wrap. */
const DANGLING = /(?:[,&/+]|\b(?:and|or|with|plus|including|incl\.?|as)\s*)$/i;

/**
 * Does this field visibly not finish?
 *
 * Exported so `signals.ts` can tell, without parsing the human-readable
 * `concerns` strings. The concern is prose for a person; this is the same fact
 * for code, and a claim needs it: quoting "Metal stud framing, drywall and" as
 * though it were a whole scope is the thing the concern was written about, and
 * for a while the concern was raised while the claim went out unchanged.
 */
export function looksCutOff(field: string | null): boolean {
  return field !== null && DANGLING.test(field);
}

/**
 * Words that mark a field as a company rather than a scope of work.
 *
 * Used only to tell the name column from the portion-of-work column when a form
 * puts them the other way round. Deliberately not a test of validity: plenty of
 * real companies carry none of these ("Northstate Drywall", "Kings Acoustical"),
 * and the absence of a marker is never on its own evidence of anything.
 */
/**
 * A place with a two-letter state code: "Fontana, CA".
 *
 * Named rather than inline because `hasDataEvidence` and `readRow` must agree
 * about it. Deliberately strict about the TWO trailing capitals: that is what
 * separates "Culver City, CA" from the column heading "City, State".
 */
const CITY_WITH_STATE = /^[A-Z][A-Za-z.\- ]+,\s*[A-Z]{2}$/;

const ENTITY_MARKER =
  /\b(?:inc|llc|corp|corporation|co|company|ltd|llp|lp|systems|builders|construction|contractors|interiors|enterprises|group|industries)\b\.?/i;

/** Words that mark a line as being about the bid rather than about a sub. */
const TOTALS_WORDS =
  /\b(?:total|subtotal|sub-total|base bid|bid total|grand total|alternate|add\s?alt|contingency|allowance|engineer'?s? estimate|amount bid)\b/i;

/** Words that mark a line as a column heading. */
const HEADING_WORDS =
  /\b(?:subcontractor|sub-contractor|name|firm|company|city|state|location|address|licence|license|lic\.?|dir|registration|reg\.?|portion|work|scope|description|category|amount|value|percent|%\s*of\s*bid|item)\b/gi;

function splitFields(line: string): string[] {
  return line
    .split(/\t+|\s{2,}|\s*\|\s*/)
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

/** Money tokens removed, so a dollar figure cannot be read as a licence.
 *  `$1200000` is seven digits, and it won the licence slot. */
function withoutMoney(text: string): string {
  return text.replace(/\$\s?\d[\d,]*(?:\.\d+)?\s*(?:k|m|mm|million|thousand)?/gi, " ");
}

function parseAmount(raw: string): number | null {
  const found = raw.match(MONEY);
  if (!found) return null;
  const digits = found[1].replace(/,/g, "");
  const value = Number.parseFloat(digits);
  if (!Number.isFinite(value)) return null;
  // "$1.2M" read as "$1.00" was the first version. An abbreviation is common on
  // award summaries, and silently truncating one is worse than not reading it.
  const suffix = (found[2] ?? "").toLowerCase();
  const multiplier =
    suffix === "k" || suffix === "thousand"
      ? 1_000
      : suffix === "m" || suffix === "mm" || suffix === "million"
        ? 1_000_000
        : 1;
  return Math.round(value * multiplier);
}

function parsePercent(raw: string): number | null {
  const found = raw.match(PERCENT);
  if (!found) return null;
  const value = Number.parseFloat(found[1]);
  return Number.isFinite(value) ? value : null;
}

/** Every one of our trades a portion of work mentions, best first. */
export function tradeMatchFor(portionOfWork: string | null): {
  scope: TradeScopeValue | null;
  alsoMatched: TradeScopeValue[];
} {
  if (!portionOfWork) return { scope: null, alsoMatched: [] };
  const haystack = portionOfWork.toLowerCase();

  const best = new Map<TradeScopeValue, number>();
  for (const [scope, keywords] of Object.entries(TRADE_KEYWORDS) as [
    TradeScopeValue,
    readonly string[],
  ][]) {
    for (const keyword of keywords) {
      if (!haystack.includes(keyword)) continue;
      best.set(scope, Math.max(best.get(scope) ?? 0, keyword.length));
    }
  }
  if (best.size === 0) return { scope: null, alsoMatched: [] };

  const ranked = [...best.entries()].sort((a, b) =>
    b[1] === a[1] ? TRADE_PRIORITY.indexOf(a[0]) - TRADE_PRIORITY.indexOf(b[0]) : b[1] - a[1],
  );
  return { scope: ranked[0][0], alsoMatched: ranked.slice(1).map(([scope]) => scope) };
}

/** Which of our five trades a portion of work describes, or null. */
export function tradeScopeFor(portionOfWork: string | null): TradeScopeValue | null {
  return tradeMatchFor(portionOfWork).scope;
}

const HEADER_PATTERNS: { key: keyof SubListingParse["header"]; pattern: RegExp }[] = [
  { key: "project", pattern: /^\s*(?:project|job|contract)(?:\s*name)?\s*[:\-]\s*(.+)$/i },
  {
    key: "agency",
    pattern: /^\s*(?:agency|owner|district|awarding\s*(?:agency|body))\s*[:\-]\s*(.+)$/i,
  },
  {
    key: "prime",
    pattern:
      /^\s*(?:prime|prime\s*contractor|general\s*contractor|gc|bidder|apparent\s*low\s*bidder|awarded\s*to)\s*[:\-]\s*(.+)$/i,
  },
  {
    key: "bidDate",
    pattern: /^\s*(?:bid\s*(?:date|opening)|opened|award(?:ed)?\s*date)\s*[:\-]\s*(.+)$/i,
  },
];

function isHeaderLine(line: string): boolean {
  return HEADER_PATTERNS.some(({ pattern }) => pattern.test(line));
}

/**
 * Read the header, and REFUSE to pick a prime when the document names several.
 *
 * `header.prime` used to take the first `Prime:` line in the whole paste. An
 * agency posting every bid for one project in one PDF is the normal case, and
 * that version attributed all three primes' subs to the first prime — so two of
 * three `GC_RELATIONSHIP` claims were flatly false, and ticking "awarded" turned
 * them into congratulations on a job the sub did not get. The exact failure
 * `signals.ts` exists to prevent, arriving through the header instead of through
 * the outcome.
 *
 * It cannot be resolved per row: nothing in a flat paste says which prime a
 * given row sits under. So a multi-prime document loses its prime entirely and
 * gains a problem, which stops `signals.ts` naming one at all.
 */
function readHeader(lines: string[]): { header: SubListingParse["header"]; problems: string[] } {
  const header: SubListingParse["header"] = {
    project: null,
    agency: null,
    prime: null,
    bidDate: null,
  };
  const primes: string[] = [];
  const problems: string[] = [];

  for (const line of lines) {
    for (const { key, pattern } of HEADER_PATTERNS) {
      const found = line.match(pattern);
      if (!found) continue;
      const value = found[1].trim();
      if (key === "prime") {
        if (!primes.includes(value)) primes.push(value);
        continue;
      }
      if (!header[key]) header[key] = value;
    }
  }

  if (primes.length === 1) header.prime = primes[0];
  else if (primes.length > 1) {
    problems.push(
      `this document names ${primes.length} prime contractors (${primes.join("; ")}), and nothing in a flat paste says which subcontractor sits under which. No claim will name a prime. Paste one bidder's listing at a time.`,
    );
  }

  return { header, problems };
}

/**
 * Furniture — a line that is deliberately not a row — or null.
 *
 * Every branch returns a REASON, because an ignored line with no reason is
 * indistinguishable from a lost one. The totals test is the one that was wrong:
 * it matched the words anywhere on the line, so a sub whose scope read
 * "Alternate No. 2 — gypsum board" was discarded, and so was a company called
 * Total Western. A totals line is short — a label and a figure — so the field
 * count does the work the keyword cannot.
 */
/**
 * Positive evidence that a line is DATA rather than furniture.
 *
 * ── THIS FUNCTION EXISTS BECAUSE THE REWRITE MOVED THE DEFECT IT CLOSED ──
 *
 * The first version of this file gated rows behind `looksLikeData`, which
 * admitted a line only if it carried money, a percentage, a licence or a
 * registration number. A review proved that lost subcontractors silently. The
 * rewrite deleted that gate, partitioned every non-blank line into four buckets,
 * asserted the partition, and claimed in its header that "there is no predicate
 * left that can decline to admit a line, because there is no predicate".
 *
 * **`furnitureReason` is a predicate, and a second review proved it declines
 * real rows — the majority of them on the document type this feature exists
 * for.** Its column-heading branch required the line to carry NO money,
 * percent or registration; California's §4104 listing has no dollar column at
 * all, so that escape hatch is absent on every row. Reproduced: an ordinary
 * five-sub San Diego listing read THREE, with a plaster sub and a drywall sub
 * filed as "the table's column headings", `agreed: true`, and the screen
 * printing "All 10 lines accounted for" over the loss. A row-by-row sweep ate
 * six of seven. Any Californian city containing the word "City" — Daly, Culver,
 * National, Redwood, Foster, Union, Cathedral — plus any licence label was
 * enough, and so was any scope containing the word "work", which is what a
 * "Portion of Work" column tends to echo.
 *
 * So the partition was honest about where a line went and wrong about what it
 * was, and `agreed` read true either way. **A bucket with a confident wrong
 * reason loses a subcontractor exactly as thoroughly as no bucket at all.**
 *
 * The fix is to stop asking only "does this look like furniture" and ask first
 * "is there positive evidence this is data" — evidence a heading row cannot
 * have, because a heading row names columns rather than carrying values:
 *
 *   - a run of four or more digits (a licence, a registration, a bid item);
 *   - a field that is a place with a state code, which "City, State" is not
 *     (the pattern wants two trailing capitals);
 *   - a field carrying a company entity marker;
 *   - a licence the pattern recognises.
 *
 * Any one of those and the line is never furniture. Nothing here RE-GATES the
 * row: a line with none of this evidence still goes through `readRow` and ends
 * up a row, unread, or furniture on the narrower tests below — the evidence only
 * ever rescues a line from being called furniture, never the other way round.
 */
function hasDataEvidence(trimmed: string, fields: string[]): boolean {
  // A run of four or more digits covers every licence and registration this
  // file recognises, so a separate LICENCE test here was redundant — a mutation
  // removing it changed no outcome, which is the definition of dead logic.
  if (/\d{4,}/.test(trimmed)) return true;
  if (fields.some((field) => CITY_WITH_STATE.test(field))) return true;
  if (fields.some((field) => ENTITY_MARKER.test(field))) return true;
  return false;
}

function furnitureReason(line: string, fields: string[]): string | null {
  const trimmed = line.trim();

  if (/^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i.test(trimmed)) return "a page number";

  // Positive data evidence beats every furniture test below it.
  if (hasDataEvidence(trimmed, fields)) return null;

  if (fields.length <= 2 && TOTALS_WORDS.test(trimmed) && MONEY.test(trimmed)) {
    return "a total or an alternate for the bid as a whole, not a subcontractor";
  }

  /**
   * A column heading: heading words are a MAJORITY of the fields, not merely
   * two of them anywhere on the line. A real heading row is almost entirely
   * column names; two hits was low enough that "Acme Drywall Company / Fontana,
   * CA / Finish carpentry and drywall work" cleared it on `company` + `work`.
   */
  if (!MONEY.test(trimmed) && !PERCENT.test(trimmed) && !REGISTRATION.test(trimmed)) {
    const words = trimmed.match(HEADING_WORDS) ?? [];
    if (fields.length >= 2 && words.length >= Math.ceil(fields.length / 2)) {
      return "the table's column headings";
    }
  }

  return null;
}

function readRow(text: string, line: number, fields: string[]): ListedSub | UnreadLine {
  /**
   * Which field is the company name.
   *
   * Taking the FIRST plausible field was the first two versions, and both were
   * wrong in a way that names a lead after something that is not a company:
   * a `Item 4` bid-item column became the name, and so did `Fontana, CA` when a
   * form put the place of business first. Neither raised a concern, and
   * `importSubListing` writes whatever this returns into `SalesLead.companyName`.
   *
   * So two changes. Fields that are self-evidently NOT a company are excluded —
   * a bid item number, a place with a state code, a bare licence label. And a
   * field carrying an entity marker is PREFERRED over an earlier one without
   * it, because "Inc." is the strongest evidence of a company name there is and
   * it survives a column order this parser has never seen.
   */
  const isNameCandidate = (field: string) =>
    /[A-Za-z]{3}/.test(field) &&
    !MONEY.test(field) &&
    !PERCENT.test(field) &&
    !REGISTRATION.test(field) &&
    !/^\d+$/.test(field) &&
    !/^(?:lic|license|licence|dir|reg)\b/i.test(field) &&
    !/^(?:item|no|line|bid\s*item)\.?\s*\d+$/i.test(field) &&
    !CITY_WITH_STATE.test(field);

  const marked = fields.findIndex((field) => isNameCandidate(field) && ENTITY_MARKER.test(field));
  const nameIndex = marked !== -1 ? marked : fields.findIndex(isNameCandidate);
  if (nameIndex === -1) return { line, text, why: "no field reads as a company name" };

  const name = fields[nameIndex];
  const rest = fields.filter((_, index) => index !== nameIndex);
  const joined = rest.join("  ");

  // Money out before looking for a licence: `$1200000` is seven digits and it
  // won the licence slot, so a claim read "Listed with licence 1200000".
  const forIds = withoutMoney(text);
  const licenceFound = forIds.match(LICENCE);
  const registrationFound = forIds.match(REGISTRATION);
  const registration = registrationFound ? registrationFound[1] : null;
  const licenceRaw = licenceFound ? licenceFound[1].replace(/\s+/g, " ").trim() : null;
  const licence = licenceRaw && licenceRaw !== registration ? licenceRaw : null;

  // City first, then the scope from what is left. The other order was the first
  // draft and it was wrong on every well-formed row: "Fontana, CA" satisfies
  // "has four letters and is not a number", so the city column won the
  // portion-of-work slot and the real scope — the one the whole feature quotes
  // — was discarded.
  const city = rest.find((field) => CITY_WITH_STATE.test(field)) ?? null;

  const scope =
    rest.find(
      (field) =>
        /[A-Za-z]{4}/.test(field) &&
        !MONEY.test(field) &&
        !PERCENT.test(field) &&
        field !== city &&
        field !== licenceRaw &&
        field !== registration &&
        // An address line: a street number and a state code, which is the
        // place-of-business column and not a scope of work.
        !/^\d+\s+\S/.test(field) &&
        !/\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(field) &&
        !/^(?:lic|license|licence|dir|reg)\b/i.test(field),
    ) ?? null;

  const match = tradeMatchFor(scope);
  const concerns: string[] = [];

  if (scope && DANGLING.test(scope)) {
    concerns.push(
      `the portion of work reads "${scope}" and looks cut off — check whether it continues on the next line`,
    );
  }
  // The name matters more than the scope and was never checked. An unindented
  // wrapped cell left `name: "Southern California Drywall &"`, with no warning,
  // and that string goes straight into SalesLead.companyName.
  if (DANGLING.test(name)) {
    concerns.push(
      `the company name reads "${name}" and looks cut off — check whether it continues on the next line`,
    );
  }
  if (match.alsoMatched.length > 0) {
    concerns.push(
      `the portion of work mentions more than one of our trades — read as ${match.scope}, but it also matches ${match.alsoMatched.join(" and ")}`,
    );
  }
  // The name/scope columns reversed: the first non-numeric field was a scope of
  // work, so the "company name" is a trade description and the lead would be
  // named after a portion of work.
  //
  // The discriminator is PAIRWISE, and the first version was not: it asked
  // whether the scope field failed to match a trade, which is false whenever the
  // company name contains a trade word — "Acme Drywall, Inc." in the scope slot
  // matches `drywall`, so the check never fired on the very case it was written
  // for. What actually separates the two columns is that a company name carries
  // an entity marker and a scope of work does not. So: the name reads as a trade
  // AND carries no entity marker, while the scope reads as a company.
  if (
    tradeMatchFor(name).scope &&
    !ENTITY_MARKER.test(name) &&
    scope !== null &&
    ENTITY_MARKER.test(scope)
  ) {
    concerns.push(
      `"${name}" reads like a portion of work rather than a company — check whether this form puts the scope in the first column`,
    );
  }

  return {
    name,
    sourceText: text.trim(),
    line,
    portionOfWork: scope,
    tradeScope: match.scope,
    licence,
    registration,
    city,
    amount: parseAmount(joined),
    percentOfBid: parsePercent(joined),
    concerns,
  };
}

function isUnread(value: ListedSub | UnreadLine): value is UnreadLine {
  return "why" in value;
}

/**
 * Read a pasted subcontractor listing.
 *
 * Pure: no database, no network, no model. The input is whatever a person
 * selected out of a public document and pasted, which is the whole reason this
 * is trustworthy — the evidence is on their screen while they review it.
 */
export function parseSubListing(text: string): SubListingParse {
  const lines = text.split(/\r?\n/);
  const { header, problems } = readHeader(lines);

  const rows: ListedSub[] = [];
  const unread: UnreadLine[] = [];
  const ignored: IgnoredLine[] = [];
  let headerLines = 0;
  let nonBlankLines = 0;

  /** One-column lines, held back: a wrap, or prose. Decided after the rows. */
  const singles: { line: number; text: string }[] = [];

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    nonBlankLines += 1;

    if (isHeaderLine(raw)) {
      headerLines += 1;
      return;
    }

    const fields = splitFields(raw);
    const furniture = furnitureReason(raw, fields);
    if (furniture) {
      ignored.push({ line, text: raw, why: furniture });
      return;
    }

    if (fields.length < 2) {
      singles.push({ line, text: raw });
      return;
    }

    const result = readRow(raw, line, fields);
    if (isUnread(result)) unread.push(result);
    else rows.push(result);
  });

  /**
   * A one-column line is either the rest of the row above it or it is prose, and
   * the two are told apart by whether that row looks cut off — not by
   * indentation, which the first version used and which an unindented wrap
   * walked straight past.
   *
   * Attributed, not appended: appending would put text this parser guessed at
   * into a claim, and a claim is supposed to be the document's own words about a
   * row rather than this function's opinion about which row they belong to.
   */
  for (const single of singles) {
    const above = [...rows].reverse().find((row) => row.line < single.line);
    const cutOff =
      above && (DANGLING.test(above.name) || (above.portionOfWork ? DANGLING.test(above.portionOfWork) : false));
    if (above && cutOff) {
      above.concerns.push(
        `line ${single.line} ("${single.text.trim()}") has one column and may be the rest of this row`,
      );
      ignored.push({
        line: single.line,
        text: single.text,
        why: `read as the continuation of line ${above.line}`,
      });
    } else {
      ignored.push({
        line: single.line,
        text: single.text,
        why: "one column only — a heading or prose, not a table row",
      });
    }
  }

  const accountedFor = rows.length + unread.length + ignored.length + headerLines;

  return {
    header,
    rows,
    unread,
    ignored,
    problems,
    reconciliation: {
      nonBlankLines,
      rowsParsed: rows.length,
      headerLines,
      ignoredLines: ignored.length,
      unreadLines: unread.length,
      accountedFor,
      agreed: accountedFor === nonBlankLines && unread.length === 0 && problems.length === 0,
    },
  };
}
