/**
 * ICS (RFC 5545) generation for the crew-schedule calendar feed. Pure —
 * no database, no clock — so every formatting rule here is testable
 * byte-for-byte (ics.test.ts holds a golden file against it).
 *
 * THE EVENTS ARE ALL-DAY `VALUE=DATE` EVENTS, AND THAT IS THE TIMEZONE
 * DESIGN, NOT A SHORTCUT. This app stores every date that matters at UTC
 * midnight and renders it in UTC (CLAUDE.md "Dates") — a CrewScheduleDay
 * is a CALENDAR DAY, "Tuesday the 22nd", not an instant. An ICS DATE
 * value is exactly that: calendar apps pin it to the day with no timezone
 * conversion, so a foreman in any timezone sees the day the office
 * planned. Rendering DTSTART as a UTC DATETIME instead would show the
 * previous evening across the western hemisphere.
 *
 * UIDs ARE STABLE ACROSS REFRESHES. A calendar client replaces an event
 * whose UID it has seen before, so the same (job, day) must always emit
 * the same UID — that is what makes an edited note UPDATE the subscriber's
 * event rather than duplicate it. The UID is job id + day, deliberately
 * containing nothing that changes when the crew or the note does.
 */

/** One rendered event: one job, one day, however many workers. */
export type CrewCalendarEvent = {
  /** Stable identity: same job + day, same uid, every refresh. */
  uid: string;
  /** The calendar day, as YYYY-MM-DD. */
  date: string;
  summary: string;
  description: string | null;
  location: string | null;
  /** Drives DTSTAMP and SEQUENCE-free replacement: the newest updatedAt
   * of the rows in the event, so the stamp only moves when the data did
   * and the output stays byte-identical between polls of unchanged data
   * (some clients re-notify on every DTSTAMP change). */
  updatedAt: Date;
};

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline are escaped
 * in TEXT values. CR is dropped (a lone CR is not representable). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n/g, "\\n")
    .replace(/[\r\n]/g, "\\n");
}

/**
 * RFC 5545 §3.1: a content line SHOULD NOT be longer than 75 octets
 * excluding CRLF; longer lines are folded with CRLF + one space, and the
 * measure is OCTETS of UTF-8, not characters — so the fold walks bytes
 * and never splits inside a multi-byte character (a job name with an
 * accent must not become mojibake in somebody's calendar).
 */
export function foldIcsLine(line: string): string[] {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return [line];
  const parts: string[] = [];
  let start = 0;
  let first = true;
  while (start < bytes.length) {
    // Continuation lines carry a leading space that counts toward 75.
    const budget = first ? 75 : 74;
    let end = Math.min(start + budget, bytes.length);
    // Back off to a UTF-8 boundary: a continuation byte is 0b10xxxxxx.
    while (end > start && end < bytes.length && (bytes[end] & 0b1100_0000) === 0b1000_0000) end--;
    parts.push((first ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end;
    first = false;
  }
  return parts;
}

function icsDate(date: string): string {
  return date.replace(/-/g, "");
}

/** The day after `date`, for DTEND — an ICS all-day event's end is
 * EXCLUSIVE. Done in UTC arithmetic so it cannot shift across a DST
 * boundary that UTC does not have. */
export function nextDay(date: string): string {
  const next = new Date(new Date(`${date}T00:00:00.000Z`).getTime() + 86_400_000);
  return next.toISOString().slice(0, 10);
}

function icsTimestamp(value: Date): string {
  return `${value.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * The whole calendar, CRLF line endings throughout (RFC 5545 §3.1 —
 * clients are entitled to reject bare LF), every line folded at 75
 * octets.
 */
export function buildCrewScheduleCalendar(events: CrewCalendarEvent[], options: { calendarName: string }): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//C Stream//Crew Schedule//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options.calendarName)}`,
    // How often clients that honour it should poll. Informal but widely
    // read (Google honours its own schedule anyway).
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const event of events) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${escapeIcsText(event.uid)}`);
    lines.push(`DTSTAMP:${icsTimestamp(event.updatedAt)}`);
    lines.push(`DTSTART;VALUE=DATE:${icsDate(event.date)}`);
    lines.push(`DTEND;VALUE=DATE:${icsDate(nextDay(event.date))}`);
    lines.push(`SUMMARY:${escapeIcsText(event.summary)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.flatMap(foldIcsLine).join("\r\n") + "\r\n";
}
