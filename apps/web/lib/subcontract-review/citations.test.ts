import { describe, expect, it } from "vitest";
import type { SubcontractFindingExtraction, SubcontractTerms } from "@prova/integrations/src/subcontractReview";
import {
  figuresStatedIn,
  joinLineEndHyphens,
  locateQuote,
  numbersInText,
  validateFindings,
  verifiedSectionRef,
  type ChunkPage,
} from "./citations";

const NO_TERMS: SubcontractTerms = {
  ldPerDay: null, ldCap: null, noticeHours: null, noticeDays: null, retainagePercent: null, paymentDays: null,
  warrantyYears: null, warrantyMonths: null, limitPerOccurrence: null, limitAggregate: null, completedOpsYears: null,
  contractSum: null, noticeRecipient: null, noticeForm: null,
};

const pages: ChunkPage[] = [
  { page: 3, lines: ["ARTICLE 6 PAYMENT", "6.2 Receipt of payment by Contractor from Owner is a condition", "precedent to any payment to Subcontractor."] },
  { page: 4, lines: ["7.1 Subcontractor shall pay liquidated damages of one thousand five", "hundred dollars ($1,500.00) per calendar day. Subcontractor shall indem-"] },
  { page: 5, lines: ["nify, defend and hold harmless Contractor from all claims.", "Notice of delay shall be given within forty-eight (48) hours."] },
];

const finding = (over: Partial<SubcontractFindingExtraction>): SubcontractFindingExtraction => ({
  ordinal: 1, category: "PAYMENT", subtype: null, severity: "HIGH", title: "Pay-if-paid", quote: "",
  claimedPage: null, sectionRef: null, explanation: "You are paid only if the owner pays.",
  suggestedPosition: "Ask for pay-when-paid.", questionForGc: null, terms: NO_TERMS, ...over,
});

describe("locateQuote — the page is found by code, never taken from the model", () => {
  it("finds a quote that wraps lines, with typographic punctuation the page did not use", () => {
    const located = locateQuote("Receipt of payment by Contractor from Owner is a condition precedent to any payment to Subcontractor.", pages);
    expect(located).toEqual({ ok: true, location: { pageStart: 3, pageEnd: 3 } });
  });

  it("finds a quote across a page break and reports both pages", () => {
    const located = locateQuote("Subcontractor shall indemnify, defend and hold harmless Contractor from all claims.", pages);
    expect(located).toEqual({ ok: true, location: { pageStart: 4, pageEnd: 5 } });
  });

  it("rejects a paraphrase, a fabrication and a fragment", () => {
    expect(locateQuote("Subcontractor is paid only when the Owner pays the Contractor.", pages)).toEqual({ ok: false, reason: "not-in-document" });
    expect(locateQuote("Subcontractor shall pay liquidated damages of $2,500.00 per calendar day.", pages)).toEqual({ ok: false, reason: "not-in-document" });
    expect(locateQuote("ARTICLE 6", pages)).toEqual({ ok: false, reason: "too-short" });
  });

  it("does not stitch a quote together from two pages that are not adjacent in the chunk", () => {
    expect(
      locateQuote("precedent to any payment to Subcontractor. Notice of delay shall be given", pages),
    ).toEqual({ ok: false, reason: "not-in-document" });
  });
});

describe("joinLineEndHyphens", () => {
  it("joins a word broken at a line end and leaves a real hyphen alone", () => {
    expect(joinLineEndHyphens(["shall indem-", "nify the"])).toEqual(["shall indemnify the"]);
    expect(joinLineEndHyphens(["a forty-", "Eight"])).toEqual(["a forty-", "Eight"]);
  });
});

describe("verifiedSectionRef", () => {
  it("keeps a section reference printed on the located page and drops one that is not", () => {
    expect(verifiedSectionRef("6.2", { pageStart: 3, pageEnd: 3 }, pages)).toBe("6.2");
    expect(verifiedSectionRef("Article 12", { pageStart: 3, pageEnd: 3 }, pages)).toBeNull();
    // Printed, but on another page than the quote.
    expect(verifiedSectionRef("7.1", { pageStart: 3, pageEnd: 3 }, pages)).toBeNull();
  });
});

describe("figures — kept only when the quote states them", () => {
  it("reads numbers the way a contract writes them", () => {
    expect([...numbersInText("($1,500.00) per day, forty-eight (48) hours, 10% and 1,000,000")]).toEqual([1500, 48, 10, 1000000]);
  });

  it("nulls a figure the model computed, converted or invented, and keeps the stated ones", () => {
    const quote = "a warranty of two (2) years and liquidated damages of $1,500.00 per day";
    const kept = figuresStatedIn({ ...NO_TERMS, warrantyYears: 2, warrantyMonths: 24, ldPerDay: 1500, ldCap: 50000 }, quote);
    expect(kept.warrantyYears).toBe(2);
    expect(kept.warrantyMonths).toBeNull();
    expect(kept.ldPerDay).toBe(1500);
    expect(kept.ldCap).toBeNull();
  });
});

describe("validateFindings", () => {
  it("keeps a cited finding with its computed location and drops an uncited one with the reason", () => {
    const { kept, dropped } = validateFindings(
      [
        finding({ quote: "Receipt of payment by Contractor from Owner is a condition precedent", claimedPage: 9, sectionRef: "6.2" }),
        finding({ quote: "Subcontractor waives all claims for delay of any kind." }),
        finding({ quote: "Notice of delay shall be given within forty-eight (48) hours.", title: "" }),
      ],
      pages,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.location).toEqual({ pageStart: 3, pageEnd: 3 });
    expect(kept[0]!.sectionRef).toBe("6.2");
    expect(dropped.map((entry) => entry.reason)).toEqual(["not-in-document", "not-in-document"]);
  });
});

describe("running headers and footers at a page break", () => {
  const withFurniture: ChunkPage[] = [
    { page: 7, lines: ["ZZ Builders Subcontract Form", "6.1 Subcontractor shall indemnify Contractor from all claims, regardless of whether such claim", "Page 7 of 12"] },
    { page: 8, lines: ["ZZ Builders Subcontract Form", "is caused in whole or in part by the negligence of Contractor.", "7.1 Notices shall be in writing.", "Page 8 of 12"] },
  ];

  it("finds a clause that crosses the break once the footer and the repeated header are set aside", () => {
    expect(
      locateQuote("regardless of whether such claim is caused in whole or in part by the negligence of Contractor.", withFurniture),
    ).toEqual({ ok: true, location: { pageStart: 7, pageEnd: 8 } });
  });

  it("never removes a body line, so a quote that skips real text still fails", () => {
    const body: ChunkPage[] = [
      { page: 1, lines: ["Subcontractor shall indemnify Contractor", "only to the extent of its own negligence,", "Page 1"] },
      { page: 2, lines: ["and shall defend Contractor in any suit."] },
    ];
    // "only to the extent…" is a body line at the edge; it must not be treated as furniture.
    expect(locateQuote("Subcontractor shall indemnify Contractor and shall defend Contractor in any suit.", body)).toEqual({
      ok: false,
      reason: "not-in-document",
    });
  });
});
