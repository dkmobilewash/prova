import { E2E_TAG } from "./tag";

/**
 * THE ONE COMPANY IN THIS SUITE WITH `Company.isProvaOperator` SET, AND THE
 * ROWS THE TWO SALES SCREENS READ.
 *
 * ── WHY THIS FIXTURE EXISTS AT ALL ──
 *
 * `/sales` and `/sales/[id]` are Prova's own cold-outbound channel — where
 * every imported lead is read, banded and confirmed. Both are gated on two
 * things that are not `lib/permissions.ts` capabilities: the Company must be
 * Prova's own operator (`Company.isProvaOperator`) and the person must be its
 * OWNER (`assertSalesAccess` in `lib/actions/sales.ts`, and the same two checks
 * written out again at the top of each page). Until 2026-10-05 NO persona in
 * this suite had that flag, and no spec named either route — so no browser had
 * ever loaded either page, and CI was green over both. That is the vacuous
 * green CLAUDE.md's Traps section exists to end: the flag is not a display
 * decision, it is the whole reason the page renders anything, so a suite
 * without it cannot reach these screens by accident the way it reaches
 * `/pipeline` or `/bids`.
 *
 * ── WHY THE DATA AND THE EXPECTED STRINGS LIVE IN ONE MODULE ──
 *
 * Everything on both screens is DERIVED on every read and stored nowhere — the
 * fit band from the signals (`lib/sales-qualification.ts`), the pipeline
 * figures from the opportunities (`lib/sales-pipeline.ts`). So a spec asserting
 * "Worth a call" is asserting an arithmetic result, and a fixture edited
 * without re-deriving it turns the spec red for a reason that is not a defect.
 *
 * The strings below are LITERALS on purpose — a spec that recomputed its own
 * expectation from the same function the page calls would pass however wrong
 * that function became. `salesFixture.test.ts` closes the gap from the other
 * side: it runs the app's real `qualify`, `buildSalesPipeline` and
 * `winRateLabel` over the data in this file and requires them to produce
 * exactly these literals. That test is in the UNIT suite, so it gates every
 * push, and it goes red the moment the fixture and the expectation disagree —
 * which is three minutes of CI rather than a twenty-minute e2e run.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ──
 *
 * No date-dependent expectation. `daysInCurrentStage`, "longest here N days",
 * "Past its close date" and "Closing within 30 days" all move with the
 * calendar, and a literal for any of them is a test with an expiry date. Every
 * opportunity below therefore has NO `expectedCloseDate`, which is also a real
 * shape worth rendering: it is the "No close date given" line, the one place
 * the band deliberately prints a figure rather than the word "none".
 */

/** The operator company. `seedDatabase.ts` creates it with
 *  `isProvaOperator: true`; nothing else in this suite has the flag. */
export const SALES_COMPANY_NAME = `${E2E_TAG} Sales Operator Co`;

/**
 * The OWNER's `User.name`, and it is load-bearing rather than cosmetic.
 *
 * Confirming a signal writes `reviewedByUserId`, and `SalesSignalRow` renders
 * "· checked by <name>" from it. That sentence CANNOT be on the page before
 * the confirm, which is what makes it a legitimate observable under CLAUDE.md's
 * needle-already-on-the-page rule — so the spec asserts this exact name, and
 * the name has to be pinned somewhere both the seed and the spec read.
 */
export const SALES_OWNER_NAME = "E2E SALES";

/**
 * The lead the signal work happens on: two baseline facts confirmed, one piece
 * of research still unreviewed.
 *
 * No opportunities on it, on purpose — that keeps it out of the pipeline band's
 * "Sitting longest" list, so the only link to it on `/sales` is its own row and
 * a locator for it cannot resolve to two elements.
 */
export const RESEARCHED_LEAD_NAME = `${E2E_TAG} Vance Drywall and Framing`;

/** The lead the pipeline band is computed from: three opportunities, no
 *  signals. Kept separate from the lead above so confirming a signal cannot
 *  move a pipeline figure and vice versa. */
