/**
 * SYNTHETIC SUBCONTRACTOR LISTINGS, AND WHAT EACH ONE IS FOR.
 *
 * ── THESE ARE INVENTED, AND THAT IS THE MOST IMPORTANT THING ON THIS PAGE ──
 *
 * No real bid tab or award packet was read while writing them. The egress proxy
 * in the container this was built in answers 403 on CONNECT for every general
 * web host, so the agencies' own forms could not be opened. Every column order,
 * every field name and every wrapping behaviour below is a GUESS at what such a
 * document looks like.
 *
 * So these cases prove the parser is SELF-CONSISTENT — every non-blank line
 * lands in exactly one of the four buckets. They do NOT prove it reads a real
 * document, and no number of them ever will. The next person to touch this
 * should paste one real listing in, read what `unread` AND `ignored` say, and
 * widen from that evidence — which is also why nothing here is written as an
 * exhaustive format specification: a fixture that claimed to be authoritative
 * would be the stale-documentation failure this repo keeps paying for, with a
 * test suite agreeing with it.
 *
 * ── THREE CORRECTIONS TO THIS FILE, 2026-10-04 ──
 *
 * This file has not been touched since the commit that created it (`afa1ad0`),
 * while `parse.ts` was rewritten twice underneath it (`302d050`, `3c037d9`).
 * `git diff afa1ad0 HEAD -- apps/web/lib/sub-listing/subListingCases.ts` was
 * empty, which is the evidence for calling the next two STALE rather than wrong.
 *
 * 1. **STALE.** The paragraph above said to paste a real listing and "read what
 *    `unread` says". That was true of the FIRST design, where `unread` was the
 *    only non-row bucket — `ignored` did not exist in `afa1ad0`'s parser at all
 *    (zero occurrences of the word). Every loss found on 2026-10-04 landed in
 *    `ignored` carrying a confident reason, with `unread` EMPTY, so the old
 *    sentence pointed the next person at the one list that will have nothing in
 *    it. Both buckets, or you are reading past the defect.
 *
 * 2. **FALSE, and the fixtures below are the refutation rather than an
 *    argument.** The same paragraph claimed these cases prove the parser "loses
 *    nothing silently". `single-space-columns` is three subcontractors lost —
 *    `rowsParsed: 0` — with `reconciliation.agreed` still reading `TRUE`,
 *    because `agreed` is `accountedFor === nonBlankLines && !unread && !problems`
 *    and does not look at `ignored`. The partition is what these cases prove.
 *    "Loses nothing" is the overclaim `parse.ts`'s own header spends two
 *    paragraphs warning about, arriving in the file that is supposed to check it.
 *
 * 3. **FALSE WHEN WRITTEN**, which is a third thing again — see the count below.
 *
 * Also deliberate, following `lib/quote-read/quoteFixtures.ts`: every company,
 * project and agency name is invented. Diego's rule for this work is that
 * customer documents never appear in fixtures, and a real award packet names
 * real subcontractors who did not agree to be test data.
 *
 * ── THE CASES ARE CHOSEN SO EACH FAILURE MEANS SOMETHING DIFFERENT ──
 *
 * Some are about reading what is there, most are about the shapes that would
 * make a parser lose a row quietly, and some are about the boundary of the
 * feature. A case whose failure would mean the same thing as another's is not
 * worth its maintenance.
 *
 * This sentence used to apportion the cases as "Two … four … two". That is
 * EIGHT, and `afa1ad0` — the commit that wrote the sentence — shipped NINE
 * cases, so it was FALSE on arrival rather than stale: no edit to the code ever
 * invalidated it. Replaced with no number at all, following the precedent
 * CLAUDE.md sets for the counter roll-call: a count of this kind rots faster
 * than the claim it decorates, so it goes rather than gets refreshed. The
 * `it.each` blocks in `parse.test.ts` count the cases, and they cannot drift.
 */

