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
 * Which trade wins when two of ours match equally well. Lowest rank wins.
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
 *
 * ── A RECORD, NOT AN ARRAY, AND THE REASON IS THE FAILURE DIRECTION ────────
 *
 * This was `readonly TradeScopeValue[]` and the tie-break was
 * `TRADE_PRIORITY.indexOf(a) - TRADE_PRIORITY.indexOf(b)`. It happened to hold
 * all five trades and nothing enforced that. **`Array.prototype.indexOf`
 * returns -1 for a value it does not hold**, and -1 is lower than every real
 * index — so a sixth trade added to `lib/trade-scopes.ts` and forgotten here
 * would not throw, would not fail a test, and would silently sort FIRST, ahead
 * of this company's own primary trade. Measured on the live function, with one
 * entry commented out of the array: "Drywall and ceilings" flipped from
 * `METAL_FRAMING_DRYWALL` to `ACOUSTICAL_CEILINGS`, with 258 tests green. A
 * wrong winner is both a wrong import default (`shouldInclude` ticks a row when
 * `tradeScope !== null`) and a wrong sentence, since the TRADE claim quotes the
 * scope name down a telephone.
 *
 * A total `Record` cannot omit a key, so the omission is now a COMPILE error —
 * the earliest moment available, and the same device `TRADE_KEYWORDS` and
 * `HEADER_CONFLICT` above and `CLAIM_FOR` in `signals.ts` already use. Keys are
 * identifiers, so this is still an ORDERING of the imported list rather than a
 * seventh copy of it (issue #608).
 *
 * The rank numbers are deliberately explicit rather than derived from key order:
 * `Object.keys` order is a property of how the object was written, which makes
 * an accidental reordering invisible, whereas a number is read and reviewed.
 * `tradePriority.test.ts` asserts they are a permutation of 0…n-1 — a Record
 * cannot omit a key but it CAN give two trades the same rank, which would
 * reintroduce exactly the arbitrary tie this table exists to settle.
 */
const TRADE_PRIORITY: Record<TradeScopeValue, number> = {
  METAL_FRAMING_DRYWALL: 0,
  ACOUSTICAL_CEILINGS: 1,
  LATH_PLASTER: 2,
  EIFS: 3,
  FIREPROOFING: 4,
};

/**
 * Exported for `tradePriority.test.ts`, which is the only reader.
 *
 * The test has to see both the MEMBERSHIP and the RANKS: the type makes an
 * omission impossible, and nothing but a test can say that the order is the one
 * documented above, or that no two trades share a rank.
 */
export const TRADE_PRIORITY_RANKS: Readonly<Record<TradeScopeValue, number>> = TRADE_PRIORITY;

/**
 * The rank of a trade, and an unknown value sorts LAST rather than first.
 *
 * Unreachable by the types — every caller passes a `TradeScopeValue` and the
 * Record is total over them — so this is the belt to that braces. It exists
 * because the failure it replaces was silent and pointed the WRONG WAY: -1 put
 * an unranked trade ahead of metal framing and drywall. If a value ever reaches
 * here off a type boundary (a database row, a JSON paste), losing a tie is a
 * defensible answer and winning one is not.
 */
function priorityOf(scope: TradeScopeValue): number {
  return TRADE_PRIORITY[scope] ?? Number.MAX_SAFE_INTEGER;
}

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
  /**
   * The amount as the document printed it, to the CENT — not whole dollars,
   * which is what this line said until `parseAmount` stopped rounding. Only
   * ever rendered into a sentence, never stored as money.
   *
   * Null is the normal case rather than a failure: California's §4104 listing
   * has no dollar column at all. Null ALSO means the row carried figures and
   * this refused to choose between them, which arrives as a concern.
   */
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

/**
 * A CALIFORNIAN CITY THAT NAMES ITSELF WITHOUT A STATE CODE.
 *
 * `CITY_WITH_STATE` is strict about its two trailing capitals on purpose — that
 * is what separates "Culver City, CA" from the column heading "City, State". A
 * form that prints the place of business WITHOUT the state then had no city at
 * all, and three things followed, all measured:
 *
 *   - the city won the portion-of-work slot, because `rest.find(...)` takes the
 *     first eligible field and a city is eligible. "Bianchi Plastering, Inc. |
 *     Union City | Interior plaster work" produced `portionOfWork: "Union City"`,
 *     and the real scope was discarded;
 *   - so `tradeScope` was null, and `shouldInclude` defaults a row to ticked only
 *     when the trade matched — the prospect arrived unticked and was silently
 *     left out of the import;
 *   - and no GEOGRAPHY claim was produced from a city plainly on the page.
 *
 * This is deliberately narrow: a name ending in the word "City". That covers the
 * set that actually bites — Daly, Union, National, Culver, Redwood, Foster,
 * Cathedral — and a portion of work never ends in "City", so it cannot steal the
 * scope slot in return. A bare "Fontana" is still not recognised, and that
 * residual is handled by preferring a trade-matching scope instead.
 */
const CITY_SUFFIXED = /^[A-Z][A-Za-z.\-]+(?: [A-Z][a-z]+)* City$/;

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

/**
 * Money tokens removed, so a dollar figure cannot be read as a licence
 * (`$1200000` is seven digits, and it won the licence slot).
 *
 * **DERIVED FROM `MONEY` RATHER THAN RETYPED, because the hand-written copy had
 * already drifted and it took `moneyOnly` to notice.** The copy's suffix
 * alternation read `k|m|mm|million` with no trailing `\b`, and a regex
 * alternation is leftmost-first rather than longest-match — so on "$1.2 million"
 * it matched the `m`, stopped, and left the string "illion" behind. `MONEY`
 * escapes that only because it ends in `\b`, which forces the engine to
 * backtrack and take the whole word.
 *
 * For the two years' worth of work this file does that was harmless: a leftover
 * "illion" is not a licence number. The moment `moneyOnly` asked "is anything
 * left after the money is removed", the drift became an amount silently
 * refused — `$1.2 million` read as no amount at all, which the existing suite
 * caught because it had a case for exactly that spelling.
 *
 * Two expressions that must agree about the same thing are one expression. This
 * is the same rule CLAUDE.md states for a derived check asserting its own size:
 * the failure mode of a copy is not that it is wrong on the day it is written.
 */
const MONEY_TOKEN = new RegExp(MONEY.source, "gi");

function withoutMoney(text: string): string {
  return text.replace(MONEY_TOKEN, " ");
}

/**
 * IS THIS FIELD THE AMOUNT COLUMN, OR MERELY A FIELD WITH A DOLLAR SIGN IN IT?
 *
 * `amount` and `percentOfBid` used to be read off the whole row — the first
 * `$` anywhere and the first `%` anywhere. Two separate false claims came out
 * of that, and both are the exact failure `signals.ts` is built to prevent,
 * since money is "the one specificity that disqualifies":
 *
 *   - a row carrying a unit price and a total — "$1.85/SF … $450,000" — claimed
 *     the SUBCONTRACT was "listed at $1.85", because the unit price is printed
 *     first. Not a rounding error; a number wrong by five orders of magnitude,
 *     read down a telephone to the man who submitted it;
 *   - a portion of work reading "Drywall, 95% recycled gypsum" claimed the sub
 *     was "listed at 95% of the bid" — a fact about a product specification
 *     rendered as a fact about money.
 *
 * **And the same two tests were deleting the scope in the same breath**, which
 * is the half neither review caught. `readRow` picked the portion of work with
 * `!MONEY.test(field) && !PERCENT.test(field)`, so the field holding that
 * recycled-gypsum scope was disqualified from the scope slot too: one stray
 * percentage both invented a bid percentage and discarded the sentence this
 * whole feature exists to quote. One string, two false outputs, no warning.
 *
 * So the test is no longer "does this field CONTAIN money" but "is this field
 * ESSENTIALLY money" — strip the figure and see whether anything is left. That
 * is what separates an amount column from a sentence with a price in it, and it
 * is the same shape as `CITY_WITH_STATE` being strict about its two trailing
 * capitals: a column holds a value, prose holds a value and some words.
 *
 * Deliberately strict, and it will refuse real amounts — "$450,000.00 (15%)" is
 * read as neither. Missing an amount costs a clause in one sentence; inventing
 * one costs the prospect. The file's standing instruction applies: paste a real
 * listing, read what it says it could not read, and widen from that evidence.
 */
function moneyOnly(field: string): boolean {
  if (!MONEY.test(field)) return false;
  return withoutMoney(field).replace(/[\s.,]/g, "") === "";
}

/**
 * A PERCENTAGE COLUMN, AND WHETHER THE DOCUMENT SAID WHAT IT IS A PERCENTAGE OF.
 *
 * `percentOnly` used to answer one question and `percentOfBid` was set from any
 * field that passed it, so **every** lone percentage became "listed at N% of the
 * bid". A fourth review observed `110%` and `999%` accepted silently — neither
 * can be a share of anything — and named the two columns that make the plausible
 * values worse than the absurd ones: a payment or performance bond column prints
 * **100%**, and a retention column prints **5%**. A DBE participation column
 * prints a small number too. All three belong on a public bid document, and all
 * three would have been claimed as this subcontractor's share of the bid.
 *
 * **The first version of this fix refused a bare percentage outright, and two
 * existing tests were right to fail it.** One fixture exists precisely because a
 * form may carry a percentage column instead of a dollar column, so refusing
 * every unlabelled percentage deletes that capability — on the strength of a
 * guess about bond columns, to guard against another guess, in a file where
 * EVERY fixture is synthetic and no real form has been read. Removing a
 * capability needs better evidence than that.
 *
 * What the architecture already provides is the right answer. Every signal lands
 * PROPOSED and a person confirms it, so the useful move is not to withhold the
 * figure but to tell that person what else it could be. A bare percentage is
 * claimed AND carries a concern naming the alternatives.
 *
 * Over 100 is different in kind and is refused outright: no confirmation by
 * anybody can make "999% of the bid" true, so there is nothing for a reviewer to
 * decide.
 */
const BID_SHARE_LABEL = /\bof\s*(?:the\s*)?(?:total\s*)?(?:base\s*)?bid\b/i;

function percentColumn(field: string): { value: number; labelled: boolean } | null {
  if (!PERCENT.test(field)) return null;
  const labelled = BID_SHARE_LABEL.test(field);
  const rest = field
    .replace(/\b\d{1,3}(?:\.\d+)?\s?%/, " ")
    .replace(BID_SHARE_LABEL, " ")
    .replace(/[\s.,:]/g, "");
  if (rest !== "") return null;
  const value = parsePercent(field);
  // Over 100 is not a share of anything, whatever the label claims.
  if (value === null || value > 100) return null;
  return { value, labelled };
}

/** Kept for the scope slot, which only needs to know it IS a percentage column. */
function percentOnly(field: string): boolean {
  if (!PERCENT.test(field)) return false;
  return (
    field
      .replace(/\b\d{1,3}(?:\.\d+)?\s?%/, " ")
      .replace(BID_SHARE_LABEL, " ")
      .replace(/[\s.,:]/g, "") === ""
  );
}

/**
 * IS THIS FIELD A LICENCE COLUMN, OR MERELY A FIELD WITH SIX DIGITS IN IT?
 *
 * The same question `moneyOnly` asks, applied to the identifier it should have
 * been applied to at the same time. **It was not, and the asymmetry is the
 * defect**: `amount` was moved to column discipline after taking the first `$`
 * on the row produced a claim wrong by five orders of magnitude, with a long
 * comment reasoning from "does this field CONTAIN money" to "is this field
 * ESSENTIALLY money" — and the licence was left matching the leftmost 6-to-8
 * digit run anywhere on the row.
 *
 * What that costs, measured on a real listing shape rather than argued:
 *
 *   "Acme Interiors, Inc. | Fontana, CA | 092900 Gypsum Board | 684213 | Drywall"
 *                                         ↑ won the licence slot
 *
 * `09 29 00` and `09 24 00` are the CSI section numbers for Gypsum Board and
 * Portland Cement Plastering — the two numbers most likely to be printed on OUR
 * OWN trades' rows, in a Spec Section column. The claim went out reading
 * "Listed with licence 092900" to a man whose licence is 684213 and is sitting
 * in the next column. **A CSLB number is the single most checkable fact about a
 * contractor in this state**, so that is not a wrong detail, it is the sentence
 * that tells him we do not know who he is. `concerns: 0`, `agreed: true`.
 *
 * `parse.ts` already carried the scar in a comment two lines above the bug —
 * *"`$1200000` is seven digits and it won the licence slot"* — and the fix for
 * that was `withoutMoney`, which only works while the figure carries a `$`. The
 * moment a column prints a bare number the documented scar reopens. CLAUDE.md's
 * "a guard written as a special case for the instance that bit you does not
 * cover the next one", inside the function whose comment says so.
 *
 * So: strip an optional label and an optional class prefix, and what is left
 * must be the number and NOTHING else. A spec section with a title after it, a
 * quantity with a unit after it, and a dollar figure all fail that.
 */
const LICENCE_LABEL = /^(?:cslb\s*)?(?:lic(?:ense|ence)?\.?)?\s*(?:no\.?|number|#)?\s*:?\s*/i;

function licenceOnly(field: string): string | null {
  const bare = field.replace(LICENCE_LABEL, "").trim();
  const found = bare.match(/^((?:[A-C]-?\d{1,2}\s+)?\d{6,8})$/);
  return found ? found[1].replace(/\s+/g, " ") : null;
}

/** The same discipline for a public-works registration: ten digits, alone. */
const REGISTRATION_LABEL = /^(?:dir\s*)?(?:reg(?:istration)?\.?)?\s*(?:no\.?|number|#)?\s*:?\s*/i;

function registrationOnly(field: string): string | null {
  const bare = field.replace(REGISTRATION_LABEL, "").trim();
  const found = bare.match(/^(1\d{9})$/);
  return found ? found[1] : null;
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
  // Rounded to the CENT, not to the dollar. `Math.round(value * multiplier)`
  // was the first version, and `signals.ts` says in its own header that
  // "nothing is inferred, nothing is rounded" — so "$450,000.75" reaching a
  // claim as "$450,001.00" was the code contradicting the documentation on the
  // one field where the number is the point. The rounding cannot simply go:
  // `1.2 * 1_000_000` is not guaranteed exact in binary floating point, which
  // is what the round was there for. Cents keep that protection and change no
  // figure a document actually printed.
  return Math.round(value * multiplier * 100) / 100;
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
    b[1] === a[1] ? priorityOf(a[0]) - priorityOf(b[0]) : b[1] - a[1],
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
 * What a CONFLICT in each header field costs, which is why every field is
 * guarded and not just the prime.
 *
 * A total `Record`, so a fifth header field cannot be added without saying here
 * what two of it would mean — the same device `signals.ts` uses for its kinds,
 * and for the same reason: an omission looks exactly like a decision.
 */
const HEADER_CONFLICT: Record<
  keyof SubListingParse["header"],
  { plural: string; consequence: string }
> = {
  project: {
    plural: "projects",
    consequence:
      "No claim will name a project. Naming the wrong one is a sentence about a job this subcontractor never bid, which is the failure this reader is most careful about.",
  },
  agency: {
    plural: "awarding agencies",
    consequence: "No claim will name an agency.",
  },
  prime: {
    plural: "prime contractors",
    consequence:
      "No claim will name a prime. Nothing in a flat paste says which subcontractor sits under which.",
  },
  bidDate: {
    plural: "bid dates",
    consequence: "No claim will state a bid date.",
  },
};

/**
 * Read the header, and REFUSE to pick a value when the document names several.
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
 *
 * ── AND THE FIX WAS APPLIED TO ONE FIELD OUT OF FOUR ──────────────────────
 *
 * That paragraph was written, tested and shipped while `project`, `agency` and
 * `bidDate` kept the exact code it describes as the bug: `if (!header[key])
 * header[key] = value`, first one silently wins. A review found it; it is the
 * same defect, in the same function, three more times, under a comment
 * explaining why it was unacceptable.
 *
 * The cost is not smaller for being on a different field. `projectPhrase` feeds
 * both the PROJECT and the GC_RELATIONSHIP claim, so a packet covering two
 * schools tells every subcontractor on the second one that they were named on a
 * bid for the first — a specific, checkable, false sentence about the reader's
 * own work, which is the one thing the GTM study calls disqualifying.
 *
 * So the rule is general now and the prime is not a special case: collect every
 * DISTINCT value a field is given, use it when there is exactly one, and when
 * there is more than one null the field and say so. A field repeated with the
 * same value is not a conflict — one listing commonly reprints its own header on
 * page two.
 *
 * The lesson is the shape rather than the fields: a guard written as a
 * special case for the instance that bit you is a guard that does not cover the
 * next one. `HEADER_CONFLICT` makes the general version the only version.
 */
function readHeader(lines: string[]): { header: SubListingParse["header"]; problems: string[] } {
  const keys = Object.keys(HEADER_CONFLICT) as (keyof SubListingParse["header"])[];
  const seen = new Map<keyof SubListingParse["header"], string[]>(keys.map((key) => [key, []]));

  for (const line of lines) {
    for (const { key, pattern } of HEADER_PATTERNS) {
      const found = line.match(pattern);
      if (!found) continue;
      const value = found[1].trim();
      if (!value) continue;
      const values = seen.get(key);
      if (values && !values.includes(value)) values.push(value);
    }
  }

  const header: SubListingParse["header"] = {
    project: null,
    agency: null,
    prime: null,
    bidDate: null,
  };
  const problems: string[] = [];

  for (const key of keys) {
    const values = seen.get(key) ?? [];
    if (values.length === 1) {
      header[key] = values[0];
      /**
       * A HEADER VALUE CAN WRAP TOO, AND `looksCutOff` WAS EXPORTED FOR EXACTLY
       * THIS AND APPLIED ONLY TO THE PORTION OF WORK.
       *
       * "Project: Lincoln Elementary School Modernization and" / "Site
       * Improvements, Phase 2" puts the second half on its own line, which is
       * one column and is filed as prose. So the project name was truncated at
       * a conjunction and went straight into the two claims that name the man's
       * JOB — `PROJECT` and `GC_RELATIONSHIP` — reading "Works under Swinerton
       * Builders — their subcontractor on Lincoln Elementary School
       * Modernization and". No concern, no problem, `agreed: true`.
       *
       * The trade claim has been hedged against this since the first review, and
       * the claim naming the project was not: the same defect, on the half of
       * the sentence that is harder to shrug off. `signals.ts` hedges it now,
       * and this raises a problem so the screen says so rather than leaving the
       * hedge as the only sign.
       */
      if (looksCutOff(values[0])) {
        problems.push(
          `the ${key === "bidDate" ? "bid date" : key} reads "${values[0]}" and visibly does not finish — it has probably wrapped onto the next line, which this reader cannot join up. Check it before any claim quoting it goes out.`,
        );
      }
    } else if (values.length > 1) {
      const { plural, consequence } = HEADER_CONFLICT[key];
      problems.push(
        `this document names ${values.length} ${plural} (${values.join("; ")}), and nothing in a flat paste says which subcontractor belongs to which. ${consequence} Paste one bidder's listing at a time.`,
      );
    }
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
  if (fields.some((field) => CITY_WITH_STATE.test(field) || CITY_SUFFIXED.test(field))) return true;
  if (fields.some((field) => ENTITY_MARKER.test(field))) return true;
  return false;
}

/**
 * DOES THIS TEXT LOOK LIKE A WHOLE TABLE ROW?
 *
 * Two of three — a 6-to-10 digit licence or registration, a "City, ST", a
 * company entity marker. Extracted so ONE definition serves both callers: the
 * one-column branch, which uses it to tell a squashed row from a wrap fragment,
 * and `agreed`, which uses it to ask whether anything in the set-aside pile looks
 * like a subcontractor. Two copies of this question would be the "is there a
 * second list" defect CLAUDE.md records, in a file that already has three
 * entries about it.
 */
/**
 * A FIELD THAT OPENS THE WAY THE REST OF A SENTENCE OPENS.
 *
 * "and drywall" is not a portion of work; it is the tail of one. A cell never
 * begins with a conjunction and a company name never begins lowercase, so either
 * is strong evidence that this line is the overflow of the line above it.
 */
const CONTINUES = /^(?:and|or|with|plus|including|incl\.?|&)\b/i;

function opensAsContinuation(field: string): boolean {
  return CONTINUES.test(field) || /^[a-z]/.test(field);
}

function looksLikeARow(text: string): boolean {
  return (
    [
      /\b\d{6,10}\b/, // a contractor licence or a public-works registration
      /[A-Z][A-Za-z.\-]+,\s*[A-Z]{2}\b/, // "Fontana, CA" anywhere in the line
      ENTITY_MARKER,
    ].filter((pattern) => pattern.test(text)).length >= 2
  );
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
    /**
     * A COLUMN HEADING NEVER NAMES ONE OF OUR FIVE TRADES.
     *
     * The heading-majority rule needs two heading words out of three or four
     * fields, and two is cheap: `work` is what a "Portion of Work" column echoes
     * into its own cells, and `scope` is what a form that LABELS its cells
     * prints. So "Northstate Drywall | Chico | Scope: drywall work" was filed as
     * "the table's column headings" — three heading words by the pattern's
     * reckoning, no licence, no entity suffix, and a city with neither a state
     * code nor the word "City" to rescue it. A drywall subcontractor, lost, with
     * `agreed: true` over the loss.
     *
     * A real heading row reads "Subcontractor | City | License | Portion of
     * Work", and not one of those fields names a trade: the heading says what the
     * column IS, the cell says what the work is. So a field that matches one of
     * our five is positive evidence of a DATA row, exactly as a licence number
     * is, and it belongs in the same place — ahead of the furniture tests rather
     * than inside them.
     */
    const namesOneOfOurTrades = fields.some((field) => tradeMatchFor(field).scope !== null);
    if (!namesOneOfOurTrades && fields.length >= 2 && words.length >= Math.ceil(fields.length / 2)) {
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

  /**
   * The licence and the registration, read from COLUMNS — see `licenceOnly`.
   * Two candidates and this refuses to pick one, which is the doctrine the
   * amount already follows and the header already follows for a second `Prime:`.
   * The refusal is a concern, never silence.
   */
  const licenceFields = [...new Set(fields.map(licenceOnly).filter((v): v is string => v !== null))];
  const registrationFields = [
    ...new Set(fields.map(registrationOnly).filter((v): v is string => v !== null)),
  ];
  const registration = registrationFields.length === 1 ? registrationFields[0] : null;
  const licence = licenceFields.length === 1 ? licenceFields[0] : null;

  // City first, then the scope from what is left. The other order was the first
  // draft and it was wrong on every well-formed row: "Fontana, CA" satisfies
  // "has four letters and is not a number", so the city column won the
  // portion-of-work slot and the real scope — the one the whole feature quotes
  // — was discarded.
  const city =
    rest.find((field) => CITY_WITH_STATE.test(field)) ??
    rest.find((field) => CITY_SUFFIXED.test(field)) ??
    null;

  /**
   * PREFER A FIELD THAT NAMES ONE OF OUR TRADES over the first merely-eligible
   * one. `rest.find(...)` took the first, so any column printed before the
   * portion of work and not otherwise excluded won the slot — which is how a city
   * came to be quoted as a scope of work. The portion of work is, by definition,
   * the field most likely to name a trade, and that is a far better
   * discriminator than position on a form whose column order this parser has
   * never seen.
   *
   * The fallback is unchanged, so a row whose scope is NOT one of our five still
   * behaves exactly as before. That row is not a prospect, which is why this is
   * the right place to stop rather than guess further.
   */
  const eligible = (field: string) =>
    /[A-Za-z]{4}/.test(field) &&
        // `moneyOnly`/`percentOnly`, not `MONEY`/`PERCENT`: the strict versions
        // kept the amount column out of the scope slot, which is what they were
        // for, and ALSO threw away any portion of work that happened to mention
        // a figure. See the note on those two functions.
        !moneyOnly(field) &&
        !percentOnly(field) &&
        field !== city &&
        // An identifier column is never the scope. Tested by SHAPE rather than
        // by inequality against the chosen value, which is what this read before
        // — so when two licence-shaped fields made the parser refuse to choose,
        // `licence` was null and BOTH of them became eligible to be quoted as
        // the portion of work. A refusal must not widen what else can go wrong.
        licenceOnly(field) === null &&
        registrationOnly(field) === null &&
        // An address line: a street number and a state code, which is the
        // place-of-business column and not a scope of work.
        !/^\d+\s+\S/.test(field) &&
        !/\b[A-Z]{2}\s+\d{5}(-\d{4})?\b/.test(field) &&
        !/^(?:lic|license|licence|dir|reg)\b/i.test(field);

  const scope =
    rest.find((field) => eligible(field) && tradeMatchFor(field).scope !== null) ??
    rest.find(eligible) ??
    null;

  /**
   * The amount and the bid percentage, read from COLUMNS rather than from
   * anywhere on the row — see `moneyOnly`. Two figures and this refuses to pick
   * one, which is the rule the header already follows for a multi-prime packet:
   * when a document says two things, a parser that chooses is a parser that
   * invents.
   *
   * The refusal is a CONCERN, never silence. A dollar figure on the page that
   * does not reach a claim is exactly the "lost quietly" shape this file is
   * built against — the reviewer has the document open and can settle in a
   * second what no amount of parsing will.
   */
  const amounts = [...new Set(rest.filter(moneyOnly).map(parseAmount))].filter(
    (value): value is number => value !== null,
  );
  const percentCols = rest
    .map(percentColumn)
    .filter((found): found is { value: number; labelled: boolean } => found !== null);
  // A percentage over 100 is dropped by `percentColumn`, and dropping it in
  // silence would break this file's own rule that a refusal is never silence.
  const impossiblePercents = rest
    .filter((field) => percentOnly(field))
    .map(parsePercent)
    .filter((value): value is number => value !== null && value > 100);
  const percents = [...new Set(percentCols.map((found) => found.value))];
  const amount = amounts.length === 1 ? amounts[0] : null;
  const percentOfBid = percents.length === 1 ? percents[0] : null;

  const match = tradeMatchFor(scope);
  const concerns: string[] = [];

  if (amounts.length > 1) {
    concerns.push(
      `this row carries ${amounts.length} separate dollar columns (${rest.filter(moneyOnly).join("; ")}) and nothing says which is the subcontract amount — no amount will be claimed`,
    );
  } else if (amounts.length === 0 && MONEY.test(joined)) {
    const token = joined.match(MONEY)?.[0]?.trim();
    concerns.push(
      `this row mentions ${token ?? "a dollar figure"} inside a wider field rather than in a column of its own — read as a unit price or prose, not the subcontract amount, so no amount will be claimed`,
    );
  }
  if (licenceFields.length > 1) {
    concerns.push(
      `this row carries ${licenceFields.length} licence-shaped numbers (${licenceFields.join("; ")}) and nothing says which is the contractor's licence — none will be claimed. A spec-section number printed in its own column looks exactly like a licence`,
    );
  } else if (licenceFields.length === 0 && LICENCE.test(withoutMoney(text))) {
    concerns.push(
      `this row has a licence-shaped number inside a wider field rather than in a column of its own — read as a spec section, a quantity or prose, so no licence will be claimed`,
    );
  }
  if (registrationFields.length > 1) {
    concerns.push(
      `this row carries ${registrationFields.length} registration-shaped numbers and nothing says which is the public-works registration — none will be claimed`,
    );
  }
  if (percents.length > 1) {
    concerns.push(
      `this row carries ${percents.length} columns labelled as a share of the bid and nothing says which is this subcontractor's — no percentage will be claimed`,
    );
  }
  if (impossiblePercents.length > 0) {
    concerns.push(
      `this row prints ${impossiblePercents.map((value) => `${value}%`).join(" and ")}, which cannot be a share of a bid — read as something else entirely and not claimed`,
    );
  }
  if (percents.length <= 1 && percentCols.some((found) => !found.labelled)) {
    const bare = percentCols.filter((found) => !found.labelled).map((found) => `${found.value}%`);
    concerns.push(
      `this row carries ${bare.join(" and ")} in a column that does not say what it is a percentage OF — a bond column prints 100%, a retention column prints 5%, and a share of the bid looks the same, so no percentage will be claimed`,
    );
  }

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
    amount,
    percentOfBid,
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
/**
 * A FORM-SHAPED LISTING, WHICH THIS PARSER CANNOT READ — AND SAYS SO.
 *
 * Every fixture in `subListingCases.ts` is a COLUMN TABLE, and its own header
 * says it is a guess: no real document had been read when they were written.
 * One has now been read — a Caltrans Bid Book pulled from the public Post-Bid
 * Files portal — and it is not a column table at all. It is a FORM: sixty
 * numbered blocks, four of them filled, with the labels inline beside the
 * values rather than above them in a heading row:
 *
 *     1) List this subcontractor?        YES      NO
 *          Business Name ACME WALL SYSTEMS    Location City RIVERBEND  State CA
 *            California Contractor License Number    712345
 *          Item      %        Description
 *        1     50.00%    LEAD COMPLIANCE PLAN
 *
 * Measured against the real document, `readRow` returns **228 rows for three
 * subcontractors**, none of them clean: the per-item description lines become
 * companies, the form's own `Sample Data Entry` block becomes two phantom subs
 * ("striping", "reinforcement"), the page furniture becomes rows, and the one
 * line carrying a company name is eaten by the heading-majority branch because
 * it genuinely contains the words Name, City and State.
 *
 * **Why the refusal rather than a patch.** The comment above `accountedFor`
 * predicted this exact loss — "the row carrying NONE of them… eaten by the
 * heading-majority branch" — and says the fix belongs in `splitFields` and
 * `furnitureReason`, not in a guard over the set-aside pile, which was built,
 * measured dead across 308 tests, and deleted. That is still right. Reading
 * this shape needs a block reader keyed on the numbered toggle, which is a new
 * top-level path rather than a patch, and it is not in this change. What IS in
 * this change is refusing to pretend: 228 junk rows would import 228 junk
 * leads, and a lead named "Business Name ACME WALL SYSTEMS" is worse than no
 * lead, because somebody would have to find and delete it — and every lead this
 * importer writes is currently undeletable.
 *
 * **Deliberately keyed on two unmistakable markers, not on the labels.** A
 * heading row in a legitimate column table can perfectly well read
 * "Business Name   Location City   State", so matching the labels would refuse
 * documents this parser reads correctly today. The numbered toggle and the
 * form's own revision id cannot appear in a pasted table. Conservative on
 * purpose: a false positive here costs a working capability, a false negative
 * only leaves the behaviour this change found.
 */
const FORM_BLOCK_TOGGLE = /^\s*\d+\)\s*List this subcontractor\?/im;
const FORM_REVISION_ID = /\bDES-OE-0102\b/i;

function formShapedListing(text: string): boolean {
  return FORM_BLOCK_TOGGLE.test(text) || FORM_REVISION_ID.test(text);
}

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

  /**
   * THE FORM SHAPE IS RECOGNISED AND REFUSED, WITH EVERY LINE STILL ACCOUNTED FOR.
   *
   * Each non-blank line goes to `ignored` under one named reason, so the
   * partition this file's whole design rests on still holds — `accountedFor`
   * equals `nonBlankLines` — and `agreed` reads false on its third conjunct
   * because a problem was raised. No row is invented and no count is implied.
   */
  if (formShapedListing(text)) {
    lines.forEach((raw, index) => {
      if (!raw.trim()) return;
      nonBlankLines += 1;
      ignored.push({
        line: index + 1,
        text: raw,
        why: "this is a form, not a table — see the problem above",
      });
    });
    problems.push(
      "this looks like a filled subcontractor FORM — the kind with one numbered block per subcontractor and the labels printed beside the values — and this reader only understands a column TABLE. Nothing on this page has been read as a subcontractor, deliberately, because reading it wrongly would import leads that are not real. Paste the subcontractor table from a bid tabulation or an award packet instead, or send this document to Diego so the form reader can be built against it.",
    );
    return {
      header,
      rows,
      unread,
      ignored,
      problems,
      reconciliation: {
        nonBlankLines,
        rowsParsed: 0,
        headerLines,
        ignoredLines: ignored.length,
        unreadLines: 0,
        accountedFor: ignored.length + headerLines,
        agreed: false,
      },
    };
  }

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

    /**
     * A WRAP THAT SPANS TWO COLUMNS INVENTED A SUBCONTRACTOR, AND THE EXISTING
     * CONTINUATION BRANCH COULD NOT SEE IT.
     *
     * That branch only considers lines with fewer than two fields, which is a
     * wrap of ONE cell. A real PDF row wraps in several cells at once:
     *
     *     Southern California      Fontana, CA  1065432  Metal stud framing
     *     Drywall & Interiors, Inc.                      and drywall
     *
     * The second line has two fields, so it never reached the branch and became
     * its own row. Reproduced: THREE rows for two subcontractors, zero concerns,
     * `agreed: true`, and run through the real importer it wrote a lead named
     * "Drywall & Interiors, Inc." carrying a sourced claim that Swinerton
     * Builders listed it as their subcontractor on a named project — a company
     * that does not exist, ticked by default because its trade matched, and
     * UNDELETABLE, since a lead with signals cannot be removed.
     *
     * Meanwhile the real company's lead is named "Southern California" and its
     * trade claim quotes "Metal stud framing" as the whole portion of work. The
     * hedge cannot fire: the truncation lands on a word boundary, so there is no
     * dangling token for `looksCutOff` to catch. The claim-hedging mechanism
     * bypassed rather than absent, which is worse.
     *
     * Three things together, because any one alone would swallow a real row:
     * the line does not look like a row in its own right; it has FEWER fields
     * than the row above, as an overflow must; and one of its fields opens as a
     * continuation. A sole proprietor's row with no identifiers — the case the
     * heading-majority defect loses — passes the first two and fails the third,
     * which is what keeps this from eating it.
     *
     * Attributed, never appended. Joining the halves would put text this parser
     * guessed at into a claim, and a claim is the document's words about a row,
     * not this function's opinion about which row they belong to.
     */
    const previous = rows[rows.length - 1];
    if (
      previous &&
      !looksLikeARow(raw) &&
      fields.length < splitFields(previous.sourceText).length &&
      fields.some(opensAsContinuation)
    ) {
      previous.concerns.push(
        `line ${line} ("${raw.trim()}") has fewer columns than this row and reads as its continuation — this row's name and portion of work are probably both cut short`,
      );
      ignored.push({
        line,
        text: raw,
        why: `read as the continuation of line ${previous.line}`,
      });
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
    /**
     * DOES THIS ONE COLUMN LOOK LIKE A WHOLE ROW? AND IT OUTRANKS THE CONTINUATION TEST.
     *
     * The first version of this fix put the continuation branch first, on the
     * reasoning that a wrapped cell's second half may carry an entity marker
     * ("Interiors, Inc.") and so cannot be told from a row by that alone. True,
     * and it misses the worse case: a single-spaced row that happens to FOLLOW
     * a genuinely cut-off row is swallowed as that row's continuation, which
     * does not merely lose it — it pushes a concern onto a SURVIVING row saying
     * that other subcontractor's text "may be the rest of this row", and that
     * row's claim is what somebody reads down a telephone.
     *
     * What separates them is how MANY things the line carries at once. A wrap
     * fragment is the tail of ONE cell, so it has one signal at most
     * ("Interiors, Inc." is an entity marker and nothing else). A squashed row
     * is a whole table entry, so it has a licence AND a place AND usually a
     * company marker. Two of the three is the line.
     *
     * The first version of this test was `/\d{4,}/` — any run of four digits —
     * reusing `hasDataEvidence`, and the existing furniture case caught it
     * within the minute: "Questions: (916) 555-0134" carries the four-digit run
     * `0134`, and "Printed 2026-03-04" carries `2026`. Both became "a
     * subcontractor we could not read", on a page that has none. That is the
     * safe direction to be wrong in and it is still wrong — a reader told a
     * clean document has an unread subcontractor stops trusting the one that
     * really does, and `agreed` would go false on every form with a phone
     * number in the footer.
     *
     * So the digit test is LICENCE-shaped (six to ten) rather than any long
     * run, which excludes a year, a time and a phone number's last group
     * outright, and it still has to be joined by a second signal.
     */
    const looksLikeItsOwnRow = looksLikeARow(single.text);

    if (above && cutOff && !looksLikeItsOwnRow) {
      above.concerns.push(
        `line ${single.line} ("${single.text.trim()}") has one column and may be the rest of this row`,
      );
      ignored.push({
        line: single.line,
        text: single.text,
        why: `read as the continuation of line ${above.line}`,
      });
      continue;
    }

    /**
     * A ONE-COLUMN LINE THAT CARRIES DATA IS A ROW WE FAILED TO SPLIT, NOT PROSE.
     *
     * This branch used to file every remaining single straight into `ignored`
     * as "a heading or prose", and that is how the completeness guarantee came
     * out false for the THIRD time in this file's life. `splitFields` splits on
     * tabs, two-or-more spaces and pipes — so a table copied out of a PDF with
     * SINGLE spaces between its columns arrives as one field per line, every row
     * lands here, and every row was quietly set aside. Reproduced with the real
     * parser on an ordinary three-sub listing: `rowsParsed: 0`, `unread: 0`,
     * `problems: 0`, `agreed: TRUE` — so the screen printed the green "All 5
     * lines accounted for — 0 subcontractors, 2 header, 3 set aside" over three
     * subcontractors it had lost.
     *
     * The partition was sound the whole time, which is exactly why nothing
     * caught it: `accountedFor` equalled `nonBlankLines`, every line had a
     * bucket and every bucket had a reason. **A bucket with a confident wrong
     * reason loses a subcontractor as thoroughly as no bucket at all** — the
     * same sentence `hasDataEvidence` was written for, arriving one branch
     * further down, which is a fair warning about how far a lesson travels.
     *
     * The two-of-three rule above decides it, and the same rule in both places
     * is deliberate: the question "is this a row" cannot have two answers
     * depending on what the line above happens to look like.
     */
    if (looksLikeItsOwnRow) {
      unread.push({
        line: single.line,
        text: single.text,
        why: "this line carries subcontractor data but arrived as a single column — the columns are probably separated by single spaces, which cannot be told apart from the spaces inside a company name",
      });
      continue;
    }

    ignored.push({
      line: single.line,
      text: single.text,
      why: "one column only — a heading or prose, not a table row",
    });
  }

  /**
   * THE BACKSTOP, for a single-column row with no data evidence at all.
   *
   * "Smith Plastering  Fontana CA" has no entity marker, no licence and no
   * "City, ST", so the test above cannot rescue it and it is still filed as
   * prose. What CANNOT be innocent is a document that produced no
   * subcontractors at all while producing lines of exactly that shape: that is
   * a parse failure, and `agreed` must not read true over it.
   *
   * **It also requires the page to have announced itself as a listing**, which is
   * the part the first version got wrong and `noise-only` caught in a minute. A
   * cover sheet reading "Page 3 of 7 / Addendum No. 2 acknowledged / Questions:
   * (916) 555-0134" parses to zero rows and two one-column lines, so the first
   * version told the reviewer the READER was broken on a page that simply has no
   * table on it. Zero subcontractors is the correct reading of that page, not a
   * failure to read it — and a guard that cries wolf on every pasted cover sheet
   * is one nobody reads by the second week.
   *
   * A header line (`Project:`, `Prime:`, `Agency:`, a bid date) is the page
   * saying it is a bid document. Zero subcontractors on a page that names a
   * project is worth a sentence; zero on a page that names nothing is not.
   *
   * Deliberately narrow — it fires only when NOTHING parsed. A document that
   * read nine subs and lost a tenth to single spacing is still a quiet loss,
   * and saying so is better than implying otherwise: widening this needs a real
   * document to calibrate against, and `splitFields` learning column positions
   * is the actual fix rather than this. Widening `splitFields` to split single
   * spaces is NOT that fix and has been measured — it returns names like
   * "Systems" and "Inc.", because a space inside "Valley Interior Systems" is
   * indistinguishable from the gap before the city column.
   */
  const unsplitLooking = ignored.filter((line) => line.why.startsWith("one column only")).length;
  if (rows.length === 0 && unsplitLooking > 0 && headerLines > 0) {
    problems.push(
      `nothing on this page was read as a subcontractor, and ${unsplitLooking} line${unsplitLooking === 1 ? " was" : "s were"} set aside as having only one column. That usually means the columns are separated by single spaces rather than tabs — try pasting from the original document, or paste one column at a time. Do not take the counts below as a reading of this page.`,
    );
  }

  /**
   * `agreed`'s FIRST CONJUNCT IS A TAUTOLOGY, AND THE FIX FOR IT WAS DEAD CODE.
   *
   * A fourth review established the defect correctly: `accountedFor ===
   * nonBlankLines` can never disagree, because every non-blank line is pushed into
   * exactly one of four buckets. The third conjunct fires only on a conflicting
   * header value. So `unread.length === 0` carries the whole verdict, and every
   * defect this parser has had reported `agreed: true` — each put a subcontractor
   * in `ignored` with a confident reason, where `agreed` cannot see it.
   *
   * **A conjunct asking whether any set-aside line looks like a row was written
   * here, and then deleted, because it was measured and it was dead.** Six
   * constructed attempts could not land a row-shaped line in `ignored` at all: a
   * totals line that is also a company, a heading-majority row carrying
   * identifiers, a page-number line with a company in it, an alternate with a
   * licence, a wrap continuation that is a whole row, and prose naming a company
   * and a licence. `hasDataEvidence` rescues anything with identifiers before the
   * furniture tests run, and `looksLikeARow` outranks the continuation branch. And
   * the decisive measurement: DELETING the branch changed no test outcome across
   * 308, which is this file's own stated definition of dead logic.
   *
   * So the hole is real and it is NOT where the review placed it. A row carrying
   * identifiers can no longer reach `ignored`; what is still lost is the row
   * carrying NONE of them — a bare surname, a city with no state code, no licence
   * column pasted — eaten by the heading-majority branch. No predicate over the
   * set-aside pile can see that, because by construction there is nothing in it to
   * see. `splitFields` and `furnitureReason` are where that gets fixed, not here,
   * and this comment exists so the next person does not rebuild the dead guard.
   */
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
