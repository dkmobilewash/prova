import { describe, expect, it } from "vitest";

import { ITEM_COLORS, colorProblem, nextItemColor } from "./itemColors";

describe("colorProblem", () => {
  it("accepts six-digit hex in either case", () => {
    expect(colorProblem("#e11d48")).toBeNull();
    expect(colorProblem("#E11D48")).toBeNull();
  });

  it("REFUSES THE THREE-DIGIT FORM, which is valid CSS", () => {
    // That is exactly why it is refused: `#f00` renders perfectly, so the
    // column would end up holding two spellings of one colour and anything
    // comparing them as strings would disagree with the screen.
    expect(colorProblem("#f00")).not.toBeNull();
  });

  it("refuses what is not a colour at all", () => {
    for (const value of ["", "red", "e11d48", "#e11d4", "#e11d48ff", "rgb(0,0,0)"]) {
      expect(colorProblem(value), value).not.toBeNull();
    }
  });

  it("accepts every colour it offers, which is the pair that must agree", () => {
    for (const color of ITEM_COLORS) expect(colorProblem(color), color).toBeNull();
  });
});

describe("nextItemColor", () => {
  it("gives the first colour to the first item", () => {
    expect(nextItemColor([])).toBe(ITEM_COLORS[0]);
  });

  it("skips what is already on the drawing", () => {
    expect(nextItemColor([ITEM_COLORS[0]])).toBe(ITEM_COLORS[1]);
    expect(nextItemColor([ITEM_COLORS[0], ITEM_COLORS[1]])).toBe(ITEM_COLORS[2]);
  });

  it("IS CASE-INSENSITIVE, so a hand-typed colour is not handed out twice", () => {
    expect(nextItemColor([ITEM_COLORS[0].toUpperCase()])).toBe(ITEM_COLORS[1]);
  });

  it("never runs out — past the list it repeats the least-used", () => {
    // Two items the same colour cannot be told apart, so a thirteenth repeats
    // whichever is currently hardest to confuse rather than always the first.
    const all = [...ITEM_COLORS];
    expect(nextItemColor(all)).toBe(ITEM_COLORS[0]);
    expect(nextItemColor([...all, ITEM_COLORS[0]])).toBe(ITEM_COLORS[1]);
  });

  it("ignores colours that are not in the list", () => {
    // Somebody's hand-typed #123456 should not stop the rotation.
    expect(nextItemColor(["#123456"])).toBe(ITEM_COLORS[0]);
  });
});

describe("the list itself", () => {
  it("has no duplicates, which is the whole premise of the rotation", () => {
    expect(new Set(ITEM_COLORS.map((c) => c.toLowerCase())).size).toBe(ITEM_COLORS.length);
  });

  it("is dark enough to read as a line on white paper", () => {
    // Not `theme-contrast.test.ts`'s job: that census is about the APP's
    // ink-on-ground pairs, and these are never a background for text. The
    // question here is only whether a line in this colour is visible over
    // printed linework, so it is checked against white.
    for (const color of ITEM_COLORS) {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
      const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
      const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      const contrast = 1.05 / (luminance + 0.05);
      expect(contrast, `${color} is too pale over white paper`).toBeGreaterThan(3);
    }
  });
});