export type SubListingCase = {
  id: string;
  /** Printed on failure, so a red test reads as a cost rather than a diff. */
  why: string;
  text: string;
  /** How many rows a correct read returns. */
  expectRows: number;
  /**
   * How many lines land in `unread` — the bucket for a line that reached
   * `readRow` with two or more fields and in which NO field read as a company
   * name.
   *
   * **STALE until 2026-10-04**, when this read "lines that carry data and that
   * this parser is EXPECTED not to understand". That is the question the first
   * design's `looksLikeData` predicate asked, and in that design `unread` was
   * literally the candidates it admitted minus the rows that parsed. It no
   * longer describes the bucket in either direction: a line can carry plenty of
   * data and be `ignored` instead (`clean-five`'s "Total Base Bid: $18,450,000"
   * carries money and is furniture), and a line carrying no data at all is
   * `ignored` as prose rather than unread. Verified by running the corpus:
   * `unread` is EMPTY for all of these cases, including every one added on
   * 2026-10-04 to reproduce a loss.
   */
  expectUnread: number;
};

/**
 * The shape most of these are written in — wide columns separated by runs of
 * spaces, which is what a PDF table becomes when a person selects and copies
 * it. UNCONFIRMED against a real document, per the header.
 */
const CLEAN_FIVE = `
RIVERSIDE UNIFIED SCHOOL DISTRICT
DESIGNATION OF SUBCONTRACTORS

Project: Lincoln Elementary Modernization, Increment 2
Agency: Riverside Unified School District
Prime Contractor: Swinerton Builders
Bid Opening: March 14, 2026

Name of Subcontractor          City, State        Licence       DIR Reg.      Portion of Work
Valley Interior Systems        Fontana, CA        C-9 884201    1000012345    Metal stud framing & drywall
Pacific Lath & Plaster Inc.    Colton, CA         C-35 771903   1000098765    Lath and cement plaster
Summit Acoustics LLC           Riverside, CA      C-2 650118    1000044444    Acoustical ceilings
Western Fireproofing Co.       Ontario, CA        912004        1000077777    Spray-applied fireproofing
Delta Electric Corporation     Perris, CA         C-10 334455   1000011111    Electrical

Total Base Bid: $18,450,000
`;

/**
 * OREGON, AND IT IS THE ONLY SHAPE THAT CARRIES MONEY.
 *
 * ORS 279C.370's First-Tier Subcontractor Disclosure requires the **dollar
 * value of each subcontract**, where California's §4104 requires no amount at
 * all. Those are two statutes and two documents, and the handoff this work
 * started from had merged them into one sentence — "public bid tabs name subs
 * with dollar values" — which is false of California, false of a bid tab, and
 * true only of Oregon's disclosure form.
 *
 * Kept as its own case so the amount path is exercised by a document that
 * really has amounts, rather than by a Californian form with an invented column
 * on it. That mistake was in this file's first draft.
 */
const OREGON_WITH_AMOUNTS = `
Project: Hillsboro Public Safety Building
Agency: Oregon Department of Administrative Services
Prime Contractor: Fortis Construction
Bid Opening: January 22, 2026

First-Tier Subcontractor Disclosure
Subcontractor                  Category of Work                     Dollar Value
Cascade Interior Systems       Gypsum board and metal framing        $2,140,000
Willamette Acoustics Inc.      Acoustical ceilings                   $385,500
`;

/** Tabs rather than space runs — what a copy out of a spreadsheet gives. */
const TAB_DELIMITED = `
Project: Hayward Corporation Yard Replacement
Prime Contractor: Alten Construction

Subcontractor\tCity\tLicence\tWork\tAmount
Bayline Drywall Systems\tSan Leandro, CA\t901442\tGypsum board assemblies\t$744,300
Monterey Plastering\tSalinas, CA\t688217\tExterior cement plaster\t$301,900
`;

/** Pipe-delimited — what a listing pasted out of a web table can become. */
const PIPE_DELIMITED = `
Project: Mt. Diablo HS Science Wing
Agency: Mt. Diablo Unified School District
Prime Contractor: Rodan Builders

Firm | Location | Lic. | Scope | Value
Diablo Ceiling & Partition | Concord, CA | C-9 773310 | Acoustical ceilings and drywall | $512,000
Brightwall EIFS | Antioch, CA | C-35 820114 | EIFS and synthetic stucco | $186,400
`;

