import { describe, expect, it } from "vitest";
import { dayLabel, daysBetween, parseDateWords, relativeToToday } from "./dates";

/**
 * Every phrase the schedule command accepts, against fixed todays. A
 * relative phrase that is not on this list is not supported, and the
 * command asks for the date instead — which is the rule, not a gap.
 *
 * The weekdays here were worked out by hand from 1 January 2026 being a
 * Thursday, then pinned; a test that derived them from the code under
 * test would pass whatever the code did.
 */
const FRIDAY = "2026-09-11";
const MONDAY = "2026-09-14";
const SUNDAY_IN_DECEMBER = "2026-12-20";

const on = (day: string) => ({ kind: "on", day });

describe("parseDateWords — a calendar day", () => {
  it("reads every way people write October 6 as the same day, this year when it is still ahead", () => {
    for (const text of [
      "2026-10-06",
      "10/6",
      "10/06",
      "10/6/2026",
      "10/6/26",
      "October 6",
      "october 6",
      "Oct 6",
      "Oct. 6",
      "Oct 6.",
      "October 6th",
      "6 October",
      "6th of October",
      "the 6th of October",
      "October 6, 2026",
      "Oct 6 2026",
      "6 October 2026",
      "to October 6",
      "on 10/6",
      "by October 6",
      "until Oct 6",
      "  October   6  ",
      '"October 6"',
    ]) {
      expect(parseDateWords(text, FRIDAY), text).toEqual(on("2026-10-06"));
    }
  });

  it("takes today's own month-day as today, not next year", () => {
    expect(parseDateWords("9/11", FRIDAY)).toEqual(on("2026-09-11"));
    expect(parseDateWords("September 11", FRIDAY)).toEqual(on("2026-09-11"));
  });

  it("keeps a year the person said, even in the past", () => {
    expect(parseDateWords("September 1, 2026", FRIDAY)).toEqual(on("2026-09-01"));
    expect(parseDateWords("1/20/2026", FRIDAY)).toEqual(on("2026-01-20"));
    expect(parseDateWords("2025-03-15", FRIDAY)).toEqual(on("2025-03-15"));
  });

  it("offers both years for a month-day that has already passed this year, rather than picking one", () => {
    expect(parseDateWords("September 1", FRIDAY)).toEqual({
      kind: "which-year",
      thisYear: "2026-09-01",
      nextYear: "2027-09-01",
    });
    expect(parseDateWords("9/1", FRIDAY)).toEqual({ kind: "which-year", thisYear: "2026-09-01", nextYear: "2027-09-01" });
    expect(parseDateWords("1st of September", FRIDAY)).toEqual({
      kind: "which-year",
      thisYear: "2026-09-01",
      nextYear: "2027-09-01",
    });
    // Said in December about January: the same question, deliberately —
    // the chips make it one tap, and nothing here decides it for them.
    expect(parseDateWords("January 5", SUNDAY_IN_DECEMBER)).toEqual({
      kind: "which-year",
      thisYear: "2026-01-05",
      nextYear: "2027-01-05",
    });
  });

  it("reads today and tomorrow", () => {
    expect(parseDateWords("today", FRIDAY)).toEqual(on("2026-09-11"));
    expect(parseDateWords("tomorrow", FRIDAY)).toEqual(on("2026-09-12"));
    expect(parseDateWords("Tomorrow", SUNDAY_IN_DECEMBER)).toEqual(on("2026-12-21"));
  });

  it("reads a weekday as the first one strictly after today, with or without 'next'", () => {
    expect(parseDateWords("Monday", FRIDAY)).toEqual(on("2026-09-14"));
    expect(parseDateWords("next Monday", FRIDAY)).toEqual(on("2026-09-14"));
    expect(parseDateWords("next mon", FRIDAY)).toEqual(on("2026-09-14"));
    expect(parseDateWords("Saturday", FRIDAY)).toEqual(on("2026-09-12"));
    expect(parseDateWords("Thursday", FRIDAY)).toEqual(on("2026-09-17"));
    // The same weekday as today is a week away, never today.
    expect(parseDateWords("Friday", FRIDAY)).toEqual(on("2026-09-18"));
    expect(parseDateWords("next fri", FRIDAY)).toEqual(on("2026-09-18"));
    expect(parseDateWords("next Monday", MONDAY)).toEqual(on("2026-09-21"));
    expect(parseDateWords("Tuesday", MONDAY)).toEqual(on("2026-09-15"));
  });

  it("counts 'in N days/weeks' from today", () => {
    expect(parseDateWords("in 3 days", FRIDAY)).toEqual(on("2026-09-14"));
    expect(parseDateWords("in 1 day", FRIDAY)).toEqual(on("2026-09-12"));
    expect(parseDateWords("in a week", FRIDAY)).toEqual(on("2026-09-18"));
    expect(parseDateWords("in two weeks", FRIDAY)).toEqual(on("2026-09-25"));
    expect(parseDateWords("in 2 weeks", SUNDAY_IN_DECEMBER)).toEqual(on("2027-01-03"));
  });
});

