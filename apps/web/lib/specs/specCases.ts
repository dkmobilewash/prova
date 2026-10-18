import type { SpecFindingKind } from "@prova/integrations/src/specs";

/**
 * SYNTHETIC SPEC SECTIONS — never a real one, and that is a standing rule rather
 * than caution: "never use real customer files in tests or fixtures", and a
 * project's specification is somebody's confidential bid document.
 *
 * Written as lines of text and rendered to a real PDF by `quotePdf`, the same
 * writer the quote and addendum fixtures use. `specCases.test.ts` reads every
 * one back with pdfjs, because a fixture nobody has opened is a measurement
 * about nothing.
 *
 * ── WHAT EACH CASE IS FOR ──
 *
 * The cases are chosen so a FAILURE on each one means something different. Two
 * are about finding what is there, two are about NOT finding what is not, and
 * two are about the boundary of the feature — a section for somebody else's
 * trade, and a document that is not a spec section at all. The last two matter
 * most: `addenda.ts` and `quotes.ts` both carry a rule about returning nothing
 * for a document of the wrong kind, and both of those rules exist because a
 * reader asked to find things will find things.
 */

export type SpecCase = {
  id: string;
  /** Why this case is here, printed in the report so a failure reads as a cost. */
  why: string;
  lines: string[];
  /**
   * Kinds a competent reading SHOULD surface. Not an exhaustive list of
   * findings: the eval scores whether these were found, never whether extra
   * ones were, because a section legitimately contains more than the case
   * author thought to list.
   */
  expectKinds: SpecFindingKind[];
  /**
   * Requirements the section NAMES and explicitly does NOT impose — the
   * invention trap. A finding matching one of these is FATAL, which is the
   * asymmetry `addenda.ts`'s own eval uses: inventing is unforgivable, missing
   * is reported.
   */
  forbidden?: string[];
  /** When set, no finding may exceed this confidence. */
  ceiling?: "LOW" | "MEDIUM";
  /** When true, a correct reading returns NOTHING. */
  expectEmpty?: boolean;
};

