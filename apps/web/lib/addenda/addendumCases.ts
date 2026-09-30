import type { AddendumReferenceKind } from "@/lib/addenda-overlap";

/**
 * Synthetic addenda, and what each one is FOR.
 *
 * WHY SYNTHETIC. Diego's rule for this work is explicit — customer plan sets,
 * specs and quotes are confidential, and *"never use real customer files in tests
 * or fixtures."* A GC's addendum is somebody else's bid document; it is exactly
 * the thing that must not end up in a repository. So every case here is invented,
 * written as a real PDF at run time rather than committed, and a reader can see
 * what each one says by reading it.
 *
 * It makes the eval better rather than worse. A real addendum gives one sample of
 * one GC's house style; a generator gives the AWKWARD cases on purpose — a
 * cross-reference that must not become an item, a letter that changes nothing, a
 * document that is not an addendum at all. Those are where "never invent an item"
 * either holds or does not, and they are hard to find in a folder of real ones.
 *
 * ── THE SHAPE OF THE SCORING, WHICH IS NOT SYMMETRIC ──
 *
 * `expected` is what must be FOUND, and a miss is reported without being fatal:
 * an addendum item this reader did not list is a person reading the letter
 * themselves, which is what they do today.
 *
 * `absent` is what must NOT be found, and one of those IS fatal. Every entry is a
 * reference the document MENTIONS but does not change — a cross-reference, a
 * section named only as context. Inventing an item for one sends an estimator to
 * re-check something nothing touched, and it is the failure this eval exists to
 * measure. `docs/ai/DECISIONS.md` says the metric is false confidence rather than
 * accuracy, and `absent` is where false confidence actually shows up.
 *
 * `ceiling` caps how sure the reader is allowed to be. On a garbled document, LOW
 * is the CORRECT answer and anything above it is the defect — so a case with a
 * ceiling scores honesty rather than recall.
 *
 * ── `mustSend`, AND WHY IT EXISTS ──
 *
 * The plan-sheet eval shipped with its single most important case measuring
 * NOTHING: the trap sat where the region filter removed it, so the model was
 * never shown the thing it was being scored on, and the case passed for the wrong
 * reason. That cannot happen the same way here — the whole document is sent — but
 * a typo in a line below would do it silently. `addendumCases.test.ts` renders
 * every fixture, reads it back with pdfjs, and fails if a `mustSend` string is not
 * in the text. **That test is free and runs in CI, so the eval never measures a
 * model against a document nobody checked.**
 */

export type AddendumCase = {
  id: string;
  /** What this case is for, in one line. Printed in the report. */
  why: string;
  /** The document, line by line, before the synthetic footer is appended. */
  lines: string[];
  /** References the reader must list, with the kind each should carry. */
  expected: { reference: string; kind: AddendumReferenceKind }[];
  /** References the document MENTIONS but does not change. Listing one is the
   *  fatal failure this eval is built around.
   *
   *  EVERY ENTRY MUST BE IN THE DOCUMENT, and `addendumCases.test.ts` enforces
   *  that: a trap the model is never shown cannot be fallen into, and a case
   *  carrying one would pass while measuring nothing. */
  absent?: string[];
  /** Item LABELS the reader must not produce — the opposite kind of trap, and it
   *  needs its own field for exactly that reason. `absent` is a reference the
   *  document names and does not change; this is a label the document never
   *  contains at all, such as the item number a GC skipped. The fixture test
   *  asserts these are NOT in the document, which is the inverse check. */
  forbiddenLabels?: string[];
  /** The highest confidence any item may carry. Absent means no cap. */
  ceiling?: "LOW" | "MEDIUM";
  /** The dates, exactly as printed. `null` means the document does not say. */
  issueDateText?: string | null;
  bidDateText?: string | null;
  /** Strings that must survive into the rendered PDF, or the case measures
   *  nothing. Checked for free by `addendumCases.test.ts`. */
  mustSend: string[];
};

