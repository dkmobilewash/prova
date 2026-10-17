import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * SYNTHETIC SUBCONTRACTS, WRITTEN AS REAL PDFs AT RUN TIME. Nothing here is a
 * real contract and nothing here is copied from one.
 *
 * The wording is written for this repo in the plain-language style of the
 * published industry forms (AIA A401, ConsensusDocs 750) — their STRUCTURE and
 * the kinds of clause they carry, never their text, which is copyrighted even
 * where a sample is free to view. Every page carries the synthetic marking at
 * its foot as a reference code (`Ref: ZZ SYNTHETIC …`), the form the spec and
 * quote fixtures settled on after a sentence-shaped marking corrupted their
 * measurement twice.
 *
 * MULTI-PAGE ON PURPOSE, which is why this is not `quotePdf`: the things this
 * feature has to get right — a page located by code, a clause that crosses a
 * page break, a scanned page listed as unread — do not exist on one page.
 *
 * ASCII only. pdf-lib's standard fonts cannot encode a curly quote, and the
 * citation check's typographic equivalence is tested on its own in
 * `citations.test.ts`.
 *
 * NEVER A REAL CLIENT CONTRACT. A real one is read from a path in the
 * environment (`REAL_SUBCONTRACT_PDF`) by the eval, outside the repo, and only
 * metadata is printed — `realPlan.eval.ts`'s rule.
 */

export const SYNTHETIC_MARK = "Ref: ZZ SYNTHETIC 0750";

/** One page = its lines; `null` = a page with NO text layer (a scan). */
export type FixturePage = string[] | null;

export async function contractPdf(pages: FixturePage[]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, index) => {
    const page = doc.addPage([612, 792]);
    if (lines === null) return; // a scanned page: nothing a reader can extract
    let y = 740;
    for (const line of lines) {
      page.drawText(line, { x: 54, y, size: 10, font });
      y -= 14;
    }
    page.drawText(`${SYNTHETIC_MARK} - page ${index + 1}`, { x: 54, y: 40, size: 8, font });
  });
  return Buffer.from(await doc.save());
}

/** A clause the eval expects to be found, and how it recognises the finding. */
export type PlantedClause = {
  name: string;
  category: string;
  /** A phrase the finding's quote must contain to count as this clause. */
  phrase: string;
  /** The page(s) code must locate the quote on. */
  pages: number[];
  /** The lowest severity that counts as finding it — pay-if-paid read as LOW is a miss. */
  atLeast: "HIGH" | "MEDIUM" | "LOW";
  /** A figure the finding must carry, read off the clause. */
  term?: { key: string; value: number };
};

export type SubcontractCase = {
  name: string;
  pages: FixturePage[];
  planted: PlantedClause[];
  /** The precision control: no finding on this case may be HIGH. */
  noHighFindings?: boolean;
  /** Pages that must be reported unread. */
  unread?: number[];
};

const HEADER = (title: string) => [title, "Project: ZZ Synthetic Medical Office Building, 100 Example Way", ""];

/**
 * THE PLANTED CASE: every clause the brief names, each where a contract would
 * put it, one of them deliberately across a page break.
 */