/** Percentages instead of dollars — permitted on some forms. */
const PERCENT_NOT_DOLLARS = `
Project: Sacramento Central Library Seismic Retrofit
Prime Contractor: Otto Construction

Subcontractor            City            Licence     Portion of Work               % of Bid
Capital Interiors        Sacramento, CA  C-9 540118  Metal framing and drywall     8.4 %
Delta Fireproofing       Elk Grove, CA   C-2 661200  Applied fireproofing          2.15 %
`;

/**
 * A row whose portion of work wrapped onto its own line. THE CASE THIS WHOLE
 * DESIGN EXISTS FOR: the continuation carries no name, so it cannot become a
 * row — and it must therefore be REPORTED rather than vanish, because a
 * vanished line is a sub nobody notices is missing.
 *
 * **STALE until 2026-10-04**, when this said the continuation "must therefore
 * appear in `unread`". It does not, and the fixture's own `expectUnread: 0`
 * contradicted the sentence above it the whole time. Line 7 goes to `ignored`
 * with `why: "read as the continuation of line 6"`, and line 6 gains a concern
 * naming it — which is a better outcome than `unread`, because the reason is
 * named and the row it belongs to is identified. The sentence was true of the
 * first design, where the only buckets were rows and `unread`; it survived the
 * rewrite that gave the parser four, and a reader checking the parser against
 * it would have "fixed" a working path.
 *
 * Read the shape before the content: this is the direction that stops people
 * looking, because it describes a CORRECT behaviour as a defect. The reverse of
 * it — a loss described as correct — is `single-space-columns` below.
 */
const WRAPPED_ROW = `
Project: Fresno Courthouse Interior Buildout
Prime Contractor: Harris Construction

Subcontractor           City           Licence      Portion of Work                     Amount
Sierra Wall Systems     Fresno, CA     C-9 448120   Metal stud framing, drywall and     $968,000
                                                   interior finish carpentry
Kings Acoustical        Hanford, CA    C-2 559031   Acoustical ceilings                 $142,600
`;

/** No header block at all — a bare table, which is what a partial copy gives. */
const NO_HEADER = `
Oakwood Interior Contractors    Modesto, CA     C-9 701188    Drywall and taping      $388,000
Turlock Plaster Works           Turlock, CA     C-35 612904   Lath and plaster        $205,500
`;

/**
 * A licence in a shape the patterns do not know (an alphabetic suffix) plus a
 * registration that is not ten digits. The row must still parse: the patterns
 * RECOGNISE, they never validate, and dropping a sub because an unverified
 * regex disliked their number is the silent loss this file is about.
 */
const ODD_LICENCE = `
Project: Chico Municipal Pool Enclosure
Prime Contractor: Slater Builders

Northstate Drywall      Chico, CA      LIC 44A-9921X    Drywall assemblies     $121,000
`;

/** Page furniture and a phone number — must not crash, must not become rows. */
const NOISE_ONLY = `
Page 3 of 7
Addendum No. 2 acknowledged
Questions: (916) 555-0134
`;

/**
 * ── THE SHAPES BELOW WERE ADDED 2026-10-04 TO RECORD WHAT THE PARSER DOES WITH
 *    THEM TODAY, AND THREE OF THEM RECORD A LOSS ──
 *
 * Every `expectRows` below is an OBSERVED value, not a desired one. Where the
 * observation is a defect the id and the `why` say so in those words, because a
 * fixture whose expectation silently encodes a bug is how a bug acquires a test
 * that defends it. A red test here after somebody fixes the parser is the
 * correct outcome: update the fixture and delete the "TODAY" from its `why`.
 *
 * None of these produce an `unread` line. That is the point of all three
 * losses — they are `ignored` with a confident reason, which is the bucket
 * `reconciliation.agreed` does not look at.
 */