export const ADDENDUM_CASES: AddendumCase[] = [
  {
    id: "plain",
    why: "The baseline: four plainly-stated changes, each pointing somewhere different.",
    lines: [
      "ADDENDUM NO. 2",
      "Project: Westbrook Medical Office Building",
      "Date Issued: 14 October 2026",
      "",
      "This Addendum forms part of the Contract Documents and modifies the",
      "original Bidding Documents dated 28 September 2026.",
      "",
      "Item 1. Specification Section 09 21 16 - Gypsum Board Assemblies.",
      "  Paragraph 2.3 is deleted in its entirety and replaced with the attached.",
      "",
      "Item 2. Drawing Sheet A-201 is reissued. The ceiling grid at the north",
      "  stair has been revised.",
      "",
      "Item 3. The Partition Type Schedule is amended: Type P4 now requires",
      "  5/8 inch Type X board both faces.",
      "",
      "Item 4. Bidders shall include the attached Subcontractor List form with",
      "  the bid. Bids received without it will be considered non-responsive.",
    ],
    expected: [
      { reference: "09 21 16", kind: "SPEC_SECTION" },
      { reference: "A-201", kind: "DRAWING" },
      { reference: "Partition Type Schedule", kind: "SCHEDULE" },
      { reference: "Subcontractor List", kind: "REQUIREMENT" },
    ],
    issueDateText: "14 October 2026",
    bidDateText: null,
    mustSend: ["09 21 16", "A-201", "Partition Type Schedule", "Subcontractor List"],
  },

  {
    id: "cross-reference",
    why:
      "THE CASE THIS EVAL EXISTS FOR. Three sections are named as CONTEXT and one is " +
      "changed. Listing a mentioned-but-unchanged section sends somebody to re-check " +
      "work nothing touched.",
    lines: [
      "ADDENDUM NO. 4",
      "Project: Harbor Point Phase II",
      "Date Issued: 2026-10-21",
      "",
      "Item 1. Specification Section 09 51 13 - Acoustical Panel Ceilings.",
      "  Paragraph 2.2.A is revised to require a 24 x 24 tegular edge tile.",
      "  Coordinate with Section 23 31 13 for duct penetrations and with",
      "  Section 26 51 00 for lighting. No change is made to either section.",
      "  See also Sheet A-501 for the typical detail, which is unchanged.",
    ],
    expected: [{ reference: "09 51 13", kind: "SPEC_SECTION" }],
    // Each of these is named in the letter and explicitly NOT changed by it.
    absent: ["23 31 13", "26 51 00", "A-501"],
    issueDateText: "2026-10-21",
    bidDateText: null,
    mustSend: ["09 51 13", "23 31 13", "26 51 00", "A-501", "No change is made to either section"],
  },

  {
    id: "bid-date-moved",
    why: "A moved bid date must be captured AS PRINTED and classified as bid process, not scope.",
    lines: [
      "ADDENDUM NO. 1",
      "Project: Riverside Elementary Modernization",
      "Date Issued: October 3, 2026",
      "",
      "Item 1. The bid due date is extended from October 9, 2026 to",
      "  October 16, 2026 at 2:00 PM local time. All other requirements of the",
      "  Invitation to Bid are unchanged.",
      "",
      "Item 2. The pre-bid meeting minutes are attached for information only.",
    ],
    expected: [{ reference: "bid due date", kind: "BID_PROCESS" }],
    issueDateText: "October 3, 2026",
    // AS PRINTED, and the eval corrected me on what that means. This expected
    // "October 16, 2026"; the reader returned "October 16, 2026 at 2:00 PM local
    // time", which is what the document actually says — and on a bid the TIME is
    // not decoration, it is the difference between a bid being accepted and
    // handed back. The reader was more faithful to the rule than the case was.
    //
    // A reader that returned "2026-10-16" WOULD be wrong: that is a conversion,
    // and `bid-addenda.prisma` keeps these as text precisely so nothing converts.
    bidDateText: "October 16, 2026 at 2:00 PM local time",
    mustSend: ["October 16, 2026", "October 9, 2026", "pre-bid meeting minutes"],
  },

  {
    id: "changes-nothing",
    why:
      "A purely administrative letter. An addendum that changes no scope is common and " +
      "an empty or near-empty list is the CORRECT answer — inventing scope to look " +
      "useful is the failure.",
    lines: [
      "ADDENDUM NO. 3",
      "Project: Fairmount Logistics Center",
      "Date Issued: 11 October 2026",
      "",
      "Item 1. Attached for the record are the sign-in sheets from the pre-bid",
      "  walkthrough held on 6 October 2026.",
      "",
      "Item 2. Bidders are reminded that questions close five days before bid",
      "  date, as already stated in the Instructions to Bidders.",
      "",
      "No changes to the drawings or specifications are made by this Addendum.",
    ],
    expected: [],
    // The spec and drawings are named only to say they are NOT changed.
    absent: ["drawings", "specifications"],
    issueDateText: "11 October 2026",
    bidDateText: null,
    mustSend: ["No changes to the drawings or specifications are made"],
  },

  {
    id: "not-an-addendum",
    why:
      "A specification page, not an addendum. Prompt rule 12: return an empty list and " +
      "say what it appears to be. The plan-sheet eval's equivalent case is what proved " +
      "that reader would not invent a sheet number out of a spec page.",
    lines: [
      "SECTION 09 22 16",
      "NON-STRUCTURAL METAL FRAMING",
      "",
      "PART 1 - GENERAL",
      "1.1 SUMMARY",
      "  A. Section includes non-load-bearing steel framing members for",
      "     interior gypsum board assemblies.",
      "1.2 SUBMITTALS",
      "  A. Product Data: For each type of product indicated.",
      "",
      "PART 2 - PRODUCTS",
      "2.1 FRAMING",
      "  A. Studs: ASTM C645, 3-5/8 inch, 25 gauge minimum.",
    ],
    expected: [],
    // The section number is the page's own heading, not something an addendum changed.
    absent: ["09 22 16"],
    issueDateText: null,
    bidDateText: null,
    mustSend: ["SECTION 09 22 16", "PART 1 - GENERAL"],
  },

  {
    id: "odd-numbering",
    why:
      "Items numbered 1, 2a, 2b, 4 — the GC skipped 3. A reader that renumbers or " +
      "invents a missing item 3 has corrected somebody else's letterhead.",
    lines: [
      "ADDENDUM NO. 5",
      "Project: Northgate Transit Center",
      "Date Issued: 28 October 2026",
      "",
      "Item 1. Sheet A-301 is reissued with revised soffit dimensions at grid C.",
      "",
      "Item 2a. Section 07 24 00 - EIFS. Add the attached mock-up requirement.",
      "",
      "Item 2b. Section 07 24 00 - EIFS. Delete paragraph 3.4.B.",
      "",
      "Item 4. The Finish Schedule is revised for rooms 210 through 214.",
    ],
    expected: [
      { reference: "A-301", kind: "DRAWING" },
      { reference: "07 24 00", kind: "SPEC_SECTION" },
      { reference: "Finish Schedule", kind: "SCHEDULE" },
    ],
    // There is no item 3 — the GC went 2b to 4. Reporting one would be inventing
    // a change outright, and it is a LABEL rather than a reference, so it is
    // scored separately: `absent` entries must appear in the document and this
    // one must not.
    forbiddenLabels: ["Item 3", "Item 3."],
    issueDateText: "28 October 2026",
    bidDateText: null,
    mustSend: ["Item 2a", "Item 2b", "Item 4", "A-301", "07 24 00"],
  },

  {
    id: "garbled",
    why:
      "A poor scan. LOW confidence is the CORRECT answer and anything above it is the " +
      "defect — this case scores honesty, not recall.",
    lines: [
      "ADDEN UM NO. ?",
      "Pro ect: Millbrook Ann x",
      "Date Iss ed: ///////",
      "",
      "Ite  1. Sect on 09 2? 16 - Gyp um Bo rd Ass mbl es.",
      "  Par graph 2.? is rev sed to req ire ///// inch bo rd at",
      "  //////// loc tions sho n on the att ched.",
      "",
      "Ite  2. Sh et A-2?1 /////// rev sed.",
    ],
    // Nothing is REQUIRED to be found: the document does not legibly say any of
    // it. What is scored is that nothing is claimed confidently.
    expected: [],
    ceiling: "LOW",
    issueDateText: null,
    bidDateText: null,
    mustSend: ["ADDEN UM NO. ?", "Sect on 09 2? 16"],
  },
];
