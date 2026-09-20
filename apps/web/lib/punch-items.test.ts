import { describe, expect, it } from "vitest";
import { capabilityForStatus, isOverdue, parseAssignee, parseDueOn, wantsFixPhoto } from "./punch-items";

/** The punch list's rules that need no database — the reason they were
 * lifted out of a `"use server"` module, where the only way to reach them
 * is to write a row. */

describe("who is fixing it", () => {
  it("reads each of the three shapes, one at a time", () => {
    expect(parseAssignee("user:u_1", "")).toEqual({
      ok: true,
      value: { assignedUserId: "u_1", assignedCrewMemberId: null, assignedName: null },
    });
    expect(parseAssignee("crew:c_1", "")).toEqual({
      ok: true,
      value: { assignedUserId: null, assignedCrewMemberId: "c_1", assignedName: null },
    });
    expect(parseAssignee("name", "  Ramirez Drywall ")).toEqual({
      ok: true,
      value: { assignedUserId: null, assignedCrewMemberId: null, assignedName: "Ramirez Drywall" },
    });
  });

  it("treats nobody as an answer, not an error", () => {
    expect(parseAssignee("", "")).toEqual({
      ok: true,
      value: { assignedUserId: null, assignedCrewMemberId: null, assignedName: null },
    });
  });

  it("refuses 'someone else' with no name typed", () => {
    // The database refuses a blank name too; this is the sentence a person
    // reads instead of a constraint violation.
    expect(parseAssignee("name", "   ")).toEqual({
      ok: false,
      error: "Type the name of whoever is fixing it",
    });
  });

  it("refuses a value the picker could not have produced", () => {
    expect(parseAssignee("user:", "").ok).toBe(false);
    expect(parseAssignee("nonsense", "").ok).toBe(false);
  });
});

describe("the due date", () => {
  it("is UTC midnight, like every other entered date here", () => {
    const parsed = parseDueOn("2026-09-25");
    expect(parsed.ok && parsed.value?.toISOString()).toBe("2026-09-25T00:00:00.000Z");
  });

  it("takes an empty box as no due date, which most items have", () => {
    expect(parseDueOn("  ")).toEqual({ ok: true, value: null });
  });

  it("refuses anything that is not a date", () => {
    expect(parseDueOn("next tuesday").ok).toBe(false);
    expect(parseDueOn("2026-13-40").ok).toBe(false);
  });
});

describe("overdue, which is derived and never stored", () => {
  const today = new Date("2026-09-20T18:00:00.000Z");

  it("is late when the date has passed and somebody still has to act", () => {
    expect(isOverdue({ dueOn: new Date("2026-09-19T00:00:00.000Z"), status: "OPEN" }, today)).toBe(true);
    // Still late: the GC is waiting on the sign-off, not on the crew.
    expect(isOverdue({ dueOn: new Date("2026-09-19T00:00:00.000Z"), status: "READY_FOR_REVIEW" }, today)).toBe(
      true,
    );
  });

  it("is not late on the day itself", () => {
    expect(isOverdue({ dueOn: new Date("2026-09-20T00:00:00.000Z"), status: "OPEN" }, today)).toBe(false);
  });

  it("is never late once nobody has to look at it again", () => {
    expect(isOverdue({ dueOn: new Date("2026-01-01T00:00:00.000Z"), status: "VERIFIED" }, today)).toBe(false);
  });

  it("is never late with no due date at all", () => {
    expect(isOverdue({ dueOn: null, status: "OPEN" }, today)).toBe(false);
  });
});

describe("the photo prompt", () => {
  it("asks once an item is closed and there is no picture of the fix", () => {
    expect(wantsFixPhoto({ status: "READY_FOR_REVIEW", photoCount: 0 })).toBe(true);
    expect(wantsFixPhoto({ status: "VERIFIED", photoCount: 0 })).toBe(true);
  });

  it("does not nag an open item, or one that has a photo", () => {
    expect(wantsFixPhoto({ status: "OPEN", photoCount: 0 })).toBe(false);
    expect(wantsFixPhoto({ status: "READY_FOR_REVIEW", photoCount: 1 })).toBe(false);
  });
});

describe("which capability a move takes", () => {
  it("lets the field say it is fixed", () => {
    expect(capabilityForStatus("READY_FOR_REVIEW", "OPEN")).toBe("MANAGE_FIELD");
  });

  it("needs the second signature to agree it is", () => {
    expect(capabilityForStatus("VERIFIED", "READY_FOR_REVIEW")).toBe("VERIFY_PUNCH_ITEMS");
  });

  it("lets the field send back the crew's own claim", () => {
    expect(capabilityForStatus("OPEN", "READY_FOR_REVIEW")).toBe("MANAGE_FIELD");
  });

  it("does NOT let the field undo somebody's verification", () => {
    // The asymmetry is the point: reversing a signature takes whatever
    // could have signed it.
    expect(capabilityForStatus("OPEN", "VERIFIED")).toBe("VERIFY_PUNCH_ITEMS");
  });
});
