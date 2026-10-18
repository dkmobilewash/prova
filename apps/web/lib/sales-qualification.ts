/**
 * Whether we have earned the right to call a prospect — computed, never judged.
 *
 * /sales knows who we are talking to. It cannot answer the question that
 * decides a morning: of these, which one should I call, and what do I say
 * first. This derives that from SIGNALS — one researched claim each, every
 * one carrying the page it came from.
 *
 * THE BAND IS ARITHMETIC AND THAT IS THE POINT OF THE FILE. A model may
 * extract a fact from a web page; whether the facts add up to a prospect is
 * decided here, in code somebody can read and a test can pin. CLAUDE.md's
 * product rule says the deterministic half stays deterministic and the model
 * only narrates what it is handed — this is the half that must not be an
 * opinion. Nothing in this module imports a model package, and
 * `salesQualificationPurity.test.ts` fails the build if that changes.
 *
 * A PROPOSED SIGNAL CAN NEVER RAISE THE BAND, which is the single rule most
 * easily lost in a refactor and the one worth stating twice. Research nobody
 * has read must not make a prospect look better than a prospect nobody
 * researched — otherwise the band measures how much searching happened rather
 * than what is known, and the busiest-looking lead is the one with the least
 * confirmed about it. Every function here filters to CONFIRMED first.
 *
 * WHY `disqualifies` IS A FLAG RATHER THAN A KIND. The first design had
 * NOT_A_FIT derive from a TRADE signal naming a trade outside the five, which
 * needed this module to hold a second copy of the trade list — the exact shape
 * CLAUDE.md's "is there a second list" entry says to refuse. A reviewer who
 * learns the prospect is a GC, has shut down, already pays us, or is locked
 * into a competitor is saying the same thing in each case: stop. One boolean
 * carries all of them, stays readable in the row, and keeps the canonical
 * trade list in the one place that owns it.
 *
 * NOTHING HERE IS STORED. A stored band would disagree with its own signals
 * the moment one was dismissed.
 */

/**
 * Review state of one signal. PROPOSED is research; CONFIRMED is knowledge;
 * DISMISSED is the memory that we already looked and it was wrong.
 *
 * Declared as an array and the type derived from it, rather than the other way
 * round, because the server action has to VALIDATE a state arriving from a form
 * and a bare union type cannot be iterated. One list, two uses.
 */
export const SIGNAL_STATES = ["PROPOSED", "CONFIRMED", "DISMISSED"] as const;
export type SignalState = (typeof SIGNAL_STATES)[number];

/** The states a reviewer can move a signal TO. PROPOSED is where research puts
 *  it; nothing hands a reviewed signal back to the queue. */
