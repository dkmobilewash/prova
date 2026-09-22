import { describe, expect, it } from "vitest";
import { localToday } from "./local-today";

/**
 * The bug this is for, seen on a device: at 18:03 Mountain the UTC date
 * is already tomorrow, so the schedule called today "past" and accused a
 * day still being worked of having no hours logged.
 */
describe("what day it is where the phone is", () => {
  it("is the local calendar date, not the UTC one", () => {
    // 2026-09-20 18:03 in a UTC-6 zone is 2026-09-21T00:03Z.
    const evening = new Date("2026-09-21T00:03:00.000Z");
    const offsetMinutes = evening.getTimezoneOffset();
    const expected = new Date(evening.getTime() - offsetMinutes * 60_000).toISOString().slice(0, 10);
    expect(localToday(evening)).toBe(expected);
  });

  it("gives a plain YYYY-MM-DD, which is what the API and the cache keys take", () => {
    expect(localToday(new Date("2026-03-09T15:00:00.000Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not drift across a midday call", () => {
    const noonish = new Date("2026-06-15T18:00:00.000Z");
    expect(localToday(noonish)).toBe(localToday(noonish));
  });
});
