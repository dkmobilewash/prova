import type { DraftPriceBasis } from "@prova/integrations";

/**
 * THE CASES THE DRAFT-LINES EVAL RUNS, AND WHAT EACH ONE IS FOR.
 *
 * Separate from the eval for the reason `planSheetCases.ts` and `addendumCases.ts`
 * are: the number of model calls a run costs is a property of this list, so the
 * report prints `requested N, returned N` from it rather than from a sentence in a
 * header that rots the first time somebody adds a case.
 *
 * ── WHAT IS DELIBERATELY NOT TESTED HERE ──
 *
 * `draftEstimateLineItems` already downgrades three things in code, after the
 * model has spoken: a `catalogEntryId` that is not in the catalog it was handed, a
 * `COMPANY_CATALOG` basis with no verified entry behind it, and a basis on a line
 * with no price. Those are deterministic, `anthropic.test.ts` covers them, and an
 * eval over them would be paying Opus to test an `if`. The quote reader's own eval
 * states the rule — "everything else about feature 5 is checkable for free and
 * already is".
 *
 * So every case below is about a JUDGEMENT no code downstream can check.
 *
 * ── THE FAILURE THIS EXISTS FOR ──
 *
 * A catalog id that is REAL but describes different work. The hallucination guard
 * cannot see it: the id resolves, the foreign key is valid, the badge reads
 * COMPANY_CATALOG — the strongest basis the UI can show — and the price is for
 * other work entirely. `draft-lines.ts` then copies that entry's unit price, cost,
 * labour hours and craft onto the line, so one wrong match writes five wrong
 * fields and shows maximum confidence while doing it.
 *
 * The system prompt names this case in as many words ("a catalog entry for 5/8"
 * type X board is not a match for acoustic ceiling tile"), which is the reason to
 * measure it rather than assume it: a rule stated in a prompt is a hope until
 * something scores it.
 *
 * `docs/ai/DECISIONS.md` sets the metric: "the metric I care most about is false
 * confidence, not accuracy". For this feature false confidence is exactly
 * `COMPANY_CATALOG` on a line that did not come from the catalog.
 */

/** A catalog entry as the drafter is handed it. */
export type CaseCatalogEntry = {
  id: string;
  description: string;
  unit: string | null;
  defaultUnitPrice: number | null;
  tradeScope: string | null;
};

export type DraftLineCase = {
  id: string;
  /** Printed beside the case in the report, and in the `it(...)` name. */
  why: string;
  scopeText: string;
  catalogEntries: CaseCatalogEntry[];
  wonBids: { projectName: string; tradeScope: string | null; bidAmount: number }[];
  /**
   * Catalog ids it is HONEST to claim `COMPANY_CATALOG` against on this scope.
   *
   * Empty means no entry in the list describes work this scope asks for, so any
   * `COMPANY_CATALOG` claim at all is an over-claim. This is the discriminator the
   * whole eval turns on, and it is a deliberate whitelist rather than a blacklist:
   * a new entry added to a case's catalog is not silently claimable.
   */
  claimableCatalogIds: string[];
  /** Lower bound on distinct lines, where the scope plainly contains more than one
   *  piece of work. A single catch-all line is a real estimating failure — it
   *  cannot be priced, scheduled or billed against. */
  minLines?: number;
  /** Work in this scope that this company does NOT self-perform. A line whose
   *  description matches one of these is pricing somebody else's scope, which on a
   *  real bid is money given away. Matched case-insensitively as a substring. */
  foreignScope?: string[];
  /** Every line that carries a basis must carry one of these. Omitted means any.
   *  Note what this CANNOT say on its own: a line with no price has no basis, so
   *  this constraint skips it. That is what `pricedExpected` is for. */
  allowedBases?: DraftPriceBasis[];
  /**
   * A price is genuinely available on this scope, so declining to price every
   * line is a silent refusal rather than honesty.
   *
   * ADDED AFTER THE FIRST RUN, WHICH IS THE WHOLE REASON IT EXISTS. That run was
   * green — 0 over-claimed, 0 invented — and its basis tally showed 11 of 19 lines
   * came back with NO PRICE, including all five lines of `no-catalog-no-history`,
   * a 5,500 sq ft EIFS scope that any estimator would expect a rough $/sq ft on.
   * The case asserted `allowedBases: ["GENERAL_KNOWLEDGE"]` and passed, because a
   * null basis skips that check: it asserted a basis and saw none.
   *
   * So a drafter that priced NOTHING, ever, would have scored perfectly. Absence
   * of a failure is not a pass — CLAUDE.md's rule, arriving inside the guard
   * written to apply it.
   *
   * Reported, never fatal. A missing price is the SAFE direction — the estimator
   * types one in, which is what they did before this feature existed — where a
   * confident wrong price reaches a bid. It is graded the way the plan-sheet eval
   * grades hedging: "useless, but useless in the safe direction, and the figure is
   * on screen so it can be argued about rather than assumed away."
   */
  pricedExpected?: boolean;
  /** True when nothing in the scope supports a price at all, so the honest answer
   *  is `unitPrice: null` on every line rather than an invented number. */
  expectNoPrice?: boolean;
};

