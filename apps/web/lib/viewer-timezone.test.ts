import { describe, expect, it } from "vitest";
import {
  isSupportedTimeZone,
  resolveViewerTimeZone,
  todayInZone,
} from "./viewer-timezone";

/**
 * Issue #111 item 1. The alert engine decided what day it was from the
 * SERVER's UTC clock, so at 18:00 in Los Angeles a follow-up due tomorrow
 * read "Due today" and one due today flipped to OVERDUE with the bell
 * counting it. These are the two hours a day the old code got wrong.
 */
describe("todayInZone", () => {
  it("is still yesterday's date west of UTC after UTC midnight", () => {
    // 18:00 Tuesday in Los Angeles is already Wednesday in UTC. Every date
    // in this app is a plain calendar day, so the day to compare against is
    // the one on the viewer's wall calendar, not the server's.
    const evening = new Date("2026-09-03T01:00:00.000Z");
    expect(todayInZone("America/Los_Angeles", evening)).toBe("2026-09-02");
    expect(todayInZone("UTC", evening)).toBe("2026-09-03");
  });

  it("is already tomorrow's date east of UTC before UTC midnight", () => {
    // The mirror image, and the reason this is a zone and not a one-way
    // subtraction: 09:00 in Tokyo is the previous afternoon in UTC.
    const morning = new Date("2026-09-03T00:00:00.000Z");
    expect(todayInZone("Asia/Tokyo", morning)).toBe("2026-09-03");
    expect(todayInZone("UTC", new Date("2026-09-02T23:00:00.000Z"))).toBe("2026-09-02");
    expect(todayInZone("Asia/Tokyo", new Date("2026-09-02T23:00:00.000Z"))).toBe("2026-09-03");
  });

  it("crosses the year on the viewer's calendar, not the server's", () => {
    // The case components/localToday.ts calls out: on 31 December this is
    // what picks the wrong year, and on a safety log the wrong case-number
    // series with it.
    expect(todayInZone("America/Los_Angeles", new Date("2027-01-01T05:00:00.000Z"))).toBe(
      "2026-12-31",
    );
  });

  it("pads to a sortable ISO day, because every comparison here is a string one", () => {
    // daysUntil and every `date <= todayIso` in lib/alerts.ts compare these
    // as strings. "2026-9-3" would sort wrong against "2026-08-30".
    expect(todayInZone("UTC", new Date("2026-09-03T12:00:00.000Z"))).toBe("2026-09-03");
    expect(todayInZone("UTC", new Date("2026-11-30T12:00:00.000Z"))).toBe("2026-11-30");
  });
});

describe("isSupportedTimeZone", () => {
  it("accepts a real zone", () => {
    expect(isSupportedTimeZone("America/Los_Angeles")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
  });

  it("refuses anything that is not one", () => {
    // The value arrives on a cookie, which the caller controls.
    expect(isSupportedTimeZone("Mars/Olympus_Mons")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
    expect(isSupportedTimeZone(null)).toBe(false);
    expect(isSupportedTimeZone(undefined)).toBe(false);
    expect(isSupportedTimeZone("America/Los_Angeles; DROP")).toBe(false);
  });
});

describe("resolveViewerTimeZone", () => {
  it("takes the first candidate that is a real zone", () => {
    // Cookie first (what the browser actually reports), then Vercel's
    // geo-IP header, then UTC.
    expect(resolveViewerTimeZone(["America/Denver", "Europe/Berlin"])).toBe("America/Denver");
    expect(resolveViewerTimeZone([null, "Europe/Berlin"])).toBe("Europe/Berlin");
    expect(resolveViewerTimeZone(["nonsense", "Europe/Berlin"])).toBe("Europe/Berlin");
  });

  it("falls back to UTC rather than throwing", () => {
    // No cookie yet and no header is the normal state of the very first
    // request. UTC is what this app did before, so the fallback is the old
    // behaviour rather than a new failure mode.
    expect(resolveViewerTimeZone([])).toBe("UTC");
    expect(resolveViewerTimeZone([null, undefined, ""])).toBe("UTC");
  });
});
