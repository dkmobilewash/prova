import { describe, expect, it } from "vitest";
import { wallTypeSummary } from "./wallTypeMatch";
import { groupChoices, typeOptionLabel } from "./wallGroups";
import { sightFieldsFor } from "./legendProposal";

const part = (description: string, basis: string, factor = 1) => ({ description, basis, factor });

describe("wallTypeSummary — what tells S6B from S6C", () => {
  it("says which faces carry board, how many layers, the rating and insulation, from the type itself", () => {
    const s6b = wallTypeSummary({ name: "NON-RATED INTERIOR WALL", sides: 2, notes: "RATING: NON-RATED", components: [part("6in metal stud", "STUDS"), part("5/8in type X gypsum board", "BOARDED_SQFT")] });
    const s6c = wallTypeSummary({ name: "NON-RATED INTERIOR WALL", sides: 1, notes: null, components: [part("6in metal stud", "STUDS"), part("5/8in type X gypsum board", "BOARDED_SQFT")] });
    expect(s6b).toBe("board both sides · non-rated");
    expect(s6c).toBe("board one side · non-rated");
    expect(wallTypeSummary({ name: "S6A", sides: 2, notes: "RATING:\n2 HR\nUL LISTING", components: [part("5/8in type X gypsum board, 2 layers per side", "BOARDED_SQFT", 2), part("cavity insulation", "FACE_SQFT")] })).toBe("board both sides · 2 layers · 2 HR · insulated");
    expect(wallTypeSummary({ name: "W3", sides: 2, components: [part("2x4 studs", "STUDS"), part("½″ board, 4x8 sheets", "BOARDED_SQFT", 0.03125)] })).toBe("board both sides · wood studs");
  });
  it("says nothing it cannot read: a type with no parts has no summary", () => {
    expect(wallTypeSummary({ name: "A1", sides: 2, components: [] })).toBe("");
  });
  it("the option label carries it", () => {
    expect(typeOptionLabel({ id: "x", code: "S6C", name: "NON-RATED INTERIOR WALL", hasParts: true, thicknessIn: 7.25, summary: "board one side" })).toBe("S6C — NON-RATED INTERIOR WALL · board one side");
    expect(typeOptionLabel({ id: "x", code: "A1", name: "Partition", hasParts: false, thicknessIn: null })).toBe("A1 — Partition");
  });
});

describe("groupChoices — an unpriced group is asked, types first", () => {
  const t = (id: string, hasParts = true) => ({ id, code: id, name: id, hasParts, thicknessIn: 7.25 });
  const types = [t("W1"), t("S6B"), t("S6C"), t("A1", false)];
  it("leads with the verdict's own candidates, the sheet's note first, then every other type with parts, then create, then plain — plain is last", () => {
    const choices = groupChoices({ state: "ASK", types: [types[1], types[2]], suggested: types[2], note: "ALL PARTITIONS S6C U.N.O." }, types);
    expect(choices.map((c) => (c.kind === "type" ? `${c.type.code}:${c.why}` : c.kind))).toEqual(["S6C:note", "S6B:candidate", "W1:other", "create", "plain"]);
  });
  it("offers a tag the measurement disagrees with, first, and never a type without parts", () => {
    const choices = groupChoices({ state: "TAG_DISAGREES", type: types[1], tag: "S6B" }, types);
    expect(choices.map((c) => (c.kind === "type" ? c.type.code : c.kind))).toEqual(["S6B", "W1", "S6C", "create", "plain"]);
  });
  it("a group nothing names still gets every priced type before the plain option", () => {
    expect(groupChoices({ state: "UNKNOWN" }, types).map((c) => (c.kind === "type" ? c.type.code : c.kind))).toEqual(["W1", "S6B", "S6C", "create", "plain"]);
  });
});

describe("sightFieldsFor — the two fields the merged view drops", () => {
  const sight = { types: [{ code: "C8B", heightNote: "SEE NOTE A", studMaterial: "concrete" }, { code: "S6A", heightNote: null, studMaterial: "steel" }, { code: "X", studMaterial: 7 }] };
  it("reads the height note and the stud material by code, concrete staying concrete and steel reading as metal", () => {
    expect(sightFieldsFor(sight, "c8b")).toEqual({ heightNote: "SEE NOTE A", studMaterial: "concrete" });
    expect(sightFieldsFor(sight, "S6A")).toEqual({ heightNote: null, studMaterial: "metal" });
    expect(sightFieldsFor(sight, "X")).toEqual({ heightNote: null, studMaterial: null });
    expect(sightFieldsFor(null, "S6A")).toEqual({ heightNote: null, studMaterial: null });
    expect(sightFieldsFor({ types: "nope" }, "S6A")).toEqual({ heightNote: null, studMaterial: null });
  });
});