const DRYWALL_CATALOG: CaseCatalogEntry[] = [
  {
    id: "cat_board_58_typex",
    description: '5/8" Type X gypsum board, hung and finished to Level 4',
    unit: "sq ft",
    defaultUnitPrice: 3.4,
    tradeScope: "FRAMING_DRYWALL",
  },
  {
    id: "cat_metal_stud_358",
    description: '3-5/8" 20ga metal stud partition framing, 16" o.c.',
    unit: "sq ft",
    defaultUnitPrice: 2.85,
    tradeScope: "FRAMING_DRYWALL",
  },
];

export const DRAFT_LINE_CASES: DraftLineCase[] = [
  {
    id: "catalog-true-match",
    why: 'the catalog holds exactly this work, so COMPANY_CATALOG is the honest basis',
    scopeText:
      'Interior partitions at level 2: install 3-5/8" 20ga metal stud framing at 16" on center, ' +
      'approximately 4,200 square feet of wall area, and hang and finish 5/8" Type X gypsum board ' +
      "both faces to a Level 4 finish.",
    catalogEntries: DRYWALL_CATALOG,
    wonBids: [],
    claimableCatalogIds: ["cat_board_58_typex", "cat_metal_stud_358"],
    minLines: 2,
    pricedExpected: true,
  },
  {
    id: "catalog-near-miss-ceiling",
    why:
      "THE CASE THIS EVAL EXISTS FOR — the catalog has drywall board and this scope is " +
      "acoustic ceiling tile, which the prompt names as the exact wrong match",
    scopeText:
      "Furnish and install suspended acoustical ceiling tile, 2x2 lay-in mineral fibre panels with " +
      "exposed tee grid, approximately 3,000 square feet at the ground floor open office.",
    catalogEntries: DRYWALL_CATALOG,
    wonBids: [],
    // Neither entry is ceiling work. A COMPANY_CATALOG claim here is the defect.
    claimableCatalogIds: [],
    // Resisting the wrong entry is the test. Pricing suspended ACT from general
    // market knowledge is still available, and declining both is a refusal.
    pricedExpected: true,
  },
  {
    id: "catalog-near-miss-unit",
    why: "same work family, different unit — a sq ft board price is not a lin ft trim price",
    scopeText:
      "Install metal corner bead and J-trim at all exposed drywall edges, approximately 900 linear " +
      "feet, at the level 3 corridor.",
    catalogEntries: DRYWALL_CATALOG,
    wonBids: [],
    claimableCatalogIds: [],
    pricedExpected: true,
  },
  {
    id: "other-trades-present",
    why: "a GC's scope paragraph mixes in work this sub does not self-perform",
    scopeText:
      "Scope for the tenant improvement: metal stud framing and drywall at the new demising walls " +
      "(about 1,800 sq ft); electrical rough-in and panel work; fire sprinkler head relocation; " +
      "storefront glazing at the entry; and painting of all new drywall surfaces.",
    catalogEntries: DRYWALL_CATALOG,
    wonBids: [],
    claimableCatalogIds: ["cat_board_58_typex", "cat_metal_stud_358"],
    // Painting is the interesting one: it is adjacent to drywall and routinely a
    // different sub, so it is the one a drafter is most likely to absorb.
    foreignScope: ["electrical", "sprinkler", "glazing", "storefront", "painting", "paint"],
    pricedExpected: true,
  },
  {
    id: "historical-bid-basis",
    why: "no catalog entry covers fireproofing, but won bids in that trade give a defensible basis",
    scopeText:
      "Spray-applied fireproofing to structural steel beams and columns at levels 1 through 3, " +
      "approximately 12,000 square feet of contact area, 2-hour rating.",
    catalogEntries: DRYWALL_CATALOG,
    wonBids: [
      { projectName: "Mercy Clinic Shell", tradeScope: "FIREPROOFING", bidAmount: 184000 },
      { projectName: "Harbor Point Tower", tradeScope: "FIREPROOFING", bidAmount: 262500 },
    ],
    claimableCatalogIds: [],
    allowedBases: ["HISTORICAL_BID", "GENERAL_KNOWLEDGE"],
    pricedExpected: true,
  },
  {
    id: "no-basis-for-a-price",
    why:
      "a scope with no quantity, no area and no comparable — the prompt says a missing price is " +
      "fine and an invented one is not",
    scopeText:
      "Perform miscellaneous patch and repair of existing plaster as directed by the architect in " +
      "the field. Extent to be determined after demolition.",
    catalogEntries: [],
    wonBids: [],
    claimableCatalogIds: [],
    expectNoPrice: true,
  },
  {
    id: "no-catalog-no-history",
    why: "nothing to ground a price in, so every line must say GENERAL_KNOWLEDGE and mean it",
    scopeText:
      "Install exterior EIFS cladding system with 2 inch EPS insulation board, base coat, mesh and " +
      "acrylic finish, approximately 5,500 square feet on the north and east elevations.",
    catalogEntries: [],
    wonBids: [],
    claimableCatalogIds: [],
    allowedBases: ["GENERAL_KNOWLEDGE"],
    // 5,500 sq ft of EIFS with a stated build-up. If anything in this list is
    // priceable from general market knowledge, it is this — which is why the
    // first run returning no price on all five lines is the finding rather than
    // a quirk.
    pricedExpected: true,
  },
];
