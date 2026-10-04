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
 * So these cases prove the parser is self-consistent and that it loses nothing
 * silently. They do NOT prove it reads a real document, and no number of them
 * ever will. The next person to touch this should paste one real listing in,
 * read what `unread` says, and widen from that evidence — which is also why
 * nothing here is written as an exhaustive format specification: a fixture that
 * claimed to be authoritative would be the stale-documentation failure this
 * repo keeps paying for, with a test suite agreeing with it.
 *
 * Also deliberate, following `lib/quote-read/quoteFixtures.ts`: every company,
 * project and agency name is invented. Diego's rule for this work is that
 * customer documents never appear in fixtures, and a real award packet names
 * real subcontractors who did not agree to be test data.
 *
 * ── THE CASES ARE CHOSEN SO EACH FAILURE MEANS SOMETHING DIFFERENT ──
 *
 * Two are about reading what is there, four are about the shapes that would
 * make a parser lose a row quietly, and two are about the boundary of the
 * feature. A case whose failure would mean the same thing as another's is not
 * worth its maintenance.
 */

export type SubListingCase = {
  id: string;
  /** Printed on failure, so a red test reads as a cost rather than a diff. */
  why: string;
  text: string;
  /** How many rows a correct read returns. */
  expectRows: number;
  /** Lines that carry data and that this parser is EXPECTED not to understand. */
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
 * row — and it must therefore appear in `unread` rather than vanish, because a
 * vanished line is a sub nobody notices is missing.
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
