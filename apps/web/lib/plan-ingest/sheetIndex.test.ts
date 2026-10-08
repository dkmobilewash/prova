import { describe, expect, it } from "vitest";
import {
  countSheets,
  duplicateSheetNumbers,
  effectiveSheetNumber,
  reviewRank,
  pageRanges,
  sheetIndexSentence,
  sortForReview,
  splitForReview,
  type SheetRow,
} from "./sheetIndex";

function row(over: Partial<SheetRow> & { pageNumber: number }): SheetRow {
  const { proposal, ...rest } = over;
  return {
    hasTextLayer: true,
    proposal:
      proposal === undefined
        ? {
            id: `p${over.pageNumber}`,
            sheetNumber: `A-${100 + over.pageNumber}`,
            title: "PLAN",
            discipline: "ARCHITECTURAL",
            pageType: "PLAN",
            scale: null,
            revision: null,
            issueDate: null,
            reason: "Read from the title block.",
            confidence: "HIGH",
            status: "PROPOSED",
            acceptedSheetNumber: null,
            acceptedTitle: null,
          }
        : proposal,
    ...rest,
  };
}

describe("the review order", () => {
  it("puts what needs typing first, then what the reader was least sure about", () => {
    const rows = [
      row({ pageNumber: 1 }),
      row({ pageNumber: 2, proposal: { ...row({ pageNumber: 2 }).proposal!, confidence: "LOW" } }),
      row({ pageNumber: 3, hasTextLayer: false, proposal: null }),
      row({ pageNumber: 4, proposal: { ...row({ pageNumber: 4 }).proposal!, confidence: "MEDIUM" } }),
    ];
    expect(sortForReview(rows).map((r) => r.pageNumber)).toEqual([3, 2, 4, 1]);
  });

  it("sinks what somebody has already settled", () => {
    const rows = [
      row({ pageNumber: 1, proposal: { ...row({ pageNumber: 1 }).proposal!, status: "ACCEPTED" } }),
      row({ pageNumber: 2 }),
      row({ pageNumber: 3, proposal: { ...row({ pageNumber: 3 }).proposal!, status: "REJECTED" } }),
    ];
    expect(sortForReview(rows).map((r) => r.pageNumber)).toEqual([2, 1, 3]);
  });

  it("is a TOTAL order, so a row cannot move under the cursor", () => {
    // Two rows of identical rank must still have a fixed order — the reason
    // `review.ts` tie-breaks on a filename. Without it a re-render after one
    // confirm can shift somebody's next click onto a different sheet.
    const rows = [row({ pageNumber: 9 }), row({ pageNumber: 4 }), row({ pageNumber: 7 })];
    expect(rows.every((r) => reviewRank(r) === reviewRank(rows[0]!))).toBe(true);
    expect(sortForReview(rows).map((r) => r.pageNumber)).toEqual([4, 7, 9]);
    // And sorting does not mutate its input, so a server component can hand the
    // same array to two things.
    expect(rows.map((r) => r.pageNumber)).toEqual([9, 4, 7]);
  });
});

describe("what a sheet number IS on screen", () => {
  it("prefers what a person accepted over what was proposed", () => {
    const proposed = row({ pageNumber: 1 }).proposal!;
    expect(
      effectiveSheetNumber(
        row({ pageNumber: 1, proposal: { ...proposed, sheetNumber: "A-1O1", acceptedSheetNumber: "A-101" } }),
      ),
    ).toBe("A-101");
  });

  it("is null for a page with nothing read, rather than an empty string", () => {
    expect(effectiveSheetNumber(row({ pageNumber: 1, hasTextLayer: false, proposal: null }))).toBeNull();
  });
});

describe("duplicate sheet numbers", () => {
  it("finds two pages claiming the same sheet", () => {
    const rows = [row({ pageNumber: 1 }), row({ pageNumber: 2 })];
    expect(duplicateSheetNumbers(rows)).toEqual([]);

    const clash = [
      row({ pageNumber: 1 }),
      row({ pageNumber: 2, proposal: { ...row({ pageNumber: 2 }).proposal!, sheetNumber: "A-101" } }),
    ];
    expect(duplicateSheetNumbers(clash)).toEqual(["A-101"]);
  });

  it("treats case and stray whitespace as the same sheet", () => {
    // "A-101" and "a-101 " are the same sheet to everyone except a string
    // comparison, and a duplicate warning that missed one would be worse than
    // none — it would read as confirmation that there is no clash.
    const rows = [
      row({ pageNumber: 1, proposal: { ...row({ pageNumber: 1 }).proposal!, sheetNumber: "A-101" } }),
      row({ pageNumber: 2, proposal: { ...row({ pageNumber: 2 }).proposal!, sheetNumber: " a-101 " } }),
    ];
    expect(duplicateSheetNumbers(rows)).toHaveLength(1);
  });

  it("counts an ACCEPTED number, not the one that was proposed", () => {
    // Somebody correcting page 2 to A-101 creates the clash; the proposal that
    // said A-102 no longer describes the set.
    const rows = [
      row({ pageNumber: 1 }),
      row({
        pageNumber: 2,
        proposal: { ...row({ pageNumber: 2 }).proposal!, acceptedSheetNumber: "A-101", status: "ACCEPTED" },
      }),
    ];
    expect(duplicateSheetNumbers(rows)).toEqual(["A-101"]);
  });
});

