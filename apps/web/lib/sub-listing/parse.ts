import { TRADE_SCOPE_OPTIONS } from "@/lib/trade-scopes";

/**
 * READING THE SUBCONTRACTOR LISTING OFF A PUBLIC BID OR AWARD DOCUMENT.
 *
 * The acquisition motion this serves: find a project recently awarded or out to
 * bid, find the subs named on it, and reach each one about THEIR OWN job. The
 * one pro-outbound signal in the whole GTM study was that contractors answer
 * outreach that immediately names other builders they work for — and naming
 * their own job is stronger than that.
 *
 * Which makes the failure mode unusually expensive, and it is the reason this
 * file is shaped the way it is: *a generic email that is vague is forgettable;
 * a specific email that is wrong is disqualifying.* Being wrong about a man's
 * own job does not cost a reply, it costs the relationship, and in a trade this
 * small it costs the ones you have not contacted yet.
 *
 * ── THE ONE DESIGN DECISION EVERYTHING ELSE FOLLOWS FROM ──
 *
 * **A claim is the document's own words, with the line it came from.** This
 * parser never paraphrases and never infers a fact that is not written down.
 * `sourceText` on every row is the verbatim line, `line` is where to find it,
 * and the sentence a human eventually reads is assembled from those spans by
 * `describeListing`, not composed about them.
 *
 * That is a deliberate contrast with `lib/research/bidResearch.eval.ts`, which
 * measures a MODEL reading the live web and whose header names the failure the
 * citation rules cannot catch: *"a confident owner, architect and bid date for a
 * project that does not exist, or for a DIFFERENT project with a similar name…
 * a page about some other hospital expansion is a real page, really returned by
 * a real search, and a fact lifted off it carries a working link. Every
 * code-level guard passes."*
 *
 * This reader cannot have that failure, and not because it is careful — because
 * it has no mechanism for it. It reads one document a person is looking at,
 * quotes it, and cites the line. There is nothing here that can prefer a
 * similarly-named project, because nothing here goes looking for one.
 *
 * ── THE FAILURE IT *CAN* HAVE, AND THE GUARANTEE AGAINST IT ──
 *
 * Reading 7 of 11 subs and reporting 7. Nobody notices a sub who was never
 * mentioned, which is this repo's most-repeated shape — *nothing is ever
 * missing from a list nobody counted.*
 *
 * So the candidate lines are counted by an expression that **shares nothing**
 * with the one that parses rows (`looksLikeData`, which asks only whether a
 * line carries a money, percent, licence or registration token), and `unread`
 * is computed as the **set difference** of candidates minus rows. Not a
 * warning, not a log line: a structural leftover. A candidate line that
 * produced no row cannot be anywhere except `unread`, because that is the only
 * place the arithmetic can put it.
 *
 * `reconciliation.agreed` is therefore the question worth asking of a parse,
 * and the review screen leads with it rather than with the rows.
 *
 * ── WHY THE LICENCE PATTERNS NEVER REJECT ANYTHING ──
 *
 * A licence or DIR-registration token is used to RECOGNISE a candidate line and
 * to fill a field when it is there. It is never a validity test and never
 * filters a row out. The formats are written here from their shape and are
 * NOT verified against the issuing agencies' own documentation — so a row whose
 * licence looks wrong still parses, it simply gets `licence: null`. Dropping a
 * sub because an unverified regex disliked their number is precisely the silent
 * loss the paragraph above exists to prevent.
 *
 * ── WHAT IS NOT VERIFIED, SAID PLAINLY ──
 *
 * The egress proxy in this container blocks every general web host (403 on
 * CONNECT), so **no real bid or award document was read while writing this.**
 * The fixtures in `parse.test.ts` are synthetic and say so in their own header.
 * Column orders, wrapping behaviour and the exact field set of a real agency's
 * form are therefore UNCONFIRMED, which is the single most important thing for
 * the next person to fix: paste one real document in, see what `unread` says,
 * and widen from the evidence rather than from imagination.
 *
 * The parser is built to survive being wrong about that. It does not require a
 * column order, it does not require a header, and anything it cannot read it
 * hands back rather than discarding.
 */