export const PIPELINE_LEAD_NAME = `${E2E_TAG} Cordova Plastering and Lath`;

/**
 * The claim on the one PROPOSED signal — the sentence the band prints verbatim
 * once it is confirmed, because a confirmed PROJECT signal makes the lead
 * STRONG and `qualify` uses the claim itself as the reason.
 *
 * Under 120 characters deliberately: `shortClaim` truncates past that and
 * appends an ellipsis, and the spec asserts the whole sentence.
 */
export const PROJECT_CLAIM =
  "Framing and drywall on the Mission Valley transit centre, under Swinerton, per the awarded sub list.";

export type FixtureSignal = {
  kind: "TRADE" | "GEOGRAPHY" | "PROJECT";
  state: "CONFIRMED" | "PROPOSED";
  claim: string;
  sourceUrl: string;
  sourceTitle: string | null;
  disqualifies: boolean;
};

/**
 * The researched lead's three signals.
 *
 * **NEITHER CONFIRMED SIGNAL CARRIES A REVIEWER, AND THAT IS THE POINT.** The
 * spec proves the confirm happened by looking for "checked by E2E SALES", so if
 * either of these were seeded with a `reviewedByUserId` that sentence would
 * already be on the page and the assertion could never fail — a watcher whose
 * needle is already there (CLAUDE.md). They are seeded reviewed-by-nobody,
 * which is also what a row written by the research seam and confirmed by a
 * migration-era script would look like, so nothing is being faked.
 *
 * `state` is what makes the band move: `qualify` counts CONFIRMED signals only,
 * so TRADE + GEOGRAPHY confirmed is WORTH_A_CALL, and the PROPOSED PROJECT
 * signal contributes NOTHING until somebody reviews it. The spec asserts that
 * invariant too — research nobody has read must not make a prospect look
 * better than a prospect nobody researched.
 */
export const RESEARCHED_LEAD_SIGNALS: readonly FixtureSignal[] = [
  {
    kind: "TRADE",
    state: "CONFIRMED",
    claim: "Metal stud framing and drywall for commercial interiors, with their own crews.",
    sourceUrl: "https://example.com/vance/services",
    sourceTitle: "Vance Drywall — services",
    disqualifies: false,
  },
  {
    kind: "GEOGRAPHY",
    state: "CONFIRMED",
    claim: "Works San Diego and Imperial counties out of one yard in Chula Vista.",
    sourceUrl: "https://example.com/vance/contact",
    // Null on purpose: `SalesSignalRow` falls back to the HOSTNAME for a
    // source with no title, and that branch should render at least once.
    sourceTitle: null,
    disqualifies: false,
  },
  {
    kind: "PROJECT",
    state: "PROPOSED",
    claim: PROJECT_CLAIM,
    sourceUrl: "https://example.com/awards/mission-valley-transit",
    sourceTitle: "Mission Valley transit centre — award packet",
    disqualifies: false,
  },
];

/**
 * The stage names, as a literal union rather than as `string`.
 *
 * Not a style choice: `seedDatabase.ts` hands these straight to Prisma, whose
 * `OpportunityStage` is itself a union of these literals. Typed as `string`
 * every write in that file fails typecheck, and the error arrives in CI's
 * three-minute job pointing at the seed rather than at this declaration.
 * Deliberately NOT imported from `@prova/db` or from `lib/sales-stage-history`:
 * this module must stay readable by a unit test with no database (see the
 * header, and `tag.ts`).
 */
export type FixtureStage = "NEW" | "CONTACTED" | "DEMO_SCHEDULED" | "TRIAL" | "WON" | "LOST";

export type FixtureOpportunity = {
  stage: FixtureStage;
  /** Null is "nobody has priced it", never zero — see the schema's own note. */
  estimatedMrr: number | null;
  /** Each entry is `[fromStage, toStage, effectiveOn]`. Empty means no
   *  recorded history, which the product reads as "not recorded" rather than
   *  as "created at this stage today" (the schema's NO BACKFILL note). */
  stageChanges: readonly (readonly [FixtureStage | null, FixtureStage, string])[];
};

