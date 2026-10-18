import { describe, expect, it } from "vitest";
import { isScheduleRowArray, scheduleRowsFromJson } from "./scheduleRowsJson";
import { parseScheduleRows, SCHEDULE_KINDS } from "@prova/integrations/src/scheduleRows";

/**
 * The two places a schedule row can arrive malformed, and what happens at each.
 *
 * `parseScheduleRows` guards the way IN from the model. `isScheduleRowArray`
 * guards the way OUT of a `Json` column, because a row written by an older build
 * is not evidence of anything. Both drop rather than repair: there is no honest
 * default for a door mark.
 */

describe("on the way in, from the model", () => {
  it("keeps a complete row", () => {
    const read = parseScheduleRows({
      kind: "DOOR",
      title: "DOOR SCHEDULE",
      rows: [{ mark: "101", description: "HOLLOW METAL", size: "3'-0\" x 7'-0\"", quantity: null, notes: "90 MIN" }],
      reason: "Column 1 is the mark.",
      confidence: "HIGH",
    });
    expect(read.kind).toBe("DOOR");
    expect(read.rows).toHaveLength(1);
    expect(read.rows[0].mark).toBe("101");
    expect(read.rows[0].quantity).toBeNull();
  });

  it("DROPS A ROW WITH NO MARK, because the mark is the identity", () => {
    // Without it there is nothing to match against a drawing and nothing a
    // person can check. A placeholder would become a line item for a door that
    // does not exist.
    const read = parseScheduleRows({
      kind: "DOOR",
      rows: [{ mark: "101" }, { mark: "" }, { mark: null }, { description: "no mark at all" }],
      reason: "r",
      confidence: "HIGH",
    });
    expect(read.rows.map((r) => r.mark)).toEqual(["101"]);
  });

  it("does not invent a quantity of 1", () => {
    // A null means "count the rows" and a 1 means "the schedule said one". A
    // bid built on the difference is wrong in a way nobody can see.
    const read = parseScheduleRows({ kind: "DOOR", rows: [{ mark: "101" }], reason: "r", confidence: "HIGH" });
    expect(read.rows[0].quantity).toBeNull();
  });

  it("falls back to OTHER on an unknown kind, and LOW on an unknown confidence", () => {
    const read = parseScheduleRows({ kind: "LOUVRE", rows: [], reason: "r", confidence: "VERY" });
    expect(read.kind).toBe("OTHER");
    expect(read.confidence).toBe("LOW");
  });

  it("survives a tool call that is empty, null or the wrong shape entirely", () => {
    for (const input of [undefined, null, {}, [], "nope", 7]) {
      const read = parseScheduleRows(input);
      expect(read.rows).toEqual([]);
      expect(SCHEDULE_KINDS as readonly string[]).toContain(read.kind);
      expect(read.reason.length).toBeGreaterThan(0);
      expect(read.confidence).toBe("LOW");
    }
  });

  it("says the reading is unchecked when no reason came back", () => {
    // A reason nobody can check is a reason nobody can overrule — so an absent
    // one says so rather than reading as an endorsement.
    expect(parseScheduleRows({ kind: "DOOR", rows: [] }).reason).toContain("unchecked");
  });

  it("discards a non-finite quantity rather than letting NaN reach a column", () => {
    const read = parseScheduleRows({
      kind: "DOOR",
      rows: [{ mark: "101", quantity: Number.NaN }, { mark: "102", quantity: 4 }],
      reason: "r",
      confidence: "HIGH",
    });
    expect(read.rows[0].quantity).toBeNull();
    expect(read.rows[1].quantity).toBe(4);
  });
});

describe("on the way out, from the Json column", () => {
  const good = [{ mark: "101", description: null, size: null, quantity: null, notes: null }];

  it("accepts rows this app wrote", () => {
    expect(isScheduleRowArray(good)).toBe(true);
  });

  it("refuses a column that is not an array of rows", () => {
    for (const bad of [null, undefined, {}, "rows", 7, [{ description: "no mark" }], [{ mark: 101 }]]) {
      expect(isScheduleRowArray(bad), JSON.stringify(bad) ?? "undefined").toBe(false);
    }
  });

  it("refuses a row whose nullable field arrived as a number", () => {
    expect(isScheduleRowArray([{ mark: "101", description: 7, size: null, quantity: null, notes: null }])).toBe(
      false,
    );
  });

  it("salvages the good rows when one of many is malformed", () => {
    // The guard answers "is this whole column trustworthy"; this answers "what
    // of it can I show". A long schedule with one bad row is worth rendering.
    const mixed = [...good, { description: "no mark" }, { mark: "102", description: null, size: null, quantity: null, notes: null }];
    expect(scheduleRowsFromJson(mixed).map((r) => r.mark)).toEqual(["101", "102"]);
  });

  it("salvages nothing from a column that is not an array", () => {
    expect(scheduleRowsFromJson("nope")).toEqual([]);
  });
});
