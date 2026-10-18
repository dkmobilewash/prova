/**
 * ── THE ADDENDA LINE A BID FORM ASKS FOR, AND THE GAP IT CANNOT SEE ──
 *
 * Step 8 of an estimator's day: *"Clarifications & Assumptions: note key
 * drawing dates, addenda acknowledged (e.g. 'Includes Addenda 1-3')."* Nearly
 * every GC bid form has a box for it, and an unacknowledged addendum is one of
 * the handful of things that gets a bid thrown out on a technicality rather
 * than on price.
 *
 * `BidAddendum` already records each one, with `acknowledgedOn` and
 * `affectsPricedScope`. Nothing has ever turned that into the sentence, and —
 * the part worth more — nothing has ever asked whether the set is COMPLETE.
 *
 * ── A GAP IN THE NUMBERING IS AN ADDENDUM YOU NEVER RECEIVED ──
 *
 * GCs number addenda sequentially from 1. Holding 1, 2 and 4 does not mean
 * three addenda were issued; it means FOUR were and nobody logged the third.
 * That is the expensive shape, because every other screen in the product is
 * perfectly happy: three addenda, all read, all acknowledged, all priced. The
 * only evidence is the number that is not there.
 *
 * Nothing else in this repo can see it. `addendaOverlap` compares the addenda
 * you HAVE against each other; a missing one has nothing to overlap with.
 *
 * ── IT REPORTS, IT DOES NOT CORRECT ──
 *
 * There is no fetching addendum 3. The product's job is to say "you are missing
 * number 3" before the bid goes out, while asking the GC for it is still
 * cheap — and to refuse to write a confident acknowledgement line over a set
 * with a hole in it.
 */

/**
 * One addendum, as the bid compliance screen holds it — the same shape as
 * `AddendumInput`, so a row goes straight in.
 *
 * `AddendumInput` says of its reference: *"As the GC wrote it — 'Addendum 3',
 * 'ASI 2'. Never parsed."* That is about what is STORED and shown, and it is
 * not contradicted here: nothing in this file rewrites a reference, and every
 * message prints the GC's own words. `normaliseReference` in
 * `addenda-overlap.ts` already reads references the same way, for the same
 * reason — a derived answer needs the number, a record needs the wording.
 */
export type AcknowledgeableAddendum = {
  reference: string;
  /** Null means not acknowledged. That null is the point of the model. */
  acknowledgedOn: string | null;
  affectsPricedScope: boolean;
};

/**
 * The number a reference carries, or null when it has none.
 *
 * `Addendum No. 3`, `ADD 3`, `Addendum #03`, or a bare `3` all mean the third.
 * A reference nobody can number is not an error — some GCs issue `Addendum A` —
 * but it cannot take part in a sequence check, and this file says so rather
 * than assuming a position for it.
 */
export function addendumNumber(reference: string): number | null {
  // THE FIRST run of digits: a reference names its own number before it names
  // anything else, so `Addendum 2 to Bid Package 7` is the second addendum
  // rather than the seventh.
  const match = /\d+/.exec(reference);
  if (!match) return null;
  const n = Number(match[0]);
  // A year or a date that wandered into the field is not an addendum number.
  // Nobody issues a 200th addendum; `Addendum 2026-01-14` would otherwise read
  // as the 2,026th.
  if (!Number.isInteger(n) || n < 1 || n > 99) return null;
  return n;
}

export type AddendaStanding = {
  /** The line for the bid form, or null when one must not be written. */
  sentence: string | null;
  /** Numbers between 1 and the highest held that nobody has logged. */
  missing: number[];
  /** Received and not acknowledged. */
  unacknowledged: string[];
  /** Logged with no number anybody can place in a sequence. */
  unnumbered: string[];
  /** Changes priced scope and is not acknowledged — the worst combination. */
  pricedAndUnacknowledged: string[];
};