/**
 * A TABLE WHOSE COLUMNS ARE SEPARATED BY SINGLE SPACES — WHAT A PDF OFTEN GIVES.
 *
 * `splitFields` splits on tabs, runs of TWO OR MORE spaces, or pipes. A PDF that
 * was laid out with single spaces, or a copy that collapsed the runs, therefore
 * arrives as ONE field per line: `fields.length < 2`, so the line is held back
 * as a "single" and — with no cut-off row above it to attribute it to — filed as
 * "one column only — a heading or prose, not a table row".
 *
 * Three subcontractors, every one of them in our trades, all three carrying a
 * licence and a scope, and `rowsParsed` is 0 while `agreed` is TRUE.
 *
 * **AND THE OBVIOUS FIX IS WRONG — measured, so that nobody spends the morning
 * on it.** Widening `splitFields` to `\t+|\s+|\s*\|\s*` was tried against a
 * copy of `parse.ts` on 2026-10-04 and it SHATTERS every multi-word company
 * name: ten assertions in `parseShapes.test.ts` went red and the names came back
 * as "Systems", "Inc.", "Total", "Add" and "Acme" — `readRow` takes a FIELD as
 * the name, so one space inside "Valley Interior Systems" is indistinguishable
 * from the gap before the city column. A single space cannot be a delimiter and
 * a name character at the same time, which means this shape is not a regex
 * widening at all: it needs column POSITIONS inferred from the block of lines,
 * or an explicit refusal that tells the person their paste lost its columns.
 * The refusal is the smaller change and is probably the right one — a named
 * `problem` would at least break `agreed`, which is the part that currently
 * lies.
 */
const SINGLE_SPACE_COLUMNS = `
Project: Lincoln Elementary Modernization
Prime Contractor: Swinerton Builders

Valley Interior Systems Fontana, CA 884201 Metal stud framing and drywall
Pacific Lath & Plaster Inc. Colton, CA 771903 Lath and cement plaster
Summit Acoustics LLC Riverside, CA 650118 Acoustical ceilings
`;

/**
 * THE SAME SHAPE, BUT NOW IT CORRUPTS THE ROW ABOVE IT AS WELL.
 *
 * The continuation branch attributes a one-field line to the row above when that
 * row looks cut off. A whole single-spaced subcontractor row following a
 * genuinely wrapped row satisfies exactly that test, so the second sub is filed
 * as "read as the continuation of line 1" and a concern is pushed onto the FIRST
 * sub saying this text "may be the rest of this row".
 *
 * Worse than the case above, which only loses rows. This one writes a false
 * statement onto a row that WILL be rendered into a claim and read to the man
 * who submitted it — the failure `parse.ts`'s header opens with.
 */
const SINGLE_SPACE_AFTER_WRAP = `
Sierra Wall Systems     Fresno, CA     C-9 448120   Metal stud framing, drywall and     $968,000
Kings Acoustical Hanford, CA 559031 Acoustical ceilings $142,600
`;

/**
 * A REAL COMPANY WHOSE NAME BEGINS WITH THE WORD "TOTAL", TWO FIELDS, CARRYING
 * MONEY — i.e. every condition of the totals test at once.
 *
 * `furnitureReason`'s totals test is `fields.length <= 2 && TOTALS_WORDS &&
 * MONEY`, and this line matches all three. It survives anyway, because
 * `hasDataEvidence` runs FIRST and "Inc." trips `ENTITY_MARKER`. Kept as a
 * regression pin on that ordering: swap those two tests and this sub disappears
 * into "a total … not a subcontractor".
 *
 * **The one name in this file that is not invented**, and deliberately so. The
 * file's rule is that customer documents never supply fixture data; this name is
 * not lifted from a document, it is the name of the defect — `parse.ts`'s header
 * cites "**Total Western, Inc.**, which is a real California contractor" as one
 * of the three losses that forced the rewrite. A reproduction is worth more
 * carrying the string the review actually used.
 */
const TOTAL_IN_A_COMPANY_NAME = `
Total Western, Inc.\t$450,000
`;

