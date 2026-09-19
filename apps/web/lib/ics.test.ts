import { describe, expect, it } from "vitest";
import { buildCrewScheduleCalendar, escapeIcsText, foldIcsLine, nextDay, type CrewCalendarEvent } from "@/lib/ics";

/**
 * The ICS module is pure — no database, no clock beyond what a caller
 * passes in — so every RFC 5545 rule it claims to follow is checked
 * byte-for-byte here rather than trusted from the header comment.
 */

const EVENT: CrewCalendarEvent = {
  uid: "crew-job_1-20260922@cstream.ai",
  date: "2026-09-22",
  summary: "Westfield Plaza — Ana Ruiz (Finisher)",
  description: "Ana Ruiz: bring the lift",
  location: "500 Main St",
  updatedAt: new Date("2026-09-19T14:30:05.000Z"),
};

describe("buildCrewScheduleCalendar — golden output", () => {
  it("renders one event exactly, CRLF throughout, no trailing bare LF", () => {
    const ics = buildCrewScheduleCalendar([EVENT], { calendarName: "Acme Drywall crew schedule" });

    const expected =
      "BEGIN:VCALENDAR\r\n" +
      "VERSION:2.0\r\n" +
      "PRODID:-//C Stream//Crew Schedule//EN\r\n" +
      "CALSCALE:GREGORIAN\r\n" +
      "METHOD:PUBLISH\r\n" +
      "X-WR-CALNAME:Acme Drywall crew schedule\r\n" +
      "X-PUBLISHED-TTL:PT1H\r\n" +
      "BEGIN:VEVENT\r\n" +
      "UID:crew-job_1-20260922@cstream.ai\r\n" +
      "DTSTAMP:20260919T143005Z\r\n" +
      "DTSTART;VALUE=DATE:20260922\r\n" +
      "DTEND;VALUE=DATE:20260923\r\n" +
      "SUMMARY:Westfield Plaza — Ana Ruiz (Finisher)\r\n" +
      "LOCATION:500 Main St\r\n" +
      "DESCRIPTION:Ana Ruiz: bring the lift\r\n" +
      "END:VEVENT\r\n" +
      "END:VCALENDAR\r\n";

    expect(ics).toBe(expected);
    // No bare LF anywhere — every line ending is CRLF.
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("omits LOCATION and DESCRIPTION when the event has neither", () => {
    const bare: CrewCalendarEvent = { ...EVENT, location: null, description: null };
    const ics = buildCrewScheduleCalendar([bare], { calendarName: "X" });
    expect(ics).not.toContain("LOCATION:");
    expect(ics).not.toContain("DESCRIPTION:");
  });

  it("renders an empty calendar (no events) as just the wrapper", () => {
    const ics = buildCrewScheduleCalendar([], { calendarName: "Empty" });
    expect(ics).toBe(
      "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//C Stream//Crew Schedule//EN\r\nCALSCALE:GREGORIAN\r\n" +
        "METHOD:PUBLISH\r\nX-WR-CALNAME:Empty\r\nX-PUBLISHED-TTL:PT1H\r\nEND:VCALENDAR\r\n",
    );
  });
});

describe("escapeIcsText", () => {
  it("escapes backslash, semicolon, comma and newline per RFC 5545 §3.3.11", () => {
    expect(escapeIcsText("a\\b")).toBe("a\\\\b");
    expect(escapeIcsText("a;b")).toBe("a\\;b");
    expect(escapeIcsText("a,b")).toBe("a\\,b");
    expect(escapeIcsText("a\nb")).toBe("a\\nb");
    expect(escapeIcsText("a\r\nb")).toBe("a\\nb");
  });

  it("escapes backslash FIRST, so an already-escaped semicolon is not double-escaped wrong", () => {
    // A literal input of `a\;b` (backslash then semicolon) must become
    // `a\\\;b` — the backslash escaped, then the semicolon escaped
    // independently — never collapsed into one token.
    expect(escapeIcsText("a\\;b")).toBe("a\\\\\\;b");
  });

  it("round-trips into a calendar without corrupting a job name with real punctuation", () => {
    const event: CrewCalendarEvent = {
      ...EVENT,
      summary: "Smith; Jones, LLC — Phase 2\\3",
      description: null,
      location: null,
    };
    const ics = buildCrewScheduleCalendar([event], { calendarName: "X" });
    expect(ics).toContain("SUMMARY:Smith\\; Jones\\, LLC — Phase 2\\\\3\r\n");
  });
});

describe("foldIcsLine", () => {
  it("does not fold a line at or under 75 octets", () => {
    const line = "SUMMARY:" + "a".repeat(67); // exactly 75 octets
    expect(Buffer.byteLength(line, "utf8")).toBe(75);
    expect(foldIcsLine(line)).toEqual([line]);
  });

  it("folds a line over 75 octets, continuation lines prefixed with one space", () => {
    const line = "SUMMARY:" + "a".repeat(100);
    const folded = foldIcsLine(line);
    expect(folded.length).toBeGreaterThan(1);
    expect(folded[0].length).toBe(75);
    for (const cont of folded.slice(1)) {
      expect(cont[0]).toBe(" ");
      expect(Buffer.byteLength(cont, "utf8")).toBeLessThanOrEqual(75);
    }
    // Re-joining (stripping the fold) reconstructs the original line.
    expect(folded[0] + folded.slice(1).map((c) => c.slice(1)).join("")).toBe(line);
  });

  it("folds by OCTETS, not characters — never splitting a multi-byte UTF-8 character", () => {
    // é is 2 bytes in UTF-8. Force the 75-byte boundary to fall inside one.
    const prefix = "SUMMARY:" + "a".repeat(66); // 74 bytes
    const line = prefix + "é" + "b".repeat(10); // boundary lands mid-character
    const folded = foldIcsLine(line);
    // Every produced line must be valid UTF-8 — Buffer.from(...).toString()
    // round-tripping without the replacement character (�) is the
    // check; a split character would introduce one.
    for (const part of folded) {
      expect(part).not.toContain("�");
    }
    // Reassembling still reconstructs byte-for-byte.
    const rebuilt = folded[0] + folded.slice(1).map((c) => c.slice(1)).join("");
    expect(rebuilt).toBe(line);
    // The first line must be AT MOST 75 octets (it may be less than 75
    // when backing off from a split character).
    expect(Buffer.byteLength(folded[0], "utf8")).toBeLessThanOrEqual(75);
  });

  it("applies folding through the whole-calendar builder on a long summary", () => {
    const longName = "A very long job name that goes on and on and on past the 75-octet content line limit";
    const event: CrewCalendarEvent = { ...EVENT, summary: longName, description: null, location: null };
    const ics = buildCrewScheduleCalendar([event], { calendarName: "X" });
    const lines = ics.split("\r\n");
    // No content line (before the trailing empty string from the final
    // \r\n) exceeds 75 octets.
    for (const line of lines) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    // The folded SUMMARY starts on its own line and continues on a line
    // beginning with a single space.
    const summaryStart = lines.findIndex((l) => l.startsWith("SUMMARY:"));
    expect(summaryStart).toBeGreaterThanOrEqual(0);
    expect(lines[summaryStart + 1].startsWith(" ")).toBe(true);
  });
});

describe("nextDay", () => {
  it("advances one calendar day in UTC, never shifted by DST (which UTC has none of)", () => {
    expect(nextDay("2026-09-22")).toBe("2026-09-23");
    // A month boundary.
    expect(nextDay("2026-09-30")).toBe("2026-10-01");
    // A year boundary.
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});

describe("UID stability — the whole point of a subscribable feed", () => {
  it("the same event, re-rendered with a different DTSTAMP, keeps the same UID", () => {
    const first = buildCrewScheduleCalendar([EVENT], { calendarName: "X" });
    const later: CrewCalendarEvent = { ...EVENT, updatedAt: new Date("2026-09-20T00:00:00Z"), description: "changed" };
    const second = buildCrewScheduleCalendar([later], { calendarName: "X" });
    const uidOf = (ics: string) => /UID:([^\r\n]+)/.exec(ics)?.[1];
    expect(uidOf(first)).toBe(uidOf(second));
    expect(uidOf(first)).toBe(EVENT.uid);
    // But the DTSTAMP and DESCRIPTION DID change — this is an update, not
    // a no-op — which is what makes a subscribing client replace the old
    // event rather than ignore the new body.
    expect(first).not.toBe(second);
  });

  it("unchanged data produces a byte-identical response between polls", () => {
    const a = buildCrewScheduleCalendar([EVENT], { calendarName: "X" });
    const b = buildCrewScheduleCalendar([{ ...EVENT }], { calendarName: "X" });
    expect(a).toBe(b);
  });
});
