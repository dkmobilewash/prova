import { describe, expect, it } from "vitest";

import { BOILER, SHEET_NO, nameSheet } from "./nameSheet";

/**
 * Every string in this file was READ OFF A REAL PLAN SET on 2026-10-16 —
 * Camp Bow Wow (29 sheets) and ELEVEN03 (175) — by running the sheet-tree
 * eval over the folder. None is invented to make a case, which is why the
 * sheet numbers look so unlike each other.
 */

describe("SHEET_NO", () => {
  it("accepts the numbering schemes real offices print", () => {
    // The first five FAILED the old pattern, and the cost was not a missing
    // number but a WRONG one: the largest matching token wins, so a wall-type
    // tag became the sheet number and the real number ended up in the title.
    for (const number of ["A4.B.1", "A1.2-1", "A0.003B", "A4.B-Y2", "H-96037"]) {
      expect(SHEET_NO.test(number), `${number} is a real sheet number`).toBe(true);
    }
    // And the ones that always worked still do.
    for (const number of ["A-101", "G-001", "SP-1", "M-101", "E3.12", "A5.11", "A8.0"]) {
      expect(SHEET_NO.test(number), `${number} regressed`).toBe(true);
    }
  });

  it("REQUIRES A DIGIT, which is what keeps the widening honest", () => {
    // The permissive body alone accepts all of these. The lookahead is the
    // only thing standing between the title reader and treating the biggest
    // word on the sheet as its number.
    for (const word of ["PLAN", "CONC", "TRUE", "HR", "LEVEL", "NORTH", "A"]) {
      expect(SHEET_NO.test(word), `${word} must not read as a sheet number`).toBe(false);
    }
  });

  it("rejects a bare number and a phone number", () => {
    expect(SHEET_NO.test("2026")).toBe(false);
    expect(SHEET_NO.test("1-800-555")).toBe(false);
  });
});

describe("BOILER", () => {
  it("matches the labels that end in punctuation", () => {
    // ALL THREE WERE DEAD BRANCHES. The old pattern put `\\b` after every
    // alternative, and `\\b` needs a word character on one side — so
    // `project #:`, `no.` and `©` could never match, and every Camp Bow Wow
    // title read "COVER SHEET project #: drawing number: drawing title: …".
    for (const label of ["project #:", "no.", "© 2025 by EVOLVE ARCHITECTS"]) {
      expect(BOILER.test(label), `${label} is boilerplate`).toBe(true);
    }
  });

  it("matches the drawing-* labels that were simply absent", () => {
    expect(BOILER.test("drawing number:")).toBe(true);
    expect(BOILER.test("drawing title:")).toBe(true);
  });

  it("matches a standalone SHEET label without eating COVER SHEET", () => {
    // 89 of 283 real titles led with this label; none of them is a title.
    expect(BOILER.test("SHEET")).toBe(true);
    // Anchored at ^, so a title that merely contains the word survives whole.
    expect(BOILER.test("COVER SHEET")).toBe(false);
  });

  it("does not eat a word that merely starts like a label", () => {
    // The word boundary is protecting these, and widening `sheet` must not
    // have cost it.
    for (const title of ["projection", "drawings", "sheeting"]) {
      expect(BOILER.test(title), `${title} is not boilerplate`).toBe(false);
    }
  });

  it("leaves real titles alone", () => {
    for (const title of ["COVER SHEET", "FLOOR PLAN", "DIMENSIONAL FLOOR PLAN", "CODE ANALYSIS", "3D VIEWS"]) {
      expect(BOILER.test(title), `${title} is a real title`).toBe(false);
    }
  });
});

describe("nameSheet", () => {
  /** Bottom-right of a 3024 × 2160 pt sheet, which is where a title block is. */
  const page = { widthPt: 3024, heightPt: 2160 };
  const inBlock = (str: string, height: number) => ({ str, x: 2600, y: 1900, height });

  it("takes the title from ONE TYPE SIZE, not the next six words", () => {
    // THE CASE THIS RULE EXISTS FOR. Once the boilerplate stopped crowding
    // the title out, what filled the gap was the DRAWING: Camp Bow Wow's A101
    // read "FLOOR PLAN True OUTDOOR PLAY YARD 1". A title block sets its
    // title in one size, and the smaller words drop off on their own.
    const { number, title } = nameSheet(
      [
        inBlock("A101", 40),
        inBlock("FLOOR PLAN", 24),
        inBlock("True", 9),
        inBlock("OUTDOOR PLAY YARD 1", 9),
      ],
      page,
    );
    expect(number).toBe("A101");
    expect(title).toBe("FLOOR PLAN");
  });

  it("keeps a wrapped title whose second line is set a hair smaller", () => {
    const { title } = nameSheet(
      [inBlock("A104", 40), inBlock("ENLARGED PLANS", 24), inBlock("AND ELEVATIONS", 21)],
      page,
    );
    expect(title).toBe("ENLARGED PLANS AND ELEVATIONS");
  });

  it("ignores everything outside the title block", () => {
    // A tag in the middle of the drawing is not a sheet number, however big.
    const { number } = nameSheet(
      [
        { str: "WT-12", x: 200, y: 400, height: 90 },
        inBlock("A4.B-Y2", 40),
      ],
      page,
    );
    expect(number).toBe("A4.B-Y2");
  });

  it("returns empty strings rather than guessing when nothing reads", () => {
    expect(nameSheet([], page)).toEqual({ number: "", title: "", distinct: false });
  });

  it("drops a run of underscores from the title and says when the title's lettering stands out", () => {
    const tall = nameSheet(
      [inBlock("COVER SHEET", 40), inBlock("__________", 40), inBlock("A101", 30), inBlock("ISSUED FOR BID", 12), inBlock("CHECKED BY", 12), inBlock("DATE", 12)],
      page,
    );
    expect(tall.title).toBe("COVER SHEET");
    expect(tall.distinct).toBe(true);
    const flat = nameSheet([inBlock("COVER SHEET", 12), inBlock("A101", 12), inBlock("ISSUED FOR BID", 12), inBlock("CHECKED BY", 12)], page);
    expect(flat.title).toBe("COVER SHEET");
    expect(flat.distinct).toBe(false);
  });
});