/**
 * The pipeline lead's three opportunities: one open and priced, one won, one
 * lost and unpriced.
 *
 * Chosen so every figure the spec asserts is date-independent and so none of
 * them is an accidental zero:
 *
 *   - TRIAL $1,200/mo gives the Trial card a real money figure rather than
 *     "nothing here", and its stage history gives "Sitting longest" something
 *     to compute over (without which that whole block is absent);
 *   - one WON and one LOST gives a win rate at all — `winRate` is null when
 *     nothing has been decided, and the band then prints "no win rate yet",
 *     so a fixture with only open deals would assert the empty branch;
 *   - the LOST one is unpriced, so the `unpriced` arm of `sliceLabel` renders.
 *
 * The stage dates are fixed instants in the past, not offsets from `now()`: a
 * date that moves every run is a date nobody can reason about from a failure
 * report (the same choice as `ESTABLISHED_ACCOUNT_ASKED_AT`). Nothing asserts
 * the day counts they produce, only that the rows exist.
 */
export const PIPELINE_OPPORTUNITIES: readonly FixtureOpportunity[] = [
  {
    stage: "TRIAL",
    estimatedMrr: 1200,
    stageChanges: [
      [null, "NEW", "2026-01-05"],
      ["NEW", "CONTACTED", "2026-01-20"],
      ["CONTACTED", "TRIAL", "2026-02-02"],
    ],
  },
  { stage: "WON", estimatedMrr: 800, stageChanges: [] },
  { stage: "LOST", estimatedMrr: null, stageChanges: [] },
];

/**
 * WHAT THE TWO SCREENS MUST SAY ABOUT THE ROWS ABOVE.
 *
 * Literals, checked against the app's own derivations by
 * `salesFixture.test.ts`. Every one of them is a sentence the product composes
 * from the fixture, so each is a thing a crash, a wrong band or a silently
 * emptied query would change.
 */
export const SALES_EXPECTED = {
  /** `BAND_LABELS.WORTH_A_CALL` — the researched lead before the confirm. */
  bandBeforeConfirm: "Worth a call",
  /** `BAND_LABELS.STRONG` — after it. Nothing on either screen can print this
   *  while the PROJECT signal is still PROPOSED, which is why the spec asserts
   *  a count of ZERO for it first. */
  bandAfterConfirm: "Call this one",
  /** `BAND_LABELS.THIN` — the pipeline lead, which has no signals at all. */
  bandNoSignals: "Too thin to call",

  reasonBeforeConfirm: "Trade and area confirmed, but nothing specific to open with yet",
  /** `qualify` uses the confirmed PROJECT signal's claim as the reason. */
  reasonAfterConfirm: PROJECT_CLAIM,
  reasonNoSignals: "Not confirmed yet: what they do and where they work",

  /** The Trial stage card, and also the "Open" line — one open deal, priced. */
  openSlice: "$1,200.00/mo across 1",
  /** The "Won / lost" line's counts, and the rate beside them. */
  wonLost: "1 / 1",
  winRate: "50% win rate",
  /** One open deal with no close date. The band prints the digit here rather
   *  than "none", with its own explanation beside it. */
  openWithoutCloseDate: "1",

  /** `SalesSignalRow`'s state words. A status is a word and a colour here. */
  signalProposed: "Not checked",
  signalConfirmed: "Confirmed",
  /** Written only by the review, from a relation the seed leaves null. */
  reviewedBy: `checked by ${SALES_OWNER_NAME}`,

  /** `SalesLeadRow`'s unreviewed-research badge: 1 before, absent after. */
  awaitingReviewBadge: "1 to check",

  /** What a NON-operator company gets at `/sales` — the other half of the
   *  gate, and the control that proves the flag is what makes the page
   *  render at all. */
  nonOperatorRefusal: "Not part of your access",
} as const;

