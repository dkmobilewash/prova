import { describe, expect, it } from "vitest";
import { pickContact, rankByName } from "./resolve";

/** The ranking is the part that decides whether money lands on the right
 * "Riverside". Pure, so it is pinned without a database. */
describe("rankByName", () => {
  const rows = [
    { id: "a", name: "Riverside Plaza" },
    { id: "b", name: "Riverside Medical" },
    { id: "c", name: "riverside plaza" },
    { id: "d", name: "Maple Street TI" },
  ];

  it("returns only the exact matches when there are any, case-insensitively", () => {
    expect(rankByName(rows, "Riverside Plaza").map((r) => r.id)).toEqual(["a", "c"]);
    expect(rankByName(rows, "  RIVERSIDE PLAZA ").map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("falls back to every partial match, preferring none of them", () => {
    expect(rankByName(rows, "riverside").map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("matches nothing on an empty or unrelated string", () => {
    expect(rankByName(rows, "")).toEqual([]);
    expect(rankByName(rows, "   ")).toEqual([]);
    expect(rankByName(rows, "Harborview")).toEqual([]);
  });
});

describe("pickContact", () => {
  it("is none, one, or many — never a silent pick between different GCs", () => {
    expect(pickContact([]).kind).toBe("none");
    expect(pickContact([{ id: "t1", name: "Turner", email: "a@t.com", jobCount: 2 }]).kind).toBe("one");

    const many = pickContact([
      { id: "t1", name: "Turner Construction", email: "estimating@turner.com", jobCount: 3 },
      { id: "t2", name: "Turner Construction", email: "pm@turner.com", jobCount: 1 },
    ]);
    expect(many.kind).toBe("many");
    if (many.kind !== "many") throw new Error("unreachable");
    // The detail is what lets a person tell two Turners apart on a chip.
    expect(many.options.map((o) => o.detail)).toEqual([
      "estimating@turner.com · 3 jobs",
      "pm@turner.com · 1 job",
    ]);
  });

  it("collapses identical name+email duplicates onto the most-used record, and says so", () => {
    const picked = pickContact([
      { id: "t1", name: "Turner Construction", email: "gc@turner.com", jobCount: 1 },
      { id: "t2", name: "turner construction", email: "GC@turner.com", jobCount: 4 },
      { id: "t3", name: "Turner Construction", email: "gc@turner.com", jobCount: 0 },
    ]);
    expect(picked.kind).toBe("one");
    if (picked.kind !== "one") throw new Error("unreachable");
    expect(picked.match.id).toBe("t2");
    expect(picked.warning).toContain("4 jobs");
    expect(picked.warning).toContain("2 identical duplicates");
    expect(picked.warning).toContain("/contacts");
  });

  it("does not collapse when the emails differ, even with the same name", () => {
    const picked = pickContact([
      { id: "t1", name: "Turner", email: "a@turner.com", jobCount: 5 },
      { id: "t2", name: "Turner", email: null, jobCount: 5 },
    ]);
    expect(picked.kind).toBe("many");
  });
});
