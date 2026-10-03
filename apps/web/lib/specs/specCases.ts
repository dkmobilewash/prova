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
];
