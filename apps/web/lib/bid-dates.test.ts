import { describe, expect, it } from "vitest";
import {
  bidDatesFromForm,
  bidDatesProblem,
  calendarDay,
  dayAndTime,
  formatClock,
  minuteOfDay,
  timeInputValue,
  upcomingBidDates,
} from "./bid-dates";
import { bidsDueSoon } from "./bids-due-soon";

const utc = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("times of day", () => {
  it("parses HH:MM into minutes after midnight and refuses anything else", () => {
    expect(minuteOfDay("14:00")).toBe(840);
    expect(minuteOfDay("00:00")).toBe(0);
    expect(minuteOfDay("23:59")).toBe(1439);
    expect(minuteOfDay("")).toBeNull();
    expect(minuteOfDay("24:00")).toBe("invalid");
    expect(minuteOfDay("12:60")).toBe("invalid");
    expect(minuteOfDay("2pm")).toBe("invalid");
  });

  it("formats the way a GC writes it", () => {
    expect(formatClock(840)).toBe("2:00 PM");
    expect(formatClock(0)).toBe("12:00 AM");
    expect(formatClock(720)).toBe("12:00 PM");
    expect(formatClock(9 * 60 + 5)).toBe("9:05 AM");
    expect(formatClock(1439)).toBe("11:59 PM");
  });

  it("round-trips through a time input", () => {
    expect(timeInputValue(840)).toBe("14:00");
    expect(timeInputValue(65)).toBe("01:05");
    expect(timeInputValue(null)).toBe("");
    for (const m of [0, 1, 59, 60, 720, 1439]) expect(minuteOfDay(timeInputValue(m))).toBe(m);
  });

  it("labels the day with its weekday, UTC, and the time when there is one", () => {
    // 2026-10-29 is a Thursday.
    expect(dayAndTime("2026-10-29", 840)).toBe("Thu 2:00 PM");
    expect(dayAndTime("2026-10-29", null)).toBe("Thu");
  });
});

describe("calendar days", () => {
  it("is UTC midnight, empty is null, and an impossible day is invalid", () => {
    expect(calendarDay("2026-10-29")?.toString()).toBe(utc("2026-10-29").toString());
    expect(calendarDay("")).toBeNull();
    expect(calendarDay("2026-02-30")).toBe("invalid");
    expect(calendarDay("10/29/2026")).toBe("invalid");
  });
});

describe("bidDatesProblem", () => {
  const none = { dueDate: null, dueMinute: null, walkDate: null, walkMinute: null, rfiCutoffDate: null };
  it("accepts all-empty and fully filled", () => {
    expect(bidDatesProblem(none)).toBeNull();
    expect(
      bidDatesProblem({
        dueDate: utc("2026-10-29"),
        dueMinute: 840,
        walkDate: utc("2026-10-26"),
        walkMinute: 540,
        rfiCutoffDate: utc("2026-10-27"),
      }),
    ).toBeNull();
  });
  it("refuses a time with no day", () => {
    expect(bidDatesProblem({ ...none, dueMinute: 840 })).toMatch(/due date/);
    expect(bidDatesProblem({ ...none, walkMinute: 540 })).toMatch(/job walk date/);
  });
  it("refuses a minute outside the day", () => {
    expect(bidDatesProblem({ ...none, dueDate: utc("2026-10-29"), dueMinute: 1440 })).toMatch(/time of day/);
    expect(bidDatesProblem({ ...none, dueDate: utc("2026-10-29"), dueMinute: -1 })).toMatch(/time of day/);
  });
});

describe("upcomingBidDates (the 7-day flag)", () => {
  const today = "2026-10-25";
  it("flags a walk and an RFI cutoff inside a week, soonest first, with the time", () => {
    const out = upcomingBidDates(
      { walkDate: utc("2026-10-28"), walkMinute: 540, rfiCutoffDate: utc("2026-10-26") },
      today,
    );
    expect(out.map((u) => u.label)).toEqual(["RFIs close tomorrow", "Job walk Wed 9:00 AM"]);
  });
  it("includes today and day 7, excludes yesterday and day 8", () => {
    expect(upcomingBidDates({ walkDate: utc("2026-10-25"), walkMinute: null, rfiCutoffDate: null }, today)[0]?.label).toBe(
      "Job walk today",
    );
    expect(upcomingBidDates({ walkDate: null, walkMinute: null, rfiCutoffDate: utc("2026-11-01") }, today)).toHaveLength(1);
    expect(upcomingBidDates({ walkDate: null, walkMinute: null, rfiCutoffDate: utc("2026-11-02") }, today)).toHaveLength(0);
    expect(upcomingBidDates({ walkDate: utc("2026-10-24"), walkMinute: null, rfiCutoffDate: null }, today)).toHaveLength(0);
  });
  it("is empty with no dates", () => {
    expect(upcomingBidDates({ walkDate: null, walkMinute: null, rfiCutoffDate: null }, today)).toEqual([]);
  });
});

describe("bidsDueSoon carries the time and the flags", () => {
  const bid = (over: object) => ({
    id: "b1",
    projectName: "Oak Ave",
    status: "INVITED",
    dueDate: utc("2026-10-29"),
    contact: { name: "Acme GC" },
    ...over,
  });
  it("carries dueMinute and upcoming dates through", () => {
    const [row] = bidsDueSoon([bid({ dueMinute: 840, walkDate: utc("2026-10-27") })], "2026-10-25");
    expect(row?.dueMinute).toBe(840);
    expect(row?.upcoming.map((u) => u.kind)).toEqual(["walk"]);
  });
  it("uses the EDITED due date: moving it out of range drops the bid, moving it in adds it", () => {
    expect(bidsDueSoon([bid({ dueDate: utc("2026-12-30") })], "2026-10-25")).toHaveLength(0);
    expect(bidsDueSoon([bid({ dueDate: utc("2026-11-03") })], "2026-10-25")[0]?.daysLeft).toBe(9);
  });
});

describe("bidDatesFromForm", () => {
  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.set(k, v);
    return fd;
  };
  it("parses every field", () => {
    const r = bidDatesFromForm(
      form({ dueDate: "2026-10-29", dueTime: "14:00", walkDate: "2026-10-26", walkTime: "09:30", rfiCutoffDate: "2026-10-27" }),
    );
    expect(r).toMatchObject({ ok: true, value: { dueMinute: 840, walkMinute: 570 } });
  });
  it("blank is all null", () => {
    expect(bidDatesFromForm(form({}))).toEqual({
      ok: true,
      value: { dueDate: null, dueMinute: null, walkDate: null, walkMinute: null, rfiCutoffDate: null },
    });
  });
  it("names the field that is wrong", () => {
    expect(bidDatesFromForm(form({ dueDate: "nope" }))).toMatchObject({ ok: false, error: /due date/ });
    expect(bidDatesFromForm(form({ rfiCutoffDate: "2026-13-01" }))).toMatchObject({ ok: false, error: /RFI cutoff/ });
    expect(bidDatesFromForm(form({ dueDate: "2026-10-29", dueTime: "25:00" }))).toMatchObject({ ok: false, error: /due time/ });
    expect(bidDatesFromForm(form({ dueTime: "14:00" }))).toMatchObject({ ok: false, error: /due date/ });
  });
});