/**
 * THE LISTING THE BROWSER PASTES — AND THE ONE THING NOTHING IN THIS REPO HAD
 * EVER PROVED.
 *
 * Added 2026-10-05. `specs/sales-crm.spec.ts` step 4 opens the import surface
 * and deliberately submits nothing, and its comment gave the reason: "driving a
 * real paste would make this spec depend on `lib/sub-listing/parse.ts`, which
 * is under active change in the other lane". `seedDatabase.ts` says the same
 * thing in the same words. **Both sentences were true when they were written
 * and are now false**: that parser is this branch's own work, it is finished,
 * and it carries 401 unit tests including a 6,000-document generated corpus. A
 * premise that stops somebody clicking the one path through a feature is worth
 * re-reading before it is inherited — this file's own header is about exactly
 * that, one level down.
 *
 * What the gap actually was, stated plainly because the list of what IS
 * verified is long enough to read as coverage:
 *
 *   - `parse.ts` — unit suite plus the generated partition corpus;
 *   - `leadMatch.ts` — unit suite plus an exhaustive 6,561-pair sweep;
 *   - `importSubListing` — 54 tests against a real Postgres, up to the 60-row
 *     cap;
 *   - `SubListingImport.tsx` — driven in real Chromium over `file://`, 74
 *     checks, **with the server action stubbed**.
 *
 * So each link was measured and the CHAIN never was: browser → Server Action →
 * Postgres → revalidated page. That is the shape of the 2026-09-21 failure this
 * whole e2e suite was built after — four green checks and 5,800 green unit
 * tests while creating one invoice crashed every authenticated page.
 *
 * ── WHY THE TEXT LIVES HERE AND NOT IN THE SPEC ──
 *
 * Same reason as everything above it: `salesFixture.test.ts` runs the app's own
 * `parseSubListing`, `shouldInclude` and `signalsForSub` over this string on
 * every push and requires them to produce exactly the literals in
 * `IMPORT_EXPECTED`. So a parser change that moves a sentence fails in CI's
 * three-minute job, naming the fixture — instead of in a twenty-minute e2e run,
 * naming a missing string, which reads like a product defect.
 *
 * ── WHY EVERY NAME AND NUMBER IN IT IS INVENTED ──
 *
 * No real company, licence or DIR registration appears in any fixture in this
 * repo, and this one writes LEADS: every row the importer creates is
 * permanently undeletable by design (sent correspondence closes, it never
 * deletes), so a real firm pasted here would be a real firm nobody can remove.
 * The `ZZ-E2E` tag is on every company name so cleanup can find them, the
 * licences are a synthetic 99088xx block and the registrations a synthetic
 * 10000300xx one.
 */
export const IMPORT_LISTING_TEXT = `
${E2E_TAG} HARBOR UNIFIED SCHOOL DISTRICT
DESIGNATION OF SUBCONTRACTORS

Project: Harbor Elementary Modernization, Increment 1
Agency: ${E2E_TAG} Harbor Unified School District
Prime Contractor: ${E2E_TAG} Northgate Builders
Bid Opening: April 2, 2026

Name of Subcontractor            City, State       Licence       DIR Reg.      Portion of Work
${E2E_TAG} Ridgeline Interiors       Fontana, CA       C-9 9908801   1000030001    Metal stud framing & drywall
${E2E_TAG} Harbor Lath and Plaster   Colton, CA        C-35 9908802  1000030002    Lath and cement plaster
${E2E_TAG} Cedar Ceilings LLC        Riverside, CA     C-2 9908803   1000030003    Acoustical ceilings
${E2E_TAG} Pinnacle Electric Corp    Perris, CA        C-10 9908804  1000030004    Electrical

Total Base Bid: $12,300,000
`;

/** Where the spec says it read the listing. Not a real host — `example.com` is
 *  reserved for exactly this (RFC 2606), and the provenance this writes is
 *  stored on every claim. */