/**
 * THE SAME TRAP WITH THE RESCUE REMOVED — AND THIS ONE IS LOST.
 *
 * "Total Drywall" is an entirely plausible company and carries no entity marker,
 * no place with a state code, and no run of four or more digits ("$450,000" has
 * runs of three). So `hasDataEvidence` is false, nothing rescues it, and the
 * totals test eats a subcontractor.
 *
 * This is the narrow edge of the case above rather than a separate mechanism,
 * and it is kept because the two together say what the rescue does and does not
 * cover: the protection is "Inc.", not the parser understanding anything about
 * the word "Total".
 */
const TOTALS_WORD_EATS_A_COMPANY = `
Total Drywall\t$450,000
`;

/**
 * GENUINE BID FURNITURE, TWO FIELDS — correctly ignored, and the reason is worth
 * recording because the obvious guess about it is wrong.
 *
 * The suspicion this fixture was written to test was that the alternate's long
 * description plus an empty column would give it THREE fields and let it escape
 * the `fields.length <= 2` cap. It does not: `splitFields` separates on `\t+`,
 * so the two consecutive tabs collapse to one separator and the line is two
 * fields. REFUTED, by running it.
 */
const ADD_ALTERNATE_TWO_FIELDS = `
Add Alternate No. 1 — gypsum soffits at main entry\t\t$12,000
`;

/**
 * THE SAME ALTERNATE WITH ITS DESCRIPTION IN ITS OWN COLUMN — AND NOW IT IS A
 * LEAD IN OUR OWN TRADE.
 *
 * Three fields clears the `<= 2` cap, so the totals test never runs, `readRow`
 * finds "Add Alternate No. 1" acceptable as a company name (the bid-item
 * exclusion is anchored — `^(?:item|no|line|bid\s*item)\.?\s*\d+$` — and this
 * string starts with "Add"), and the scope "gypsum soffits at main entry"
 * matches METAL_FRAMING_DRYWALL.
 *
 * So the cap is wrong in both directions at once: it eats "Total Drywall" above,
 * and here it lets a line of bid furniture out as a prospect, with a trade, with
 * no concern raised. `importSubListing` writes that name into
 * `SalesLead.companyName`.
 */
const ADD_ALTERNATE_THREE_FIELDS = `
Add Alternate No. 1\tgypsum soffits at main entry\t$12,000
`;

/**
 * A QUANTITY WINNING THE LICENCE SLOT, AND TAKING THE SCOPE DOWN WITH IT.
 *
 * `LICENCE` accepts a bare 6–8 digit run with no label of any kind, so the
 * "148000" of a square-foot quantity becomes `licence: "148000"`. The floor is
 * six digits because five is a ZIP code — which is the same defect one digit
 * further along, already paid for once.
 *
 * The second half was not predicted and is worse: the field is ALSO excluded
 * from the portion-of-work slot, by the address-line test `^\d+\s+\S`. So the
 * row ends up with an invented licence, `portionOfWork: null` and
 * `tradeScope: null` — no concern raised. A sub in our own trade arrives
 * untradeable and carrying a licence number that belongs to nobody.
 */
const BARE_NUMBER_AS_LICENCE = `
Acme Drywall, Inc.\tFontana, CA\t148000 SF of gypsum board\t$450,000
`;

