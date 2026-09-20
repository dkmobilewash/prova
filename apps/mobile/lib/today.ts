import type { FieldReportRow, Media, PunchListItem, TimeEntry } from "./types";

/**
 * What the Home tab says about today, computed from lists the app already
 * fetches — no new endpoint, nothing invented.
 *
 * The rule this file follows, and the reason it is a pure function: a home
 * screen is only worth opening if it can be WRONG. "3 punch items waiting
 * on a sign-off" is a claim about the day; "Punch list ›" is a menu. So
 * every line here is derived from real rows and is asserted in
 * today.test.ts against the shapes the API actually returns.
 *
 * Dates are compared as calendar days in UTC, the same convention the rest
 * of the product stores and renders in (see CLAUDE.md). A report filed
 * "today" means filed for today's REPORT DATE, not created in the last 24
 * hours.
 */

export type TodayLine = {
  key: string;
  /** What it says. Written as a fact, never as a label. */
  label: string;
  /** How it reads: `done` is a thing that is handled, `todo` needs doing,
   * `warn` is something going wrong, `plain` is context. */
  tone: "done" | "todo" | "warn" | "plain";
  /** Where tapping it goes, relative to the job. */
  section?: "reports" | "photos" | "punch-list" | "time";
};

export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export type TodayInput = {
  reports: FieldReportRow[];
  punchItems: PunchListItem[];
  media: Media[];
  timeEntries: TimeEntry[];
  /** Writes still queued on this phone, from the sync queue. */
  pending: number;
  now?: Date;
};

export function summariseToday(input: TodayInput): TodayLine[] {
  const today = todayKey(input.now);
  const lines: TodayLine[] = [];

  // Anything the phone is still holding comes FIRST and is never quiet.
  // A write that has not landed is the one thing on this screen that can
  // still be lost, so it outranks everything that is merely undone.
  if (input.pending > 0) {
    lines.push({
      key: "pending",
      label: input.pending === 1 ? "1 change still to send" : `${input.pending} changes still to send`,
      tone: "warn",
    });
  }

  const filed = input.reports.some((report) => dayKey(report.reportDate) === today);
  lines.push({
    key: "report",
    label: filed ? "Today's report is filed" : "Today's report isn't filed",
    tone: filed ? "done" : "todo",
    section: "reports",
  });

  const hours = input.timeEntries
    .filter((entry) => dayKey(entry.date) === today)
    .reduce((total, entry) => total + (Number(entry.hours) || 0), 0);
  const people = new Set(
    input.timeEntries.filter((entry) => dayKey(entry.date) === today).map((entry) => entry.employeeName),
  ).size;
  lines.push({
    key: "time",
    label:
      people === 0
        ? "No hours logged today"
        : `${formatHours(hours)} logged today, ${people === 1 ? "1 person" : `${people} people`}`,
    tone: people === 0 ? "todo" : "done",
    section: "time",
  });

  const open = input.punchItems.filter((item) => item.status === "OPEN").length;
  const waiting = input.punchItems.filter((item) => item.status === "READY_FOR_REVIEW").length;
  if (open > 0 || waiting > 0) {
    lines.push({
      key: "punch",
      label: [
        open > 0 ? `${open} punch ${open === 1 ? "item" : "items"} open` : null,
        waiting > 0 ? `${waiting} waiting to be verified` : null,
      ]
        .filter(Boolean)
        .join(", "),
      tone: open > 0 ? "todo" : "plain",
      section: "punch-list",
    });
  } else if (input.punchItems.length > 0) {
    lines.push({ key: "punch", label: "Punch list is clear", tone: "done", section: "punch-list" });
  }

  const photos = input.media.filter((item) => dayKey(item.capturedAt) === today).length;
  lines.push({
    key: "photos",
    label: photos === 0 ? "No photos today" : `${photos} ${photos === 1 ? "photo" : "photos"} today`,
    tone: photos === 0 ? "todo" : "done",
    section: "photos",
  });

  return lines;
}

/** "7.5 hours", "1 hour", "8 hours" — no trailing .0, because a foreman
 * reads this at arm's length. */
export function formatHours(hours: number): string {
  const rounded = Math.round(hours * 100) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : String(rounded);
  return `${text} ${rounded === 1 ? "hour" : "hours"}`;
}
