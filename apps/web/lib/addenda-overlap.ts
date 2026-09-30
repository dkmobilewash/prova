/**
 * WHICH SCOPES MORE THAN ONE ADDENDUM HAS TOUCHED.
 *
 * A GC issues Addendum 2, which revises the partition types. Three weeks later
 * Addendum 5 revises them again. The estimator read both, and the second one
 * moved something the first one had already moved — which is where a change gets
 * missed, because the first reading is the one they remember.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * THIS IS NOT A DOCUMENT COMPARISON, AND COULD NOT BE ONE.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * `takeoff-currency.ts` says the app "has no PDF comparison", and
 * `changelog.d/diego-plan-takeoff.md` records "revision compare" as deliberately
 * not built. Nothing here reads a document. It groups the ITEM ROWS that
 * `readBidAddendumDocument` already produced, by the scope each one names, over
 * rows we already hold. The strongest thing it says is "two addenda name this
 * scope" — it does not say they conflict, or what changed between them, or which
 * one wins.
 *
 * PURE. No database, no React, no clock. Computed on every read and never
 * stored, because a stored overlap is derived state that can disagree with the
 * rows it came from — and `lib/intake/review.ts` already refuses a stored rank
 * for the same reason.
 */

/** The kinds an item's reference can carry, mirroring `BidAddendumReferenceKind`.
 *  A plain union rather than the Prisma enum so this module stays importable by a
 *  client component — `client-prisma-boundary.test.ts` fails the build otherwise. */
export type AddendumReferenceKind =
  | "SPEC_SECTION"
  | "DRAWING"
  | "SCHEDULE"
  | "REQUIREMENT"
  | "BID_PROCESS"
  | "GENERAL";

export type AddendumConfidence = "HIGH" | "MEDIUM" | "LOW";

/** One change an addendum makes, as stored in `BidAddendumReading.items`. */
export type AddendumItem = {
  ordinal: number;
  /** The addendum's own numbering for it — "Item 4", "4.", "A.3". Text, because
   *  it is the GC's numbering and follows no rule we control. */
  label: string | null;
  /** What it points at, in the document's own words. */
  reference: string;
  referenceKind: AddendumReferenceKind;
  summary: string;
  /** Why the reader says this is what changed, checkable against the page. */
  reason: string;
  confidence: AddendumConfidence;
  /** Where to look. Text, because an addendum's pages are labelled by the GC. */
  sourcePageLabel: string | null;
};