describe("the sentence at the top", () => {
  it("counts each state once and names the low-confidence ones", () => {
    const rows = [
      row({ pageNumber: 1, proposal: { ...row({ pageNumber: 1 }).proposal!, confidence: "LOW" } }),
      row({ pageNumber: 2, proposal: { ...row({ pageNumber: 2 }).proposal!, status: "ACCEPTED" } }),
      row({ pageNumber: 3, hasTextLayer: false, proposal: null }),
    ];
    const counts = countSheets(rows);
    expect(counts).toMatchObject({ pages: 3, awaiting: 1, accepted: 1, noReading: 1, lowConfidence: 1 });
    const sentence = sheetIndexSentence(counts);
    expect(sentence).toContain("3 sheets");
    expect(sentence).toContain("needs its number typed in");
    expect(sentence).toContain("least sure");
    // NEVER "identified" or "indexed" — `review.ts`'s rule. Nothing here has been
    // accepted by a machine, and a sentence that implies otherwise is the one
    // somebody quotes back when a number turns out wrong.
    expect(sentence).not.toMatch(/identified|indexed|automatically/i);
  });

  it("agrees in number — the possessive as well as the verb", () => {
    // "5 need its number typed in" shipped and a browser tester reported it. The
    // existing case above has exactly ONE unread sheet, so it only ever exercised
    // the singular and the plural was never looked at by anything. A count of one
    // is the worst possible fixture for a pluralisation bug.
    const many = [
      row({ pageNumber: 1, hasTextLayer: false, proposal: null }),
      row({ pageNumber: 2, hasTextLayer: false, proposal: null }),
      row({ pageNumber: 3, hasTextLayer: false, proposal: null }),
    ];
    const sentence = sheetIndexSentence(countSheets(many));
    expect(sentence).toContain("3 need their numbers typed in");
    expect(sentence, "the singular possessive must not survive into the plural").not.toContain("need its");

    const one = [row({ pageNumber: 1, hasTextLayer: false, proposal: null })];
    expect(sheetIndexSentence(countSheets(one))).toContain("1 needs its number typed in");
  });

  it("says so plainly when there is nothing to do", () => {
    const rows = [row({ pageNumber: 1, proposal: { ...row({ pageNumber: 1 }).proposal!, status: "ACCEPTED" } })];
    expect(sheetIndexSentence(countSheets(rows))).toContain("1 confirmed");
  });

  it("does not pretend an unread set has been read", () => {
    expect(sheetIndexSentence(countSheets([]))).toBe("Nothing has been read from this plan set yet.");
  });
});

describe("splitting the rows that can be acted on from the ones that cannot", () => {
  /**
   * A fifty-five page set rendered fifty-five rows, and fifty of them said only
   * "Sheet 23 of the file / Not read yet." — no number to check, no title to
   * correct, no Pick and no Reject, because this panel cannot read a sheet.
   * Those fifty pushed the five that could be worked off the top of the screen.
   */
  it("keeps only the rows carrying a proposal in the worklist", () => {
    const split = splitForReview([
      row({ pageNumber: 1 }),
      row({ pageNumber: 2, proposal: null }),
      row({ pageNumber: 3 }),
    ]);
    expect(split.toCheck.map((r) => r.pageNumber).sort((a, b) => a - b)).toEqual([1, 3]);
    expect(split.notReadYet).toEqual([2]);
  });

  it("TELLS A SCAN FROM AN UNREAD SHEET, because the next step differs", () => {
    // An unread sheet with text can be read again. A scan has no text to read
    // at all, so the only way to give it a number is to type it on the sheet
    // itself — and a reader told to "read it again" would try what cannot work.
    const split = splitForReview([
      row({ pageNumber: 4, proposal: null, hasTextLayer: true }),
      row({ pageNumber: 5, proposal: null, hasTextLayer: false }),
    ]);
    expect(split.notReadYet).toEqual([4]);
    expect(split.scans).toEqual([5]);
  });

  it("lists the leftovers in PAGE order, not in review order", () => {
    // `sortForReview` puts the least certain first, which is right for rows
    // somebody is about to correct and wrong for a list whose only use is
    // finding a page in the viewer.
    const split = splitForReview([
      row({ pageNumber: 9, proposal: null }),
      row({ pageNumber: 2, proposal: null }),
      row({ pageNumber: 40, proposal: null }),
    ]);
    expect(split.notReadYet).toEqual([2, 9, 40]);
  });

  it("returns three empty lists for no rows at all", () => {
    const split = splitForReview([]);
    expect(split.toCheck).toEqual([]);
    expect(split.notReadYet).toEqual([]);
    expect(split.scans).toEqual([]);
  });
});

describe("collapsing page numbers into ranges", () => {
  it("turns a long run into one range", () => {
    expect(pageRanges([6, 7, 8, 9, 10])).toBe("6-10");
  });

  it("keeps separate runs separate", () => {
    expect(pageRanges([6, 7, 8, 11, 12, 40])).toBe("6-8, 11, 12, 40");
  });

  it("DOES NOT hyphenate a pair, which is longer than listing it", () => {
    expect(pageRanges([11, 12])).toBe("11, 12");
  });

  it("sorts before it ranges, so an unsorted list still collapses", () => {
    expect(pageRanges([8, 6, 7])).toBe("6-8");
  });

  it("handles one page and none", () => {
    expect(pageRanges([40])).toBe("40");
    expect(pageRanges([])).toBe("");
  });
});