export const IMPORT_SOURCE_URL =
  "https://example.com/zz-e2e/harbor-elementary/designation-of-subcontractors";
export const IMPORT_SOURCE_TITLE = `${E2E_TAG} Harbor USD — Harbor Elementary sub list`;

/**
 * The three rows in Prova's trades, which the screen ticks BY DEFAULT.
 *
 * In listing order, because the spec asserts the created leads by name and a
 * reordered array would be a test about the fixture's spelling.
 */
export const IMPORT_OUR_TRADES: readonly string[] = [
  `${E2E_TAG} Ridgeline Interiors`,
  `${E2E_TAG} Harbor Lath and Plaster`,
  `${E2E_TAG} Cedar Ceilings LLC`,
];

/**
 * THE FOURTH ROW, AND IT IS THE CONTROL RATHER THAN DECORATION.
 *
 * An electrical sub on a §4104 form is a real shape — every such form carries
 * trades Prova does not sell to — and `tradeScopeFor("Electrical")` returns
 * null, so `shouldInclude` leaves the box unticked. The spec asserts this name
 * is on the REVIEW screen (the parser read it; nothing is hidden) and is NOT a
 * lead afterwards. Without that pair, "three leads appeared" is satisfied by an
 * importer that creates a lead for every row it can see.
 */
export const IMPORT_NOT_OUR_TRADE = `${E2E_TAG} Pinnacle Electric Corp`;

/**
 * WHAT THE PRODUCT MUST SAY ABOUT THE PASTE ABOVE.
 *
 * Literals, gated by `salesFixture.test.ts` against the real parser. Each one
 * is composed by the app and none of them can be on the page before the event
 * it reports — the submit label counts rows the parser read from a textarea
 * that starts empty, and both summary sentences are written from the Server
 * Action's own return value.
 */
export const IMPORT_EXPECTED = {
  /** Every non-blank line lands in exactly one bucket and the reader says so.
   *  Four rows, nothing unread — the state in which the review screen shows no
   *  "might be missing subcontractors" warning. */
  rowsParsed: 4,
  unreadLines: 0,

  /** `Add ${included.length} subcontractor…` — THREE, not four, because the
   *  electrical row is unticked. The one number on the screen that proves the
   *  trade default ran. */
  submitButton: "Add 3 subcontractors",

  /** The success sentence after the first import: 5 signals × 3 rows, all three
   *  leads new, nothing attached and nothing skipped. */
  doneFirstImport: "15 signals to check across 3 new leads.",

  /**
   * And after pasting THE SAME DOCUMENT AGAIN — the addendum case, and the
   * defect this branch opened with. Importing one listing twice used to create
   * a second lead for every row, each permanently undeletable. Zero new, zero
   * claims, three recognised.
   *
   * It is the strongest sentence in this object: `0 new leads` and
   * `3 you already had` are mutually exclusive failures, so no single bug
   * produces both halves by accident.
   */
  doneReimport: "0 signals to check across 0 new leads and 3 you already had.",

  /**
   * One claim, verbatim, from the lead the first row creates.
   *
   * GEOGRAPHY rather than TRADE or PROJECT because it is the shortest claim
   * that still carries the two things worth proving reached the database: the
   * cell the parser read, and `(line 11 of the listing)` — the provenance every
   * claim quotes, which is the premise the per-lead dedupe rests on.
   */
  firstLeadClaim: "Listed out of Fontana, CA (line 11 of the listing)",

  /** `BAND_LABELS.THIN`. Five PROPOSED signals and not one confirmed, so an
   *  imported lead is as thin as a lead nobody researched — the invariant the
   *  whole PROPOSED state exists for, asserted here on a lead the browser
   *  created rather than on a seeded one. */
  bandAfterImport: "Too thin to call",
  /** `SalesLeadRow`'s unreviewed badge for five unchecked signals. */
  awaitingReviewAfterImport: "5 to check",
} as const;