type TradeScopeValue = (typeof TRADE_SCOPE_OPTIONS)[number]["value"];

/**
 * Keywords that identify a portion of work as one of our five trades.
 *
 * Typed as a total `Record` over the canonical list ON PURPOSE: add a sixth
 * trade to `lib/trade-scopes.ts` and this stops compiling until it is given
 * keywords here. A trade that is storable but that no document can ever match
 * is the "storable, parseable and impossible to type in" hole from #526, and a
 * type error is a cheaper way to find it than a quiet zero.
 *
 * The keys are identifiers rather than quoted strings, so this is not a seventh
 * copy of the trade list — the list is imported and this only decorates it.
 * (See issue #608: there are six hand-rolled copies of that list in this app
 * already, and no census can see them.)
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
  /** One of our five trades, when the portion of work matches confidently. */
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
   * Things about this row a person should look at before believing it.
   *
   * Not errors — the row parsed. These are the places where what was read is
   * probably INCOMPLETE, which is more dangerous than unreadable: a scope that
   * wrapped onto the next line parses as a whole phrase ending in "and", and
   * that phrase then goes into a claim somebody reads down a telephone.
   */
  concerns: string[];
};

/** A line that carries data and that this parser could not turn into a row. */
export type UnreadLine = {
  line: number;
  text: string;
  why: string;
};

export type SubListingParse = {
  /** What the document says about the project itself, when it says anything. */
  header: {
    project: string | null;
    agency: string | null;
    prime: string | null;
    bidDate: string | null;
  };
  rows: ListedSub[];
  /**
   * Candidate lines that produced no row. Computed as a set difference, so this
   * is exhaustive by construction rather than by diligence.
   */
  unread: UnreadLine[];
  /**
   * The two counts, derived by expressions that share no code.
   *
   * `agreed` false does not mean the rows are wrong — it means the document has
   * lines carrying data that this parser did not understand, and a person has
   * to look before any of it is believed.
   */
  reconciliation: {
    candidateLines: number;
    rowsParsed: number;
    agreed: boolean;
  };
};