/** `1, 2 and 3` — and `1 through 5` once a run is long enough to be worth it. */
function listNumbers(numbers: readonly number[]): string {
  if (numbers.length === 0) return "";
  if (numbers.length === 1) return String(numbers[0]);
  const contiguous = numbers.every((n, i) => i === 0 || n === numbers[i - 1] + 1);
  if (contiguous && numbers.length >= 3) return `${numbers[0]} through ${numbers[numbers.length - 1]}`;
  const head = numbers.slice(0, -1).join(", ");
  return `${head} and ${numbers[numbers.length - 1]}`;
}

/**
 * Where a bid stands on its addenda.
 *
 * `sentence` is NULL rather than optimistic whenever something is wrong — a
 * gap, an unacknowledged addendum, or nothing logged at all. A bid form line
 * saying "Includes Addenda 1 through 3" on a set missing number 3 is worse
 * than no line: it is a written claim to have read something nobody has.
 */
export function addendaStanding(addenda: readonly AcknowledgeableAddendum[]): AddendaStanding {
  const numbered: { number: number; addendum: AcknowledgeableAddendum }[] = [];
  const unnumbered: string[] = [];
  for (const addendum of addenda) {
    const number = addendumNumber(addendum.reference);
    if (number === null) unnumbered.push(addendum.reference);
    else numbered.push({ number, addendum });
  }

  const held = [...new Set(numbered.map((one) => one.number))].sort((a, b) => a - b);
  const missing: number[] = [];
  if (held.length > 0) {
    // FROM 1, not from the lowest held. A bid holding only addendum 3 is
    // missing 1 and 2, and starting at the lowest would call that set
    // complete — which is the same set, seen from the most dangerous angle.
    for (let n = 1; n < held[held.length - 1]; n += 1) {
      if (!held.includes(n)) missing.push(n);
    }
  }

  const unacknowledged = addenda.filter((one) => one.acknowledgedOn === null).map((one) => one.reference);
  const pricedAndUnacknowledged = addenda
    .filter((one) => one.affectsPricedScope && one.acknowledgedOn === null)
    .map((one) => one.reference);

  const sound =
    addenda.length > 0 && missing.length === 0 && unacknowledged.length === 0 && unnumbered.length === 0;

  return {
    sentence: sound ? `Includes Addenda ${listNumbers(held)}.` : null,
    missing,
    unacknowledged,
    unnumbered,
    pricedAndUnacknowledged,
  };
}

/**
 * What to show when there is no sentence to give.
 *
 * Each reason gets its own words. "Something is wrong with the addenda" sends
 * somebody to read five rows; naming the number that is missing sends them to
 * the GC.
 */
export function addendaProblem(standing: AddendaStanding, received: number): string | null {
  if (standing.sentence !== null) return null;
  if (received === 0) return "No addenda logged. If the GC issued any, the bid form still has to acknowledge them.";

  const parts: string[] = [];
  if (standing.missing.length > 0) {
    parts.push(
      `Addend${standing.missing.length === 1 ? "um" : "a"} ${listNumbers(standing.missing)} ${
        standing.missing.length === 1 ? "is" : "are"
      } missing — GCs number them in sequence, so ${
        standing.missing.length === 1 ? "it was issued" : "they were issued"
      } and never logged. Ask the GC before bidding.`,
    );
  }
  if (standing.pricedAndUnacknowledged.length > 0) {
    // NAMED SEPARATELY from the plain unacknowledged list, because this is the
    // one that changes the number on the bid form as well as the paperwork.
    parts.push(
      `${standing.pricedAndUnacknowledged.join(", ")} change${
        standing.pricedAndUnacknowledged.length === 1 ? "s" : ""
      } priced scope and ${standing.pricedAndUnacknowledged.length === 1 ? "is" : "are"} not acknowledged.`,
    );
  } else if (standing.unacknowledged.length > 0) {
    parts.push(`Not acknowledged yet: ${standing.unacknowledged.join(", ")}.`);
  }
  if (standing.unnumbered.length > 0) {
    parts.push(
      `${standing.unnumbered.join(", ")} carr${standing.unnumbered.length === 1 ? "ies" : "y"} no number, so the set cannot be checked for gaps.`,
    );
  }
  return parts.join(" ");
}