describe("parseDateWords — a move relative to the date already on the job", () => {
  it("knows the direction when the words give one", () => {
    for (const text of ["a week later", "one week later", "1 week later", "out a week", "a week out", "a week ahead", "later by a week", "forward a week"]) {
      expect(parseDateWords(text, FRIDAY), text).toEqual({ kind: "shift", days: 7 });
    }
    expect(parseDateWords("2 weeks later", FRIDAY)).toEqual({ kind: "shift", days: 14 });
    expect(parseDateWords("forward 2 weeks", FRIDAY)).toEqual({ kind: "shift", days: 14 });
    expect(parseDateWords("3 days earlier", FRIDAY)).toEqual({ kind: "shift", days: -3 });
    expect(parseDateWords("earlier by 3 days", FRIDAY)).toEqual({ kind: "shift", days: -3 });
    expect(parseDateWords("two weeks sooner", FRIDAY)).toEqual({ kind: "shift", days: -14 });
    expect(parseDateWords("ten days later", FRIDAY)).toEqual({ kind: "shift", days: 10 });
  });

  it("asks which way for 'back' and for a bare duration, because English does not say", () => {
    for (const text of ["back a week", "a week back", "back by a week", "backwards a week", "a week", "by a week", "one week"]) {
      expect(parseDateWords(text, FRIDAY), text).toEqual({ kind: "shift-either-way", days: 7 });
    }
    expect(parseDateWords("back by 2 weeks", FRIDAY)).toEqual({ kind: "shift-either-way", days: 14 });
    expect(parseDateWords("3 days", FRIDAY)).toEqual({ kind: "shift-either-way", days: 3 });
  });
});

describe("parseDateWords — refusals", () => {
  it("returns null for everything that would need a guess", () => {
    for (const text of [
      "",
      "   ",
      undefined,
      "in a month",
      "a month later",
      "next week",
      "this Monday",
      "soon",
      "asap",
      "end of the month",
      "0 days later",
      "week",
      "next",
      "Octember 6",
      "February 30",
      "2026-02-30",
      "6/31",
      "13/6",
      "10/6/2026/1",
      "a couple of weeks",
      "October",
      "the 6th",
      "next Monday or Tuesday",
    ]) {
      expect(parseDateWords(text, FRIDAY), String(text)).toBeNull();
    }
  });
});

describe("dayLabel, daysBetween and relativeToToday", () => {
  it("renders a day in UTC with its weekday beside it", () => {
    expect(dayLabel("2026-10-06")).toBe("Oct 6, 2026 (Tuesday)");
    expect(dayLabel("2026-09-12")).toBe("Sep 12, 2026 (Saturday)");
    expect(dayLabel("2027-01-03")).toBe("Jan 3, 2027 (Sunday)");
  });

  it("counts whole days either way", () => {
    expect(daysBetween("2026-10-01", "2026-10-08")).toBe(7);
    expect(daysBetween("2026-10-08", "2026-10-01")).toBe(-7);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
    expect(daysBetween(FRIDAY, FRIDAY)).toBe(0);
  });

  it("says how far a day is from today, for a chip's detail", () => {
    expect(relativeToToday("2026-09-01", FRIDAY)).toBe("10 days ago");
    expect(relativeToToday("2027-09-01", FRIDAY)).toBe("in 355 days");
    expect(relativeToToday("2026-09-12", FRIDAY)).toBe("in 1 day");
    expect(relativeToToday("2026-09-10", FRIDAY)).toBe("1 day ago");
    expect(relativeToToday(FRIDAY, FRIDAY)).toBe("today");
  });
});
