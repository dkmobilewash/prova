import { describe, expect, it } from "vitest";
import { proposalSections, showsHeadings } from "./proposalSections";
import type { WallGroup } from "./wallGroups";

function group(inches: number, itemId: string | null): WallGroup {
  return {
    inches,
    runs: [],
    feet: inches * 10,
    source: { kind: "REMAINDER" },
    candidates: [],
    itemId,
  };
}

const INTERIOR = { id: "item-int", name: "3⅝ interior" };
const EXTERIOR = { id: "item-ext", name: "6 exterior" };

describe("detected groups read under the condition they propose into", () => {
  it("KEEPS EACH GROUP'S ORIGINAL INDEX, which is what addresses the overlay", () => {
    // The whole reason this is a reading order rather than a re-sort. Index 0
    // is the drawing's first colour and dash, `chosen[0]` is its wall type, and
    // hovering it lights its runs. Here the array order and the reading order
    // disagree on every entry, which is the case that would hide a renumber.
    const sections = proposalSections(
      [group(6, EXTERIOR.id), group(3.625, INTERIOR.id), group(8, EXTERIOR.id)],
      [INTERIOR, EXTERIOR],
    );
    expect(sections.map((one) => one.name)).toEqual([INTERIOR.name, EXTERIOR.name]);
    expect(sections[0].entries.map((one) => one.index)).toEqual([1]);
    expect(sections[1].entries.map((one) => one.index)).toEqual([0, 2]);
    // And the group each index names is still the group that was there.
    expect(sections[1].entries.map((one) => one.group.inches)).toEqual([6, 8]);
  });

  it("puts unassigned last, however many conditions matched", () => {
    const sections = proposalSections(
      [group(4, null), group(3.625, INTERIOR.id), group(9, null)],
      [INTERIOR],
    );
    expect(sections.map((one) => one.itemId)).toEqual([INTERIOR.id, null]);
    expect(sections[1].entries.map((one) => one.index)).toEqual([0, 2]);
  });

  it("follows the ITEMS' order, not the groups' or the footage's", () => {
    // So this panel and the items panel beside it agree about which condition
    // comes first. Exterior is listed first here and carries less footage, and
    // both of those would move it if either were the key.
    const sections = proposalSections(
      [group(3.625, INTERIOR.id), group(6, EXTERIOR.id)],
      [EXTERIOR, INTERIOR],
    );
    expect(sections.map((one) => one.name)).toEqual([EXTERIOR.name, INTERIOR.name]);
  });

  it("omits a condition nothing was detected for", () => {
    // An item with no groups is not an empty heading — the items panel already
    // says the condition exists, and a heading with nothing under it reads as
    // detection having failed on it.
    const sections = proposalSections([group(3.625, INTERIOR.id)], [INTERIOR, EXTERIOR]);
    expect(sections.map((one) => one.name)).toEqual([INTERIOR.name]);
  });

  it("treats an id no item owns as UNASSIGNED rather than a nameless heading", () => {
    // `itemId` is SET NULL when a condition is deleted, so this should not
    // survive a committed delete. A row read mid-delete would otherwise render
    // a heading for a condition that is gone.
    const sections = proposalSections([group(4, "item-deleted")], [INTERIOR]);
    expect(sections).toEqual([
      { itemId: null, name: null, entries: [{ group: group(4, "item-deleted"), index: 0 }] },
    ]);
  });

  it("carries a group with no itemId at all, as `wallGroups` builds them", () => {
    // `itemId` is optional on WallGroup: a group that was just FOUND has no
    // assignment yet, and the property is absent rather than null.
    const fresh: WallGroup = {
      inches: 4,
      runs: [],
      feet: 40,
      source: { kind: "REMAINDER" },
      candidates: [],
    };
    const sections = proposalSections([fresh], []);
    expect(sections).toEqual([{ itemId: null, name: null, entries: [{ group: fresh, index: 0 }] }]);
  });
});

describe("headings appear only when they tell somebody something", () => {
  it("stays off for one unassigned pile — the ordinary state of a new job", () => {
    expect(showsHeadings(proposalSections([group(4, null)], []))).toBe(false);
  });

  it("comes on for one MATCHED section, because that names the condition", () => {
    expect(showsHeadings(proposalSections([group(3.625, INTERIOR.id)], [INTERIOR]))).toBe(true);
  });

  it("comes on as soon as there is a distinction to draw", () => {
    const mixed = proposalSections([group(3.625, INTERIOR.id), group(9, null)], [INTERIOR]);
    expect(showsHeadings(mixed)).toBe(true);
  });

  it("stays off for nothing at all", () => {
    expect(showsHeadings(proposalSections([], [INTERIOR]))).toBe(false);
  });
});

describe("a group with no stored match is matched again when the panel reads it", () => {
  // THE ORDINARY CASE, NOT AN EDGE. Detection fires the instant a scale is
  // accepted, so on a job whose conditions are named afterwards — which is
  // most of them — every group stored a null. Without this the panel shows one
  // undifferentiated pile for ever and nothing says a re-run would fix it.
  const SIZED = { id: "int", name: "3 5/8 interior", thicknessIn: 3.625 };

  it("sorts a null under the condition whose thickness it matches", () => {
    const sections = proposalSections([group(3.625, null)], [SIZED]);
    expect(sections.map((one) => one.itemId)).toEqual([SIZED.id]);
  });

  it("A STORED VALUE WINS, because that is a decision and a null is an absence", () => {
    // Thickness says "wide", the stored match says "narrow", and the stored
    // match stands.
    const sections = proposalSections(
      [group(6, "narrow")],
      [
        { id: "narrow", name: "narrow", thicknessIn: 3.625 },
        { id: "wide", name: "wide", thicknessIn: 6 },
      ],
    );
    expect(sections.map((one) => one.itemId)).toEqual(["narrow"]);
  });

  it("REFUSES A TIE here exactly as detection does", () => {
    // Same function, so the same refusal. Two conditions at one thickness is a
    // question for a person; picking either silently prices walls against the
    // wrong one.
    const sections = proposalSections(
      [group(3.625, null)],
      [
        { id: "one", name: "one", thicknessIn: 3.625 },
        { id: "two", name: "two", thicknessIn: 3.625 },
      ],
    );
    expect(sections.map((one) => one.itemId)).toEqual([null]);
  });

  it("matches on the drawing's TAG through the joined assembly code", () => {
    // An item stores a wall-type id and the drawing prints that type's code;
    // the loader joins them. The thickness here is nonsense on purpose, so a
    // match can only have come from the code.
    const tagged: WallGroup = {
      inches: 99,
      runs: [],
      feet: 100,
      source: { kind: "TAG", tag: "A1" },
      candidates: [],
      itemId: null,
    };
    const sections = proposalSections(
      [tagged],
      [{ id: "byCode", name: "by code", thicknessIn: null, assemblyCode: "A1" }],
    );
    expect(sections.map((one) => one.itemId)).toEqual(["byCode"]);
  });

  it("leaves a group alone when no condition fits", () => {
    expect(proposalSections([group(9.5, null)], [SIZED]).map((one) => one.itemId)).toEqual([null]);
  });

  it("does nothing at all when there are no conditions", () => {
    // ponytail: the short-circuit, asserted so it cannot start dropping the
    // stored ids it exists to preserve.
    const sections = proposalSections([group(3.625, "kept")], []);
    expect(sections.map((one) => one.itemId)).toEqual([null]);
    expect(sections[0].entries).toHaveLength(1);
  });
});