export const PLANTED_CASE: SubcontractCase = {
  name: "planted-gc-form",
  pages: [
    [
      ...HEADER("SUBCONTRACT AGREEMENT"),
      "This Subcontract is made between Example General Builders LLC (Contractor)",
      "and ZZ Synthetic Drywall Inc. (Subcontractor) for the Work described in Exhibit A.",
      "",
      "ARTICLE 1 THE WORK",
      "1.1 Subcontractor shall furnish all labor, material and equipment to perform the",
      "framing, drywall and acoustical ceiling work described in Exhibit A.",
      "1.2 Subcontractor shall furnish and install firestopping and fire caulking at all",
      "rated wall and ceiling assemblies, whether or not shown on the drawings.",
      "",
      "ARTICLE 2 CONTRACT SUM",
      "2.1 Contractor shall pay Subcontractor the Subcontract Sum of Four Hundred Twelve",
      "Thousand Dollars ($412,000.00), subject to additions and deductions by Change Order.",
    ],
    [
      "ARTICLE 3 PAYMENT",
      "3.1 Subcontractor shall submit monthly applications for payment on AIA G702 and G703",
      "forms no later than the 20th day of each month for Work completed through that date.",
      "3.2 Receipt of payment by Contractor from Owner for the Work is a condition precedent",
      "to any obligation of Contractor to pay Subcontractor, and Subcontractor assumes the",
      "risk of Owner nonpayment.",
      "3.3 Contractor shall retain ten percent (10%) of each progress payment. Retainage shall",
      "be released only after final completion of the entire Project and acceptance by Owner.",
      "",
      "ARTICLE 4 SCHEDULE",
      "4.1 Subcontractor shall perform the Work in accordance with the Project schedule as it",
      "may be revised by Contractor from time to time, and shall accelerate the Work at its own",
      "cost when directed by Contractor to maintain the schedule.",
    ],
    [
      "ARTICLE 5 LIQUIDATED DAMAGES",
      "5.1 If the Work is not substantially complete by the date required, Subcontractor shall",
      "pay liquidated damages of one thousand five hundred dollars ($1,500.00) per calendar day,",
      "together with any liquidated damages assessed by Owner against Contractor that are",
      "attributable in any part to Subcontractor.",
      "",
      "ARTICLE 6 INDEMNIFICATION",
      "6.1 To the fullest extent permitted by law, Subcontractor shall indemnify, defend and",
      "hold harmless Contractor and Owner from all claims, damages, losses and expenses arising",
      "out of or resulting from the performance of the Work, regardless of whether such claim",
    ],
    [
      "is caused in whole or in part by the negligence of Contractor.",
      "",
      "ARTICLE 7 NOTICE OF DELAY",
      "7.1 Subcontractor shall give Contractor written notice of any delay within forty-eight",
      "(48) hours after the start of the event causing the delay. Failure to give such notice",
      "shall constitute a waiver of any claim for an extension of time or additional cost.",
      "",
      "ARTICLE 8 NO DAMAGES FOR DELAY",
      "8.1 Subcontractor's sole remedy for any delay shall be an extension of time, and",
      "Subcontractor shall not be entitled to damages for delay of any kind.",
    ],
  ],
  planted: [
    { name: "pay-if-paid", category: "PAYMENT", phrase: "condition precedent", pages: [2], atLeast: "HIGH" },
    { name: "retainage-10", category: "RETAINAGE", phrase: "ten percent (10%)", pages: [2], atLeast: "MEDIUM", term: { key: "retainagePercent", value: 10 } },
    { name: "ld-1500", category: "LIQUIDATED_DAMAGES", phrase: "($1,500.00) per calendar day", pages: [3], atLeast: "HIGH", term: { key: "ldPerDay", value: 1500 } },
    { name: "broad-form-indemnity", category: "INDEMNITY", phrase: "regardless of whether such claim is caused", pages: [3, 4], atLeast: "HIGH" },
    { name: "48-hour-notice", category: "NOTICE", phrase: "within forty-eight", pages: [4], atLeast: "MEDIUM", term: { key: "noticeHours", value: 48 } },
    { name: "no-damages-for-delay", category: "DELAY_AND_SCHEDULE", phrase: "damages for delay", pages: [4], atLeast: "HIGH" },
    { name: "fire-caulking-scope", category: "SCOPE", phrase: "fire caulking", pages: [1], atLeast: "LOW" },
  ],
};

