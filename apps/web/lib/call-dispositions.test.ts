import { describe, expect, it } from "vitest";
import {
  CALL_DISPOSITIONS,
  CALL_DISPOSITION_LABEL,
  CALL_FOLLOW_UP_DAYS,
  callScoreboard,
  callSummary,
  dispositionOf,
  doNotCallFrom,
  noteOf,
} from "./call-dispositions";

describe("a call's summary carries its disposition as a tag", () => {
  it("round-trips every disposition with and without a note", () => {
    for (const d of CALL_DISPOSITIONS) {
      expect(dispositionOf(callSummary(d, ""))).toBe(d);
      expect(dispositionOf(callSummary(d, "  asked for Thursday  "))).toBe(d);
      expect(noteOf(callSummary(d, "  asked for Thursday  "))).toBe("asked for Thursday");
    }
  });

  it("reads a hand-typed summary as untagged rather than guessing", () => {
    expect(dispositionOf("Spoke to the office manager")).toBeNull();
    expect(dispositionOf("[MAYBE] something")).toBeNull();
    expect(noteOf("Spoke to the office manager")).toBe("Spoke to the office manager");
  });

  it("has a label and a follow-up rule for every disposition, so a new one cannot be added silently", () => {
    for (const d of CALL_DISPOSITIONS) {
      expect(CALL_DISPOSITION_LABEL[d]).toBeTruthy();
      expect(d in CALL_FOLLOW_UP_DAYS).toBe(true);
    }
  });
});

describe("the day's scoreboard", () => {
  it("counts dials, connects, conversations and meetings the way the playbook does", () => {
    const board = callScoreboard([
      callSummary("NO_ANSWER", ""),
      callSummary("NO_ANSWER", ""),
      callSummary("VOICEMAIL", ""),
      callSummary("GATEKEEPER", "office manager, call back at 7"),
      callSummary("CONVERSATION", "does payroll in-house"),
      callSummary("MEETING_BOOKED", "Thu 10"),
      callSummary("NOT_NOW", "after the Kaiser job"),
      callSummary("WRONG_NUMBER", ""),
      "typed by hand",
    ]);
    expect(board.dials).toBe(9);
    expect(board.connects).toBe(5);
    expect(board.conversations).toBe(3);
    expect(board.meetings).toBe(1);
    expect(board.untagged).toBe(1);
    expect(board.byDisposition.NO_ANSWER).toBe(2);
  });

  it("is all zeros on an empty day, not NaN", () => {
    const board = callScoreboard([]);
    expect(board).toMatchObject({ dials: 0, connects: 0, conversations: 0, meetings: 0, untagged: 0 });
  });
});

describe("do not call is read off the latest call only", () => {
  it("sticks when the latest call said stop, and not when a later call overrode it", () => {
    const stop = { type: "CALL", summary: callSummary("DO_NOT_CALL", "") };
    const talk = { type: "CALL", summary: callSummary("CONVERSATION", "") };
    const note = { type: "NOTE", summary: "reminder" };
    expect(doNotCallFrom([note, stop, talk])).toBe(true);
    expect(doNotCallFrom([talk, stop])).toBe(false);
    expect(doNotCallFrom([note])).toBe(false);
    expect(doNotCallFrom([])).toBe(false);
  });
});
