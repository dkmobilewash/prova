import { describe, expect, it } from "vitest";
import { generalHeightOf } from "./legendHeights";
import { GENERAL_HEIGHT_KEY, heightFor } from "./reviewQueue";
import type { HeightFact } from "./wallHeights";

// Baker: A601 note A sends every wall to the deck, and the section puts the deck at 15'-0".
const deck: HeightFact = { kind: "structure-elevation", feet: 15, sheet: "A351", phrase: "B.O. DECK 15'-0\"" };
const noteA: HeightFact = { kind: "note", feet: null, label: "A", text: "ALL WALLS WILL BE TO DECK ABOVE UNLESS OTHERWISE NOTED.", sheet: "A601", phrase: "A. ALL WALLS WILL BE TO DECK ABOVE UNLESS OTHERWISE NOTED." };
const ceiling = { kind: "ceiling" as const, feet: 10, from: "ceiling plan, 2 rooms" };

describe("a sheet-wide wall-height note outranks the ceiling plan (Chrome on Baker)", () => {
  it("gives the set's sheet-wide height from its note and the deck, with where it came from", () => {
    const got = generalHeightOf({ facts: [noteA, deck], generalNote: noteA, factSheets: [] });
    expect(got?.feet).toBe(15);
    expect(got?.from).toMatch(/^general note A601: .*DECK/);
  });

  it("gives none for a note that needs a ceiling, or for a set with no note", () => {
    const above: HeightFact = { ...noteA, text: "TERMINATE ALL PARTITIONS 8\" ABOVE HIGHEST ADJACENT CEILING", phrase: "9. TERMINATE ALL PARTITIONS 8\" ABOVE HIGHEST ADJACENT CEILING" };
    expect(generalHeightOf({ facts: [above], generalNote: above, factSheets: [] })).toBeNull();
    expect(generalHeightOf({ facts: [deck], generalNote: null, factSheets: [] })).toBeNull();
  });

  it("ranks the type's own height first, then the sheet-wide note, then the ceiling", () => {
    const heights = { S6B: { feet: 14, from: "legend S6B" }, [GENERAL_HEIGHT_KEY]: { feet: 15, from: "general note A601" } };
    expect(heightFor("S6B", heights, ceiling)).toEqual({ feet: 14, from: "legend S6B" });
    // An untyped group, or a type with no height of its own: the note, not the 10'-0" ceiling.
    expect(heightFor(null, heights, ceiling)).toEqual({ feet: 15, from: "general note A601" });
    expect(heightFor("C8B", heights, ceiling)).toEqual({ feet: 15, from: "general note A601" });
    // No note: the ceiling, as before.
    expect(heightFor(null, {}, ceiling)).toEqual({ feet: 10, from: "ceiling plan, 2 rooms" });
  });
});

describe("a variant tag is offered its family's height and zone choices (Joplin's A3 and B1)", () => {
  const zones = [{ feet: 12, from: "A-512 LOWER BOD" }, { feet: 16.667, from: "A-422 CENTRAL TOW" }];
  it("finds A's entry for an A3 group, and never a family for a code the legend spells itself", async () => {
    const { forCode } = await import("./reviewQueue");
    const choices = { A: zones, A3X: [{ feet: 9, from: "its own" }] };
    expect(forCode(choices, "A3")).toEqual(zones);
    expect(forCode(choices, "a3")).toEqual(zones);
    expect(forCode(choices, "A3X")).toEqual([{ feet: 9, from: "its own" }]);
    // 12 is not a size of 1: a family ends in a letter.
    expect(forCode({ "1": zones }, "12")).toBeUndefined();
    expect(forCode(choices, null)).toBeUndefined();
  });

  it("gives an A3 group A's height, and A's level height", async () => {
    const { levelHeightFor } = await import("./reviewQueue");
    expect(heightFor("A3", { A: { feet: 15, from: "legend A" } }, ceiling)).toEqual({ feet: 15, from: "legend A" });
    expect(levelHeightFor("A3", { label: "level 1", height: { feet: 9.667, from: "x" }, codes: ["A"] })).toEqual({ feet: 9.667, from: "x" });
  });
});