/** The insurance exhibit read beside the planted agreement. */
export const INSURANCE_EXHIBIT_CASE: SubcontractCase = {
  name: "insurance-exhibit",
  pages: [
    [
      ...HEADER("EXHIBIT C - INSURANCE REQUIREMENTS"),
      "C.1 Subcontractor shall maintain commercial general liability insurance with limits of",
      "not less than $1,000,000 per occurrence and $2,000,000 general aggregate.",
      "C.2 Contractor and Owner shall be named as additional insureds on a primary and",
      "non-contributory basis, including completed operations, and the policy shall include a",
      "waiver of subrogation in favor of Contractor and Owner.",
      "C.3 Completed operations coverage shall be maintained for ten (10) years after final",
      "completion of the Project.",
    ],
  ],
  planted: [
    { name: "gl-limits", category: "INSURANCE", phrase: "$1,000,000 per occurrence", pages: [1], atLeast: "LOW", term: { key: "limitPerOccurrence", value: 1000000 } },
    { name: "completed-ops-10", category: "INSURANCE", phrase: "ten (10) years", pages: [1], atLeast: "MEDIUM", term: { key: "completedOpsYears", value: 10 } },
  ],
};

/** THE PRECISION CONTROL: a sub-friendly agreement. Nothing on it is HIGH. */
export const CLEAN_CASE: SubcontractCase = {
  name: "clean-agreement",
  noHighFindings: true,
  pages: [
    [
      ...HEADER("SUBCONTRACT AGREEMENT"),
      "1.1 Subcontractor shall perform the drywall work described in Exhibit A for the",
      "Subcontract Sum of Two Hundred Thousand Dollars ($200,000.00).",
      "2.1 Contractor shall pay Subcontractor within seven (7) days after Contractor receives",
      "payment from Owner, and in any event no later than forty-five (45) days after",
      "Subcontractor's application for payment, whether or not Owner has paid.",
      "2.2 Contractor shall retain five percent (5%) of each progress payment, released within",
      "thirty (30) days after substantial completion of Subcontractor's Work.",
      "3.1 Subcontractor shall indemnify Contractor only to the extent claims are caused by",
      "the negligent acts or omissions of Subcontractor.",
      "4.1 Subcontractor shall give written notice of a delay within seven (7) days after",
      "Subcontractor knows of the event causing it.",
      "5.1 Contractor and Subcontractor waive claims against each other for consequential",
      "damages arising out of this Subcontract.",
    ],
  ],
  planted: [
    { name: "contract-sum", category: "SCOPE", phrase: "Two Hundred Thousand Dollars ($200,000.00)", pages: [1], atLeast: "LOW", term: { key: "contractSum", value: 200000 } },
    { name: "seven-day-notice", category: "NOTICE", phrase: "seven (7) days after", pages: [1], atLeast: "LOW" },
  ],
};

/** Version 2 of the planted case: retainage cut to 5%, LDs gone. */
export const PLANTED_V2_CASE: SubcontractCase = {
  name: "planted-gc-form-v2",
  pages: PLANTED_CASE.pages.map((page, index) => {
    if (page === null) return null;
    if (index === 1) {
      return page.map((line) =>
        line
          .replace("ten percent (10%)", "five percent (5%)")
          .replace("be released only after final completion of the entire Project and acceptance by Owner.", "be released within thirty (30) days after substantial completion of the Work."),
      );
    }
    if (index === 2) {
      return [
        "ARTICLE 5 [INTENTIONALLY OMITTED]",
        "",
        ...page.slice(page.indexOf("ARTICLE 6 INDEMNIFICATION")),
      ];
    }
    return page;
  }),
  planted: PLANTED_CASE.planted.filter((clause) => clause.name !== "ld-1500" && clause.name !== "retainage-10"),
};

/** A scanned page in the middle: listed unread, never cited, never charged. */
export const SCANNED_PAGE_CASE: SubcontractCase = {
  name: "scanned-middle-page",
  unread: [2],
  pages: [PLANTED_CASE.pages[0]!, null, PLANTED_CASE.pages[3]!],
  planted: PLANTED_CASE.planted.filter((clause) => clause.pages.every((page) => page === 1 || page === 4)).map((clause) => ({
    ...clause,
    pages: clause.pages.map((page) => (page === 4 ? 3 : page)),
  })),
};

export const SUBCONTRACT_CASES: SubcontractCase[] = [
  PLANTED_CASE,
  INSURANCE_EXHIBIT_CASE,
  CLEAN_CASE,
  PLANTED_V2_CASE,
  SCANNED_PAGE_CASE,
];
