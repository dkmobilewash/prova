import { describe, expect, it } from "vitest";
import {
  measurementPackages,
  onePackageOnly,
  describeForPackage,
  BASE_PACKAGE,
} from "./packages";

/**
 * THE FAILURE THIS EXISTS FOR, IN ONE SENTENCE EACH WAY.
 *
 * A base bid carrying an alternate's quantities is HIGH by exactly that
 * alternate, which loses the job with nothing on screen to say why. An
 * alternate accepted and never measured is work built at a loss.
 *
 * Those are not symmetric, and every default here follows from that: an
 * untagged quantity is in the BASE, because a bid that is accidentally high is
 * recoverable and one that is accidentally low is built.
 */

const m = (id: string, packageLabel: string | null = null) => ({ id, packageLabel });

describe("grouping measurements by pricing package", () => {
  it("puts an UNTAGGED measurement in the base bid", () => {
    // The safety default. Every measurement traced before this column existed
    // is untagged, and all of them belong in the number.
    const groups = measurementPackages([m("a"), m("b")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].isBase).toBe(true);
    expect(groups[0].label).toBeNull();
    expect(groups[0].ids).toEqual(["a", "b"]);
  });

  it("separates an alternate from the base", () => {
    const groups = measurementPackages([m("a"), m("b", "Add Alternate 1")]);
    expect(groups.map((g) => g.name)).toEqual([BASE_PACKAGE, "Add Alternate 1"]);
    expect(groups[0].ids).toEqual(["a"]);
    expect(groups[1].ids).toEqual(["b"]);
    expect(groups[1].isBase).toBe(false);
  });

  it("ALWAYS SHOWS THE BASE, even when it is empty", () => {
    // "The base bid has no quantities on this sheet" is a fact worth seeing,
    // and an absent heading says nothing at all.
    const groups = measurementPackages([m("a", "Add Alternate 1")]);
    expect(groups[0].isBase).toBe(true);
    expect(groups[0].ids).toEqual([]);
    expect(groups).toHaveLength(2);
  });

  it("puts the base FIRST, whatever the labels sort like", () => {
    const groups = measurementPackages([m("a", "AAA"), m("b")]);
    expect(groups[0].isBase).toBe(true);
  });

  it("orders the alternates by name so the list is stable between renders", () => {
    const groups = measurementPackages([m("a", "Alt 2"), m("b", "Alt 1"), m("c", "Alt 3")]);
    expect(groups.slice(1).map((g) => g.name)).toEqual(["Alt 1", "Alt 2", "Alt 3"]);
  });

  it("DOES NOT MERGE TWO SPELLINGS, which is deliberate", () => {
    // `bid-levelling.ts` made the same call for the same reason: a typo showing
    // as two headings is fixed in a second, and two scopes silently merged into
    // one is a wrong number nobody can see.
    const groups = measurementPackages([m("a", "Alt 1"), m("b", "alt 1"), m("c", "Alt  1")]);
    expect(groups).toHaveLength(4);
  });

  it("reads a whitespace-only label as the base, since nobody typed that on purpose", () => {
    const groups = measurementPackages([m("a", "   "), m("b", "")]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(["a", "b"]);
  });

  it("trims a label rather than making two groups out of one", () => {
    const groups = measurementPackages([m("a", "Alt 1"), m("b", " Alt 1 ")]);
    expect(groups).toHaveLength(2);
    expect(groups[1].ids).toEqual(["a", "b"]);
  });

  it("returns the base alone for no measurements at all", () => {
    expect(measurementPackages([])).toEqual([
      { label: null, name: BASE_PACKAGE, isBase: true, ids: [] },
    ]);
  });
});

describe("posting one package at a time", () => {
  it("allows a selection that is all one alternate", () => {
    const check = onePackageOnly([m("a", "Add Alternate 1"), m("b", "Add Alternate 1")]);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.label).toBe("Add Alternate 1");
    expect(check.count).toBe(2);
  });

  it("allows a selection that is all base", () => {
    const check = onePackageOnly([m("a"), m("b")]);
    expect(check.ok).toBe(true);
    if (!check.ok) return;
    expect(check.label).toBeNull();
    expect(check.name).toBe(BASE_PACKAGE);
  });

  it("REFUSES A MIXED SELECTION, and names the packages", () => {
    // Refused rather than reported, which is unusual in this product. Once
    // posted, nothing on a line says which package it came from, so a mixed
    // post cannot be undone by looking — see the module header.
    const check = onePackageOnly([m("a"), m("b", "Add Alternate 1")]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toContain(BASE_PACKAGE);
    expect(check.reason).toContain("Add Alternate 1");
    expect(check.reason).toMatch(/high by exactly/i);
    expect(check.reason).toMatch(/one package at a time/i);
  });

  it("refuses two different alternates together", () => {
    const check = onePackageOnly([m("a", "Alt 1"), m("b", "Alt 2")]);
    expect(check.ok).toBe(false);
  });

  it("refuses an empty selection, saying so rather than posting nothing", () => {
    const check = onePackageOnly([]);
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.reason).toMatch(/nothing is selected/i);
  });

  it("treats a blank label and a null one as the same package", () => {
    expect(onePackageOnly([m("a"), m("b", ""), m("c", "  ")]).ok).toBe(true);
  });
});

describe("how a posted line names its package", () => {
  it("prefixes an alternate's line", () => {
    expect(describeForPackage("3-5/8in metal stud", "Add Alternate 1")).toBe(
      "[Add Alternate 1] 3-5/8in metal stud",
    );
  });

  it("LEAVES A BASE LINE ALONE — a label on everything is read by nobody", () => {
    expect(describeForPackage("3-5/8in metal stud", null)).toBe("3-5/8in metal stud");
    expect(describeForPackage("3-5/8in metal stud", "  ")).toBe("3-5/8in metal stud");
  });

  it("puts it at the FRONT, so a truncated list still shows it", () => {
    expect(describeForPackage("x", "Alt 1").startsWith("[Alt 1]")).toBe(true);
  });
});