export const SUB_LISTING_CASES: SubListingCase[] = [
  {
    id: "clean-five",
    why: "the ordinary CALIFORNIA case — five subs, four of them ours, NO dollar column (§4104 has no amount field), and a total line that is not a sub",
    text: CLEAN_FIVE,
    expectRows: 5,
    expectUnread: 0,
  },
  {
    id: "oregon-with-amounts",
    why: "Oregon's ORS 279C.370 disclosure DOES carry a dollar value per subcontract — the only shape where an amount is real",
    text: OREGON_WITH_AMOUNTS,
    expectRows: 2,
    expectUnread: 0,
  },
  {
    id: "tab-delimited",
    why: "a listing copied out of a spreadsheet separates on tabs, not space runs",
    text: TAB_DELIMITED,
    expectRows: 2,
    expectUnread: 0,
  },
  {
    id: "pipe-delimited",
    why: "a listing copied out of a web table separates on pipes",
    text: PIPE_DELIMITED,
    expectRows: 2,
    expectUnread: 0,
  },
  {
    id: "percent-not-dollars",
    why: "some forms print a percentage of the bid instead of a dollar value",
    text: PERCENT_NOT_DOLLARS,
    expectRows: 2,
    expectUnread: 0,
  },
  {
    id: "wrapped-row",
    why: "a wrapped continuation line must be REPORTED, not dropped — the defect this design exists to prevent",
    text: WRAPPED_ROW,
    expectRows: 2,
    expectUnread: 0,
  },
  {
    id: "no-header",
    why: "a bare table still yields trade and geography, and must not invent a project",
    text: NO_HEADER,
    expectRows: 2,
    expectUnread: 0,
  },
  {
    id: "odd-licence",
    why: "an unrecognised licence format costs the FIELD, never the ROW",
    text: ODD_LICENCE,
    expectRows: 1,
    expectUnread: 0,
  },
  {
    id: "noise-only",
    why: "page furniture is not a subcontractor, and must not crash the parse",
    text: NOISE_ONLY,
    expectRows: 0,
    expectUnread: 0,
  },
  {
    id: "single-space-columns",
    why: "a single-space-separated table cannot be split into columns, so every row is REPORTED as unread rather than filed as prose. Until 2026-10-04 all three went to `ignored` as \"one column only\" with `agreed` still true, which refuted this file's old \"loses nothing silently\" claim; the rows are still not parsed, but nothing is lost quietly",
    text: SINGLE_SPACE_COLUMNS,
    expectRows: 0,
    expectUnread: 3,
  },
  {
    id: "single-space-after-wrap",
    why: "a single-space row following a cut-off row is reported, not swallowed. Until 2026-10-04 it was attributed as that row's continuation AND pushed a false concern onto it — a neighbour corrupted rather than merely a row lost, which is why the row test now outranks the continuation test",
    text: SINGLE_SPACE_AFTER_WRAP,
    expectRows: 1,
    expectUnread: 1,
  },
  {
    id: "total-in-a-company-name",
    why: "a company whose name contains \"Total\" survives the totals test because `hasDataEvidence` runs first and \"Inc.\" trips the entity marker — correct, and a pin on that ordering",
    text: TOTAL_IN_A_COMPANY_NAME,
    expectRows: 1,
    expectUnread: 0,
  },
  {
    id: "totals-word-eats-a-company",
    why: "TODAY the same name without an entity marker IS eaten as \"a total … not a subcontractor\" — the narrow edge of the case above, and a real loss",
    text: TOTALS_WORD_EATS_A_COMPANY,
    expectRows: 0,
    expectUnread: 0,
  },
  {
    id: "add-alternate-two-fields",
    why: "real bid furniture with two fields is correctly ignored — the consecutive tabs COLLAPSE, so it never reaches three fields",
    text: ADD_ALTERNATE_TWO_FIELDS,
    expectRows: 0,
    expectUnread: 0,
  },
  {
    id: "add-alternate-three-fields",
    why: "TODAY the same alternate with its description in its own column clears the `<= 2` cap and becomes a LEAD in our own trade — a real defect, and the opposite direction from `totals-word-eats-a-company`",
    text: ADD_ALTERNATE_THREE_FIELDS,
    expectRows: 1,
    expectUnread: 0,
  },
  {
    id: "bare-number-as-licence",
    why: "a bare square-foot quantity is no longer read as the licence — it is not a licence COLUMN, and the row says so in a concern. Until 2026-10-04 it became an invented licence number belonging to nobody. The field is STILL excluded from the scope slot by the address-line test, so the row has no portion of work and no trade and arrives default-unticked: an open defect, now flagged rather than silent",
    text: BARE_NUMBER_AS_LICENCE,
    expectRows: 1,
    expectUnread: 0,
  },
];

/**
 * The cases that may not be deleted, named rather than counted.
 *
 * A count would be satisfied by deleting the awkward one and adding an easy
 * one, which is how a suite gets easier over time without anybody deciding
 * that it should.
 */
export const LOAD_BEARING_CASES = [
  "clean-five",
  "wrapped-row",
  "odd-licence",
  "no-header",
] as const;