const MONEY = /\$\s?\d[\d,]*(?:\.\d{2})?|\b\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b/;
const PERCENT = /\b\d{1,3}(?:\.\d+)?\s?%/;
/** A contractor licence as printed: 5–8 digits, optionally behind a class. */
const LICENCE = /\b(?:lic(?:ense|ence)?\.?\s*(?:no\.?|#)?\s*)?((?:[A-C]-?\d{1,2}\s+)?\d{5,8})\b/i;
/** A public-works registration number as printed: 10 digits. */
const REGISTRATION = /\b(1\d{9})\b/;

/**
 * Does this line carry data?
 *
 * Deliberately crude, and deliberately sharing no logic with `readRow`. Its job
 * is to be a SECOND opinion on how many rows the document has, so that a
 * splitter which quietly stops matching cannot also quietly shrink the expected
 * total. Over-counting here is safe and useful: an over-counted line shows up in
 * `unread`, where a person dismisses it in a glance. Under-counting is the only
 * dangerous direction, which is why the test for this asserts the false
 * positives rather than pretending they are a defect.
 */
function looksLikeData(line: string): boolean {
  if (!line.trim()) return false;
  return (
    MONEY.test(line) || PERCENT.test(line) || REGISTRATION.test(line) || LICENCE.test(line)
  );
}

/** Lines that carry money but describe the bid as a whole rather than a sub. */
/**
 * A portion of work that visibly does not finish.
 *
 * A trailing conjunction or separator is the printed evidence that a table cell
 * wrapped. Found by writing the fixtures rather than by a test failing: a row
 * reading "Metal stud framing, drywall and" parses perfectly, matches the right
 * trade, and would have put a severed phrase into a claim.
 */
const DANGLING_SCOPE = /(?:[,&/+]|\b(?:and|or|with|plus|including|incl\.?|as)\s*)$/i;

const TOTAL_LINE =
  /\b(?:total|subtotal|sub-total|base bid|bid total|grand total|alternate|add\s?alt|contingency|allowance|engineer'?s? estimate|amount bid)\b/i;

function splitFields(line: string): string[] {
  return line
    .split(/\t+|\s{2,}|\s*\|\s*/)
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

function parseAmount(raw: string): number | null {
  const found = raw.match(MONEY);
  if (!found) return null;
  const digits = found[0].replace(/[^\d.]/g, "");
  if (!digits) return null;
  const value = Number.parseFloat(digits);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function parsePercent(raw: string): number | null {
  const found = raw.match(PERCENT);
  if (!found) return null;
  const value = Number.parseFloat(found[0].replace(/[^\d.]/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * Which of our five trades a portion of work describes, or null.
 *
 * Longest keyword wins, so "spray applied fireproofing" is fireproofing rather
 * than being caught by a shorter word in another trade's list, and a tie
 * resolves to null rather than to whichever trade happens to be declared first
 * — guessing between two trades on a document we will quote back to the man who
 * filed it is not a coin worth flipping.
 */
export function tradeScopeFor(portionOfWork: string | null): TradeScopeValue | null {
  if (!portionOfWork) return null;
  const haystack = portionOfWork.toLowerCase();

  let best: { scope: TradeScopeValue; length: number } | null = null;
  let tied = false;

  for (const [scope, keywords] of Object.entries(TRADE_KEYWORDS) as [
    TradeScopeValue,
    readonly string[],
  ][]) {
    for (const keyword of keywords) {
      if (!haystack.includes(keyword)) continue;
      if (!best || keyword.length > best.length) {
        best = { scope, length: keyword.length };
        tied = false;
      } else if (keyword.length === best.length && best.scope !== scope) {
        tied = true;
      }
    }
  }

  if (!best || tied) return null;
  return best.scope;
}

const HEADER_PATTERNS: { key: keyof SubListingParse["header"]; pattern: RegExp }[] = [
  { key: "project", pattern: /^\s*(?:project|job|contract)(?:\s*name)?\s*[:\-]\s*(.+)$/i },
  { key: "agency", pattern: /^\s*(?:agency|owner|district|awarding\s*(?:agency|body))\s*[:\-]\s*(.+)$/i },
  {
    key: "prime",
    pattern:
      /^\s*(?:prime|prime\s*contractor|general\s*contractor|gc|bidder|apparent\s*low\s*bidder|awarded\s*to)\s*[:\-]\s*(.+)$/i,
  },
  { key: "bidDate", pattern: /^\s*(?:bid\s*(?:date|opening)|opened|award(?:ed)?\s*date)\s*[:\-]\s*(.+)$/i },
];

function readHeader(lines: string[]): SubListingParse["header"] {
  const header: SubListingParse["header"] = {
    project: null,
    agency: null,
    prime: null,
    bidDate: null,
  };
  for (const line of lines) {
    for (const { key, pattern } of HEADER_PATTERNS) {
      if (header[key]) continue;
      const found = line.match(pattern);
      if (found) header[key] = found[1].trim();
    }
  }
  return header;
}

/**
 * Turn one line into a row, or say why not.
 *
 * The name is taken as the first field that is not a number, a money amount or
 * a bare licence, because that is the only positional assumption that held
 * across every form shape considered — and when it does not hold, the line
 * lands in `unread` with the reason, which is the outcome this is designed for.
 */
function readRow(text: string, line: number): ListedSub | UnreadLine {
  const fields = splitFields(text);
  if (fields.length < 2) {
    return { line, text, why: "only one column — a row needs a name and a scope or an amount" };
  }

  const nameIndex = fields.findIndex(
    (field) =>
      /[A-Za-z]{3}/.test(field) &&
      !MONEY.test(field) &&
      !PERCENT.test(field) &&
      !REGISTRATION.test(field) &&
      !/^\d+$/.test(field) &&
      !/^(?:lic|license|licence|dir|reg)\b/i.test(field),
  );
  if (nameIndex === -1) {
    return { line, text, why: "no field reads as a company name" };
  }

  const name = fields[nameIndex];
  const rest = fields.filter((_, index) => index !== nameIndex);
  const joined = rest.join("  ");

  const licenceFound = text.match(LICENCE);
  const registrationFound = text.match(REGISTRATION);
  const licence = licenceFound ? licenceFound[1].replace(/\s+/g, " ").trim() : null;
  const registration = registrationFound ? registrationFound[1] : null;

  // City FIRST, then the portion of work from what is left. The other order was
  // the first draft and it was wrong on every well-formed row: "Fontana, CA"
  // satisfies "has four letters and is not a number", so the city column won
  // the portion-of-work slot and the real scope — the one the whole feature
  // quotes — was discarded. Found by tracing a fixture by hand rather than by a
  // test, which is its own small argument for writing the fixture first.
  const city = rest.find((field) => /^[A-Z][A-Za-z.\- ]+,\s*[A-Z]{2}$/.test(field)) ?? null;

  const scope =
    rest.find(
      (field) =>
        /[A-Za-z]{4}/.test(field) &&
        !MONEY.test(field) &&
        !PERCENT.test(field) &&
        field !== city &&
        field !== licence &&
        field !== registration &&
        !/^(?:lic|license|licence|dir|reg)\b/i.test(field),
    ) ?? null;
  const concerns: string[] = [];
  if (scope && DANGLING_SCOPE.test(scope)) {
    concerns.push(
      `the portion of work reads "${scope}" and looks cut off — check whether it continues on the next line`,
    );
  }

  return {
    name,
    sourceText: text.trim(),
    line,
    portionOfWork: scope,
    tradeScope: tradeScopeFor(scope),
    licence: licence && licence !== registration ? licence : null,
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
 * selected out of a public document and pasted in, which is the whole reason
 * this is trustworthy — the evidence is on their screen while they review it.
 */
export function parseSubListing(text: string): SubListingParse {
  const lines = text.split(/\r?\n/);
  const header = readHeader(lines);

  const candidates: { text: string; line: number }[] = [];
  lines.forEach((raw, index) => {
    if (!looksLikeData(raw)) return;
    if (TOTAL_LINE.test(raw)) return;
    if (HEADER_PATTERNS.some(({ pattern }) => pattern.test(raw))) return;
    candidates.push({ text: raw, line: index + 1 });
  });

  const rows: ListedSub[] = [];
  const unread: UnreadLine[] = [];

  for (const candidate of candidates) {
    const result = readRow(candidate.text, candidate.line);
    if (isUnread(result)) unread.push(result);
    else rows.push(result);
  }

  /**
   * The continuation pass — and the reason it is a separate pass.
   *
   * A wrapped table cell leaves a line carrying words and no money, no licence
   * and no percentage. `looksLikeData` therefore does not see it, which means it
   * is neither a row NOR a candidate, which means the set difference above
   * cannot report it. That is the one hole in the honest-parse guarantee, and
   * it is the hole a wrapped scope falls through.
   *
   * So: a non-blank line that carries no data token, is not header furniture,
   * and sits directly beneath a row that is indented LESS than it is, is
   * attributed to that row as a concern. Attributed, not appended — appending
   * would put text this parser guessed at into a claim, and a claim is
   * supposed to be the document's own words about a row, not this function's
   * opinion about which row they belong to.
   */
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    if (!raw.trim()) continue;
    if (looksLikeData(raw)) continue;
    if (HEADER_PATTERNS.some(({ pattern }) => pattern.test(raw))) continue;

    const indent = raw.length - raw.trimStart().length;
    if (indent === 0) continue;

    const above = rows.filter((row) => row.line === index);
    const parent = above[above.length - 1];
    if (!parent) continue;

    const parentIndent = lines[parent.line - 1].length - lines[parent.line - 1].trimStart().length;
    if (indent <= parentIndent) continue;

    parent.concerns.push(
      `line ${index + 1} ("${raw.trim()}") carries no amount or licence and may be the rest of this row`,
    );
  }

  return {
    header,
    rows,
    unread,
    reconciliation: {
      candidateLines: candidates.length,
      rowsParsed: rows.length,
      agreed: candidates.length === rows.length,
    },
  };
}