/**
 * THE GROUPING KEY.
 *
 * Whitespace, case and punctuation removed; leading qualifiers stripped
 * REPEATEDLY; and a spaced-dash title suffix dropped — because a GC and a reader
 * write the same scope several ways and the whole feature turns on those being
 * one thing:
 *
 *     "Sheet A-201"                                       -> a201
 *     "Drawing Sheet A-201"                               -> a201
 *     "Section 09 21 16"                                  -> 092116
 *     "Specification Section 09 21 16 - Gypsum Board …"    -> 092116
 *     "The Finish Schedule"                               -> finishschedule
 *
 * ── WHY IT LOOKS LIKE THAT, WHICH IS NOT GUESSWORK ──
 *
 * The first version stripped ONE leading word and nothing else, and it was
 * written against spellings I invented. Then the eval ran the real reader over
 * seven letters and SIX OF SEVEN references failed to match what the case
 * expected — not because the reader was wrong, but because it returns
 * "Specification Section 09 21 16 - Gypsum Board Assemblies" where I had
 * imagined "09 21 16".
 *
 * That is a production defect rather than a scoring one, and it is worth being
 * explicit about what it would have cost: this function is what groups scopes
 * for the overlap report AND what keys `BidAddendumItemDecision`. So two
 * addenda naming the same section would not have been flagged — the one thing
 * the overlap exists to catch — and an estimator's decision would NOT have
 * survived a re-read that worded the reference more fully, which is the exact
 * bug `addenda-readings.dbtest.ts` was written to prevent. That test passed
 * because its three spellings were also mine.
 *
 * Every pair in `addenda-overlap.test.ts` marked "from the eval" is a string a
 * real model produced. A normaliser tested only against invented input is
 * tested against its author's assumptions.
 *
 * IT DOES NOT VALIDATE AGAINST MASTERFORMAT, and that is a decision this repo
 * has already made four times — `jobs.prisma` on phase codes, `estimating.prisma`
 * and `ARCHITECTURE.md` on trade scope, and a test pinning it: "a product that
 * refuses a code for not being in a standard list is a product nobody can enter
 * their own budget into." Grouping is not validating. Nothing here rejects a
 * reference, scores it, or cares whether it is a real section number; two
 * unrecognisable strings that match each other group, and that is correct.
 *
 * WHAT IT DELIBERATELY DOES NOT COLLAPSE, so nobody reads a miss as a bug:
 *
 *   - `09 21 16.13` and `09 21 16` stay DIFFERENT. A sub-section is a narrower
 *     scope, and truncating to the parent would assert a relationship the
 *     document did not. The screen shows both raw strings side by side, so a
 *     person can see the near-match this module will not claim.
 *   - `Detail 4/A-501` and `A-501` stay different, for the same reason.
 *
 * Both are misses rather than false alarms, which is the survivable direction
 * here: a wrong "these are the same scope" sends somebody to re-check the wrong
 * thing and teaches them to distrust the flag.
 */
/** Words a GC puts IN FRONT of an identifier, stripped repeatedly because
 *  "Specification Section 09 21 16" carries two of them. `(\s+|$)` so a
 *  reference that is only a qualifier empties out rather than becoming a scope
 *  called "section". */
const QUALIFIER = /^(the|a|specification|spec|section|sheet|drawing|detail)(\s+|$)/;

/** Words appended to a document's name without changing which document it is. */
const TRAILING_NOUN = /\s+(form|forms)$/;

export function normaliseReference(raw: string): string {
  let s = raw.toLowerCase().trim();

  for (let i = 0; i < 4; i += 1) {
    const next = s.replace(QUALIFIER, "");
    if (next === s) break;
    s = next.trim();
  }

  // A SPACED dash separates an identifier from its TITLE — "09 21 16 - Gypsum
  // Board Assemblies" — and the title is not part of which section it is. An
  // UNSPACED one is part of the identifier, which is why "A-201" survives.
  s = s.split(/\s+[-–—]\s+/)[0]!.trim();
  s = s.replace(TRAILING_NOUN, "").trim();

  return s.replace(/[^a-z0-9]/g, "");
}

/**
 * KINDS THAT NEVER RAISE AN OVERLAP.
 *
 * Every addendum has a "General" item and most have something about the bid
 * date, so grouping on them would flag essentially every bid carrying two
 * addenda — a warning that is almost always uninformative, which is a warning
 * nobody reads. `takeoff-currency.ts` refuses to call a same-day issue
 * superseding for exactly this reason: "a sheet and its own transmittal
 * routinely share a date and calling that superseded would cry wolf on every
 * plan."
 *
 * The items still appear on screen. They are excluded from the OVERLAP
 * calculation only.
 */
const KINDS_WITHOUT_OVERLAP: ReadonlySet<AddendumReferenceKind> = new Set([
  "GENERAL",
  "BID_PROCESS",
]);

export type AddendumDecision = "MINE" | "NOT_MINE";

/** One addendum's newest reading, plus what the estimator has decided on it. */
export type AddendumForOverlap = {
  addendumId: string;
  /** What the GC called it — "Addendum 3". Used in the sentence, never parsed. */
  reference: string;
  /** THE NEWEST READING'S items only. A superseded reading's items must not
   *  raise an overlap: the caller passes one reading per addendum, and
   *  `sheetIndexQuery`-style newest-wins selection happens in the query. */
  items: AddendumItem[];
  /** Normalised reference -> what the estimator said about it. */
  decisions: ReadonlyMap<string, AddendumDecision>;
};

