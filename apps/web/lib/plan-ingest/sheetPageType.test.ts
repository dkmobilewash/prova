import { describe, expect, it } from "vitest";
import { normaliseSheetPageType, SHEET_PAGE_TYPES } from "@prova/integrations/src/planSheets";

/**
 * THE COLUMN IS A STRING, SO THIS IS THE THING THAT KEEPS IT CLOSED.
 *
 * `PlanSheetProposal.proposedPageType` is `String?` rather than an enum on
 * purpose — it holds MODEL OUTPUT, and an enum column would reject an
 * unexpected value at write time, losing the whole proposal to a redacted
 * production error over one field. `normaliseSheetPageType` is the gate
 * instead, which makes the schema comment's promise — "what reaches this
 * column is always one of the seven" — a claim in code rather than prose.
 *
 * So the important test here is not that "FLOOR PLAN" maps to PLAN. It is that
 * NOTHING maps outside the set, including the inputs nobody thought of.
 */

describe("every answer is inside the closed set", () => {
  it("maps the words a title block actually prints", () => {
    const cases: [string, string][] = [
      ["FIRST FLOOR PLAN", "PLAN"],
      ["REFLECTED CEILING PLAN", "PLAN"],
      ["ROOF PLAN", "PLAN"],
      ["EXTERIOR ELEVATIONS", "ELEVATION"],
      ["INTERIOR ELEV", "ELEVATION"],
      ["BUILDING SECTIONS", "SECTION"],
      ["WALL SECTIONS AND DETAILS", "SECTION"],
      ["PARTITION DETAILS", "DETAIL"],
      ["HEAD OF WALL DTL", "DETAIL"],
      ["DOOR SCHEDULE", "SCHEDULE"],
      ["FINISH SCHED", "SCHEDULE"],
      ["WINDOW AND DOOR SCHEDULES", "SCHEDULE"],
      ["COVER SHEET", "COVER"],
      ["TITLE SHEET", "COVER"],
      ["DRAWING INDEX", "COVER"],
    ];
    for (const [printed, expected] of cases) {
      expect(normaliseSheetPageType(printed), printed).toBe(expected);
    }
  });

  it("accepts the vocabulary it handed the model, unchanged", () => {
    // A model answering in the set must never be put through the word search.
    for (const type of SHEET_PAGE_TYPES) {
      expect(normaliseSheetPageType(type), type).toBe(type);
      expect(normaliseSheetPageType(type.toLowerCase()), type).toBe(type);
    }
  });

  it("ANSWERS OTHER FOR ANYTHING IT DOES NOT RECOGNISE, never the input", () => {
    // The closed-set decision. Keeping the input — which is what
    // `normaliseDiscipline` deliberately does three lines away in the same
    // file — would break the one thing this column exists for, filtering.
    const strangers = [
      "GENERAL NOTES",
      "LEGEND AND ABBREVIATIONS",
      "DOOR HARDWARE SPECIFICATION",
      "LIFE SAFETY",
      "3D VIEWS",
      "AV",
      "¯\\_(ツ)_/¯",
      "PLAN-ish nonsense that merely rhymes: PLN",
    ];
    for (const stranger of strangers) {
      const got = normaliseSheetPageType(stranger);
      expect(SHEET_PAGE_TYPES as readonly (string | null)[], stranger).toContain(got);
    }
    expect(normaliseSheetPageType("GENERAL NOTES")).toBe("OTHER");
    expect(normaliseSheetPageType("LEGEND AND ABBREVIATIONS")).toBe("OTHER");
  });

  it("keeps NULL distinct from OTHER, because they are different facts", () => {
    // Null: nobody has read this page, or the text gave nothing to judge from.
    // OTHER: it was read and it is none of the six. Collapsing them would make
    // an unread page look classified.
    expect(normaliseSheetPageType(null)).toBeNull();
    expect(normaliseSheetPageType("")).toBeNull();
    expect(normaliseSheetPageType("   ")).toBeNull();
    expect(normaliseSheetPageType("GENERAL NOTES")).not.toBeNull();
  });
});

describe("a title naming two kinds picks the one printed first", () => {
  it("prefers the earlier word rather than the first rule in the list", () => {
    // A real sheet is titled "ENLARGED PLANS AND SECTIONS". There is no right
    // answer; picking the earlier word is defensible and, more importantly,
    // STATED — a reader can predict it.
    expect(normaliseSheetPageType("ENLARGED PLANS AND SECTIONS")).toBe("PLAN");
    expect(normaliseSheetPageType("SECTIONS AND ENLARGED PLANS")).toBe("SECTION");
  });

  it("reads COVER SHEET as a cover rather than stopping at the longer list entry", () => {
    // "COVER SHEET" precedes "COVER" in the word list so that the specific
    // phrase cannot be shadowed. Both answer COVER, which is the point: the
    // ordering is defensive, not load-bearing on the outcome.
    expect(normaliseSheetPageType("COVER SHEET")).toBe("COVER");
    expect(normaliseSheetPageType("COVER")).toBe("COVER");
  });

  it("does not let the discipline leak in as a page type", () => {
    // "ARCHITECTURAL" is a discipline and names no kind. A reader that
    // answered it would otherwise be recorded as a classification.
    expect(normaliseSheetPageType("ARCHITECTURAL")).toBe("OTHER");
    expect(normaliseSheetPageType("STRUCTURAL")).toBe("OTHER");
  });
});

describe("the set itself", () => {
  it("holds the seven kinds and no duplicates", () => {
    expect(new Set(SHEET_PAGE_TYPES).size).toBe(SHEET_PAGE_TYPES.length);
    expect(SHEET_PAGE_TYPES).toContain("SCHEDULE");
    // SCHEDULE is the one PR 4 depends on: schedule parsing has to find the
    // schedule sheets, and this is how.
    expect(SHEET_PAGE_TYPES).toContain("OTHER");
  });
});