export const SPEC_CASES: SpecCase[] = [
  {
    id: "level-5-and-rating",
    why: "the two findings that cost the most on a drywall bid, stated plainly — a reader that misses these is not useful at all",
    expectKinds: ["FINISH_LEVEL", "FIRE_RATING"],
    lines: [
      "SECTION 09 21 16 - GYPSUM BOARD ASSEMBLIES",
      "",
      "PART 1 - GENERAL",
      "1.1 SUMMARY",
      "A. Section includes interior gypsum board partitions, soffits and bulkheads.",
      "",
      "PART 2 - PRODUCTS",
      "2.1 PANELS",
      "A. Gypsum board, Type X, 5/8 inch thick, conforming to ASTM C1396.",
      "",
      "PART 3 - EXECUTION",
      "3.1 FINISHING",
      "A. Provide Level 5 finish in accordance with GA-214 at all areas",
      "   scheduled as public, including lobbies and elevator vestibules.",
      "B. Provide Level 4 finish at all other exposed surfaces.",
      "",
      "3.2 RATED ASSEMBLIES",
      "A. Rated partitions shall comply with UL U465, 2-hour rating, including",
      "   head-of-wall deflection detail and listed firestopping at all",
      "   penetrations.",
    ],
  },
  {
    id: "buried-mock-up",
    why: "a mock-up on page two of a section whose first page is ordinary — the sentence an estimator misses at 11pm, which is the whole case for the feature",
    expectKinds: ["MOCK_UP"],
    lines: [
      "SECTION 09 22 16 - NON-STRUCTURAL METAL FRAMING",
      "",
      "PART 1 - GENERAL",
      "1.1 SUBMITTALS",
      "A. Product data for each type of framing member.",
      "B. Shop drawings for deflection details.",
      "",
      "1.2 QUALITY ASSURANCE",
      "A. Installer shall have five years' experience with work of this scope.",
      "B. MOCK-UP: Prior to fabrication, construct a field mock-up of one",
      "   typical partition, 8 feet long by full height, including framing,",
      "   board, finish and one door opening. Obtain Architect's written",
      "   acceptance before proceeding. Mock-up may not remain as part of",
      "   the Work and shall be demolished and removed.",
      "",
      "PART 2 - PRODUCTS",
      "2.1 FRAMING",
      "A. Studs: 20 gauge minimum, galvanized, depths as indicated.",
    ],
  },
  {
    id: "names-and-excludes",
    why: "THE INVENTION TRAP: the section names Level 5 and a mock-up only to say they are NOT required here. A finding for either is a reader adding money to a bid for work nobody asked for",
    expectKinds: ["FINISH_LEVEL"],
    forbidden: ["mock-up", "mock up", "level 5"],
    lines: [
      "SECTION 09 29 00 - GYPSUM BOARD",
      "",
      "PART 3 - EXECUTION",
      "3.1 FINISHING",
      "A. Provide Level 4 finish at all exposed surfaces. Level 5 finish is",
      "   NOT required under this Section and is specified separately in",
      "   Section 09 21 16 where it applies.",
      "B. No field mock-up is required for the work of this Section.",
      "C. Finish at concealed surfaces: Level 1.",
    ],
  },
  {
    id: "garbled-scan",
    why: "a page that scanned badly. A reader must hedge or decline rather than guess at a number it cannot read — confidence capped, and a HIGH here is the false-confidence failure",
    expectKinds: [],
    ceiling: "LOW",
    lines: [
      "SECTI0N 09 Zl l6 - GYP5UM B0ARD A55EMBLIE5",
      "",
      "PART 3 - EXECUTI0N",
      "3.l FINI5H1NG",
      "A. Pr0v1de Leve1 ? f1n15h 1n acc0rdance w1th GA-Z14 at a11 area5",
      "   5chedu1ed a5 ???11c, 1nc1ud1ng 10bb1e5 and e1evat0r ve5t1bu1e5.",
      "B. Rated part1t10n5 5ha11 c0mp1y w1th UL U??5, ?-h0ur rat1ng.",
    ],
  },
  {
    id: "another-trade",
    why: "a section for work this subcontractor does not do. Returning findings here is reporting somebody else's cost as yours, which is worse than returning nothing",
    expectKinds: [],
    expectEmpty: true,
    lines: [
      "SECTION 26 05 19 - LOW-VOLTAGE ELECTRICAL POWER CONDUCTORS",
      "",
      "PART 2 - PRODUCTS",
      "2.1 CONDUCTORS",
      "A. Copper conductors, 600 volt insulation, THHN/THWN-2.",
      "B. No aluminium conductors permitted. No substitutions.",
      "",
      "PART 3 - EXECUTION",
      "3.1 TESTING",
      "A. Provide third-party insulation resistance testing of all feeders.",
    ],
  },
  {
    id: "not-a-spec",
    why: "an invitation to bid, not a spec section. `addenda.ts` and `quotes.ts` both carry this rule because a reader asked to find things will find things",
    expectKinds: [],
    expectEmpty: true,
    lines: [
      "INVITATION TO BID",
      "",
      "Project: Riverside Medical Office Building",
      "Trade: Metal framing and drywall",
      "Bids due: 14 November 2026, 2:00 PM local time",
      "",
      "Bid bond of 10 percent of base bid required, AIA A310.",
      "Submit on the enclosed bid form. Addenda will be issued by email.",
    ],
  },
  // ── Division 00/01 contract conditions, added 2026-10-05 with the three
  // kinds. These cost money the way a schedule costs money, and they are
  // routinely missed for one structural reason: they are not in the drywall
  // section, so an estimator reading their own trade's spec never sees them.
  //
  // Each of the three is its own case rather than one section carrying all
  // three, for the reason this file's own header gives: a failure on each case
  // must mean something different. A combined case that found two of three
  // would score as a pass on the strength of the ones it found.
  {
    id: "liquidated-damages",
    why: "an LD clause with a per-day figure. The one finding on this list that is an EXPOSURE rather than a cost, so it is also the one most likely to be reported as a dollar amount it is not",
    expectKinds: ["LIQUIDATED_DAMAGES"],
    // The reader must not invent a total. It has not seen the schedule, so it
    // cannot know how many days late anything will be — and a finding reading
    // "$75,000 of liquidated damages" would be a number nobody can check.
    forbidden: ["75,000", "$75,000", "total liquidated damages"],
    lines: [
      "SECTION 01 10 00 - SUMMARY OF WORK",
      "",
      "PART 1 - GENERAL",
      "1.1 CONTRACT TIME",
      "A. Substantial Completion shall be achieved within 420 calendar days of the Notice to Proceed.",
      "",
      "1.2 LIQUIDATED DAMAGES",
      "A. The Contractor shall pay the Owner liquidated damages of $2,500.00 per calendar day",
      "   for each day Substantial Completion is achieved later than the date required above.",
      "B. Liquidated damages shall be assessed against each Subcontractor whose work is shown",
      "   to have caused or contributed to the delay, in proportion to its contribution.",
    ],
  },
  {
    id: "working-hours-occupied",
    why: "restricted hours in an occupied building — the constraint that changes the RATE every hour of the work is done at, which is why it is not a line item and cannot be added at the end",
    expectKinds: ["WORKING_HOURS"],
    lines: [
      "SECTION 01 14 00 - WORK RESTRICTIONS",
      "",
      "PART 1 - GENERAL",
      "1.1 OCCUPIED PREMISES",
      "A. The building will remain fully occupied for the duration of the Work.",
      "",
      "1.2 WORKING HOURS",
      "A. Work producing noise, dust or vibration shall be performed only between",
      "   7:00 PM and 5:00 AM, Monday through Friday.",
      "B. No work of any kind shall be performed on Saturdays, Sundays or Owner holidays",
      "   without seventy-two (72) hours written notice and the Owner's written consent.",
      "C. Corridors shall be returned to clear, broom-clean condition before 6:00 AM each day.",
    ],
  },
  {
    id: "prevailing-wage-and-apprentices",
    why: "a wage determination plus an apprenticeship ratio. The ratio is the half that gets missed: it constrains CREW COMPOSITION, not just the rate, so a bid priced at journeyman rates throughout can be both compliant on wages and wrong on cost",
    expectKinds: ["WAGE_REQUIREMENT"],
    lines: [
      "SECTION 00 73 46 - WAGE RATE REQUIREMENTS",
      "",
      "PART 1 - GENERAL",
      "1.1 PREVAILING WAGE",
      "A. This Project is subject to the State prevailing wage determination for the county",
      "   in which the Work is performed. The applicable determination is attached.",
      "B. Certified payroll reports shall be submitted weekly for every worker on site,",
      "   including those of every Subcontractor of any tier.",
      "",
      "1.2 APPRENTICESHIP",
      "A. Not less than one (1) apprentice shall be employed for every five (5) journeymen",
      "   in each apprenticeable craft.",
    ],
  },
  {
    id: "solicitation-with-terms",
    why: "THE BOUNDARY OF THE THREE KINDS ABOVE, and the case that fails if admitting Division 00/01 went too far. A solicitation that MENTIONS a completion date and a bond must still return nothing — those terms live in the contract documents it points at, and reading them here reports the same requirement twice from the weaker source",
    expectKinds: [],
    expectEmpty: true,
    lines: [
      "INSTRUCTIONS TO BIDDERS",
      "",
      "Project: Lakeshore Transit Center — Interior Fit-Out",
      "Bids due: 9 December 2026, 3:00 PM local time, at the address below.",
      "",
      "1. Bidders shall submit one original and two copies on the enclosed form.",
      "2. The Work is subject to liquidated damages and prevailing wage requirements",
      "   as set forth in the Contract Documents. Refer to Division 00 and Division 01.",
      "3. A bid bond of 5 percent is required. Performance and payment bonds will be required",
      "   of the successful bidder.",
      "4. Bidders shall visit the site before submitting. Contact the Construction Manager.",
    ],
  },
];