export type OverlappingScope = {
  normalisedReference: string;
  /** Every distinct way the addenda wrote it, in the order first seen. Shown
   *  side by side so a person judges the match rather than the module asserting
   *  it — two spellings grouped here is a claim, and it is checkable. */
  spellings: string[];
  kind: AddendumReferenceKind;
  /** The addenda that name it, oldest first as the caller ordered them. */
  touchedBy: { addendumId: string; reference: string; summary: string }[];
};

/**
 * The scopes named by more than one addendum.
 *
 * Items the estimator has marked NOT_MINE are excluded — having said a scope is
 * another trade's problem, being told twice that two letters mention it is
 * noise. A MINE decision does not change the calculation; it is the absence of
 * a NOT_MINE that matters, so an undecided item still counts.
 */
export function addendaOverlap(addenda: AddendumForOverlap[]): OverlappingScope[] {
  const groups = new Map<string, OverlappingScope>();

  for (const addendum of addenda) {
    // One addendum naming the same scope in two items is ONE touch, not two —
    // otherwise a letter with "09 21 16" in items 4 and 9 would report itself as
    // an overlap with nothing to compare against.
    const seenHere = new Set<string>();

    for (const item of addendum.items) {
      if (KINDS_WITHOUT_OVERLAP.has(item.referenceKind)) continue;

      const key = normaliseReference(item.reference);
      // A reference that normalises to nothing — punctuation only, or the word
      // "Section" alone — is not a scope. Dropped rather than grouped, because
      // an empty key would collect every such item into one false overlap.
      if (key === "") continue;
      if (addendum.decisions.get(key) === "NOT_MINE") continue;
      if (seenHere.has(key)) continue;
      seenHere.add(key);

      const existing = groups.get(key);
      if (existing) {
        if (!existing.spellings.includes(item.reference)) {
          existing.spellings.push(item.reference);
        }
        existing.touchedBy.push({
          addendumId: addendum.addendumId,
          reference: addendum.reference,
          summary: item.summary,
        });
      } else {
        groups.set(key, {
          normalisedReference: key,
          spellings: [item.reference],
          kind: item.referenceKind,
          touchedBy: [
            {
              addendumId: addendum.addendumId,
              reference: addendum.reference,
              summary: item.summary,
            },
          ],
        });
      }
    }
  }

  return [...groups.values()].filter((group) => group.touchedBy.length > 1);
}

/**
 * What the panel says about one overlapping scope.
 *
 * NAMES, NEVER CONCLUDES. It does not say the addenda conflict, that the later
 * one wins, or that anything needs re-pricing — the app has not compared the
 * documents and cannot know any of that. It says which letters mention the same
 * scope and leaves the reading to the person, which is `takeoff-currency.ts`'s
 * posture in its own words: "go and check what moved".
 */
export function overlapSentence(scope: OverlappingScope): string {
  const names = scope.touchedBy.map((t) => t.reference);
  const unique = [...new Set(names)];
  // TWO ADDENDA ON ONE BID MAY SHARE A NAME. `BidAddendum` has no unique on
  // `reference` and deliberately so — the number is the GC's, and "3" arriving
  // twice is their error to make, not ours to refuse. So the de-duplicated list
  // can be length one while two rows genuinely touched this scope, and joining
  // it as a list would produce " and Addendum 3". Say the count instead.
  const written =
    unique.length === 1
      ? `${scope.touchedBy.length} addenda both called ${unique[0]}`
      : unique.length === 2
        ? `${unique[0]} and ${unique[1]}`
        : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  const spelt =
    scope.spellings.length > 1 ? ` (written ${scope.spellings.join(", ")})` : "";
  return `${written} both name ${scope.spellings[0]}${spelt} — check what each one changed.`;
}