export const REVIEW_DECISIONS = ["CONFIRMED", "DISMISSED"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/**
 * What a signal is about. Ordered loosely by how much it changes a call:
 * the last two are the ones that give you an opening sentence.
 */
export const SALES_SIGNAL_KINDS = [
  "TRADE",
  "SIZE",
  "GEOGRAPHY",
  "LICENCE",
  "UNION",
  "TECH",
  "GC_RELATIONSHIP",
  "PROJECT",
] as const;

export type SalesSignalKind = (typeof SALES_SIGNAL_KINDS)[number];

/** The two kinds that give you something specific to open with. */
export const OPENING_KINDS: readonly SalesSignalKind[] = [
  "PROJECT",
  "GC_RELATIONSHIP",
];

/** The two kinds you cannot responsibly call without. */
export const BASELINE_KINDS: readonly SalesSignalKind[] = [
  "TRADE",
  "GEOGRAPHY",
];

/**
 * The shape this module needs. Deliberately not the Prisma row: the band is
 * pure and must be testable from literals, and a `claim` plus a state is all
 * it reads. `sourceUrl` is absent on purpose — a signal cannot exist without
 * one (the column is NOT NULL), so the band never has to check for it.
 */
export interface QualifyingSignal {
  kind: SalesSignalKind;
  state: SignalState;
  /** One sentence, as written. Used verbatim in a reason, never parsed. */
  claim: string;
  /** Confirmed, this ends the chase whatever else is known. */
  disqualifies?: boolean;
}

export const FIT_BANDS = [
  "NOT_A_FIT",
  "THIN",
  "WORTH_A_CALL",
  "STRONG",
] as const;
export type FitBand = (typeof FIT_BANDS)[number];

export interface Qualification {
  band: FitBand;
  /**
   * Why, in words a person can act on. The screen shows this instead of a
   * colour — CLAUDE.md's UI rule that a status is a word and a colour, never
   * a colour, and here the word is also the next thing to go and find out.
   */
  reason: string;
  /** Confirmed kinds, deduped, in SALES_SIGNAL_KINDS order. */
  confirmedKinds: SalesSignalKind[];
  /** Signals waiting for review. Reported, never counted toward the band. */
  awaitingReview: number;
  /**
   * The baseline kinds still missing, so the screen can say what to look for
   * rather than only that something is absent.
   */
  missing: SalesSignalKind[];
}

const inKindOrder = (a: SalesSignalKind, b: SalesSignalKind) =>
  SALES_SIGNAL_KINDS.indexOf(a) - SALES_SIGNAL_KINDS.indexOf(b);

/**
 * A claim, trimmed and bounded, safe to drop into a sentence.
 *
 * THE EMPTY FALLBACK IS NOT DEFENSIVE PADDING — it is a bug this module
 * already had for ten minutes. A caller selected only the fields the band
 * reads (`kind`, `state`, `disqualifies`) to keep a list query small and
 * passed `claim: ""`, so a STRONG lead's reason rendered as an EMPTY LINE on
 * the one screen where the reason is the whole value. Typecheck was clean and
 * `claim` is a required non-empty column, so nothing could have caught it
 * except reading the list.
 *
 * The caller was fixed to select `claim`. This stays because the next caller
 * will make the same trade for the same reason, and a band that silently
 * renders nothing is worse than one that says it cannot quote its source.
 */
function shortClaim(claim: string, whenEmpty: string): string {
  const flat = claim.replace(/\s+/g, " ").trim();
  if (!flat) return whenEmpty;
  return flat.length > 120 ? `${flat.slice(0, 117)}…` : flat;
}

export function qualify(signals: readonly QualifyingSignal[]): Qualification {
  const confirmed = signals.filter((s) => s.state === "CONFIRMED");
  const awaitingReview = signals.filter((s) => s.state === "PROPOSED").length;

  const confirmedKinds = [...new Set(confirmed.map((s) => s.kind))].sort(
    inKindOrder,
  );
  const has = (kind: SalesSignalKind) => confirmedKinds.includes(kind);
  const missing = BASELINE_KINDS.filter((k) => !has(k));

  const base = { confirmedKinds, awaitingReview, missing };

  /* A confirmed disqualifier ends it, however much else is known. Checked
     first so a well-researched lead that turns out to be a GC does not read
     as STRONG. */
  const stopper = confirmed.find((s) => s.disqualifies);
  if (stopper) {
    return {
      ...base,
      band: "NOT_A_FIT",
      reason: shortClaim(
        stopper.claim,
        "Ruled out — the reason was not recorded",
      ),
    };
  }

  if (missing.length > 0) {
    /* Named rather than counted: "no trade confirmed" is something somebody
       can go and do, where "2 signals missing" is not. */
    const wanted = missing.map((k) =>
      k === "TRADE" ? "what they do" : "where they work",
    );
    const tail =
      awaitingReview > 0
        ? ` — ${awaitingReview} signal${awaitingReview === 1 ? "" : "s"} waiting for review`
        : "";
    return {
      ...base,
      band: "THIN",
      reason: `Not confirmed yet: ${wanted.join(" and ")}${tail}`,
    };
  }

  const opening = confirmed.find((s) => OPENING_KINDS.includes(s.kind));
  if (opening) {
    return {
      ...base,
      band: "STRONG",
      reason: shortClaim(
        opening.claim,
        opening.kind === "PROJECT"
          ? "On a job right now — open the lead for which one"
          : "Works under a GC we know — open the lead for which one",
      ),
    };
  }

  return {
    ...base,
    band: "WORTH_A_CALL",
    reason: "Trade and area confirmed, but nothing specific to open with yet",
  };
}

/** Sort order for a list of leads: the ones worth calling first. */
export const BAND_RANK: Record<FitBand, number> = {
  STRONG: 0,
  WORTH_A_CALL: 1,
  THIN: 2,
  NOT_A_FIT: 3,
};

export const BAND_LABELS: Record<FitBand, string> = {
  STRONG: "Call this one",
  WORTH_A_CALL: "Worth a call",
  THIN: "Too thin to call",
  NOT_A_FIT: "Not a fit",
};
