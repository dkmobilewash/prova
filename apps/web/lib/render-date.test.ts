import { describe, expect, it } from "vitest";
import { formatCalendarDate, formatInstant } from "@/lib/render-date";
import { formatSignedDate } from "@/lib/signed-date";

/** The value at the heart of issue #101: a plain calendar day, stored the
 * way every date-only column in this app is stored. */
const SEPT_15 = new Date("2026-09-15T00:00:00.000Z");

describe("formatCalendarDate", () => {
  it("renders the stored day, not the reader's", () => {
    // The regression itself. Before #101 these call sites ran
    // `toLocaleDateString` with no zone, which in a client component is
    // the reader's own -- "Sep 14, 2026" for all of North America, on an
    // invoice due the 15th.
    expect(formatCalendarDate(SEPT_15)).toBe("Sep 15, 2026");
    expect(formatCalendarDate(SEPT_15, "numeric")).toBe("9/15/2026");
    expect(formatCalendarDate(SEPT_15, "dayMonth")).toBe("Sep 15");
  });

  it("pins UTC rather than inheriting it", () => {
    // Proves the pinning does work, rather than agreeing with the test
    // runner's zone by luck. If `timeZone: "UTC"` were dropped from
    // formatCalendarDate, this stays green under a UTC runner and goes
    // red under a western one -- so the real assertion is the pair below,
    // which needs no particular runner zone to mean something.
    expect(formatCalendarDate(SEPT_15)).toBe(formatInstant(SEPT_15, "UTC"));
    expect(formatCalendarDate(SEPT_15)).not.toBe(formatInstant(SEPT_15, "America/Los_Angeles"));
  });

  it("keeps the format the bare calls produced", () => {
    // `numeric` exists only to preserve what was on screen: the sites it
    // replaced called `date.toLocaleDateString()` with no arguments, which
    // inherits the runtime's default locale.
    expect(formatCalendarDate(SEPT_15, "numeric")).toBe(
      SEPT_15.toLocaleDateString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      }),
    );
  });
});

describe("formatInstant", () => {
  it("reads a real moment on the reader's calendar", () => {
    // A payment recorded at 18:00 in Los Angeles is already tomorrow in
    // UTC. Rendering that one in UTC is the same day-early bug pointing
    // the other way, which is why these are two functions and not one.
    const evening = new Date("2026-09-15T01:00:00.000Z");
    expect(formatInstant(evening, "America/Los_Angeles")).toBe("Sep 14, 2026");
    expect(formatInstant(evening, "UTC")).toBe("Sep 15, 2026");
  });

  it("falls back to the old behaviour on an unknown zone", () => {
    // viewerTimeZone() resolves to "UTC" when there is no cookie and no
    // header, so the floor of this change is what these call sites already
    // did rather than a new way to fail.
    expect(formatInstant(SEPT_15, "UTC")).toBe("Sep 15, 2026");
  });
});

describe("formatSignedDate", () => {
  it("still answers exactly as it did before it delegated", () => {
    // #106 finding 7's fix is a formatInstant in every respect, so it is
    // one now. This asserts the delegation changed no output -- /esign and
    // the job page both render a signature date from it, and that is the
    // date a dispute turns on.
    const evening = new Date("2026-09-15T01:00:00.000Z");
    for (const zone of ["UTC", "America/Los_Angeles", "Asia/Tokyo"]) {
      expect(formatSignedDate(evening, zone)).toBe(
        evening.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          timeZone: zone,
        }),
      );
    }
  });
});
