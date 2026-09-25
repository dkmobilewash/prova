import { localToday } from "./local-today";
import type { StringKey } from "./i18n";
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
 * IT DECIDES WHICH SENTENCE IS TRUE, NOT HOW THAT SENTENCE READS. A line
 * carries a translation KEY and the numbers to fill it, so the same
 * derivation speaks English or Spanish without this module knowing which.
 * The import of `StringKey` is `import type`, which erases at compile —
 * nothing here loads the dictionaries, and nothing here calls `t()`, so
 * the module stays pure and testable in node.
 *
 * Singular and plural are a BRANCH HERE, one key per arm, never a letter
 * stuck on the end of a word: English picks "photo"/"photos" off the
 * count, Spanish picks a different word AND makes the verb agree with it
 * ("1 hora registrada" / "2 horas registradas"), and no amount of string
 * concatenation gets that right.
 *
 * A report filed "today" means filed for today's REPORT DATE, not created
 * in the last 24 hours.
 *
 * WHICH DAY "TODAY" IS COMES FROM THE PHONE, not from UTC, and this
 * paragraph said the opposite until the drift below was measured. Rows
 * are still STORED and rendered at UTC midnight — that convention is
 * unchanged and is the reason `dayKey` can just slice the string. What
 * changed is only the question "which of those days is today", which is
 * a question about where the person is standing. See `todayKey`.
 */

export type TodayLine = {
  key: string;
  /** What it says, as a key into the dictionaries. Written as a fact,
   * never as a label. */
  label: StringKey;
  /** What the key's `{placeholders}` are filled with — numbers and
   * formatted numbers only, never a pre-translated fragment, so one key is
   * one whole sentence in every language. Passed even to an arm whose
   * English has no placeholder ("1 photo today"), because another language
   * may want the digit where English spells it out. */
  vars?: Record<string, string | number>;
  /** How it reads: `done` is a thing that is handled, `todo` needs doing,
   * `warn` is something going wrong, `plain` is context. */
  tone: "done" | "todo" | "warn" | "plain";
  /** Where tapping it goes, relative to the job — except "outbox", which
   * is the one destination that is about the PHONE rather than the job
   * (app/outbox.tsx) and therefore takes no jobId. */
  section?: "reports" | "photos" | "punch-list" | "time" | "outbox";
};

export function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * What day it is ON THIS PHONE — not in UTC.
 *
 * This used to be `now.toISOString().slice(0, 10)`, and that is the exact
 * bug `lib/local-today.ts` was written for, arriving at a second site.
 * Its header records the first one: at 18:03 in Albuquerque the UTC date
 * is already tomorrow, so the schedule screen drew a day that was still
 * being worked as past and said "No hours logged" about it.
 *
 * The same six hours did this here. Home printed `longDate(localToday())`
 * — the phone's day — over lines counted against `todayKey()`'s UTC day,
 * so after ~18:00 Mountain the greeting read "Wednesday, September 23"
 * above "No photos today" on a day photos had been taken. `time/[jobId]`
 * called it too, which is the screen where a wrong day is somebody's
 * hours on the wrong date.
 *
 * Reproduced before it was changed, in an America/Denver process at
 * 18:03 local: `localToday()` gave 2026-09-23 and `todayKey()` gave
 * 2026-09-24.
 */
export function todayKey(now: Date = new Date()): string {
  return localToday(now);
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
      label: input.pending === 1 ? "today.pending.one" : "today.pending.many",
      vars: { count: input.pending },
      tone: "warn",
      // Tappable, because "3 changes still to send" is a fact you cannot
      // act on: which three, how old, and why is that one not moving.
      section: "outbox",
    });
  }

  const filed = input.reports.some((report) => dayKey(report.reportDate) === today);
  lines.push({
    key: "report",
    label: filed ? "today.report.filed" : "today.report.notFiled",
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
    // Two plurals in one sentence, so four arms rather than two: Spanish
    // agrees "registrada"/"registradas" with the hours and cannot be
    // assembled from halves. The hours arm is chosen from the ROUNDED
    // value, the same number `formatHours` prints, so 0.999 never reads
    // "1 hours".
    label: people === 0 ? "today.time.none" : timeKey(roundHours(hours), people),
    vars: { hours: formatHours(hours), people },
    tone: people === 0 ? "todo" : "done",
    section: "time",
  });

  const open = input.punchItems.filter((item) => item.status === "OPEN").length;
  const waiting = input.punchItems.filter((item) => item.status === "READY_FOR_REVIEW").length;
  if (open > 0 || waiting > 0) {
    lines.push({
      key: "punch",
      // One key per whole sentence, including the both-halves case. The
      // two clauses used to be joined with ", " here, which is the same
      // mistake as concatenating a plural: the order of the halves and
      // what separates them is the translator's decision, not this
      // function's.
      label: punchKey(open, waiting),
      vars: { open, waiting },
      tone: open > 0 ? "todo" : "plain",
      section: "punch-list",
    });
  } else if (input.punchItems.length > 0) {
    lines.push({ key: "punch", label: "today.punch.clear", tone: "done", section: "punch-list" });
  }

  const photos = input.media.filter((item) => dayKey(item.capturedAt) === today).length;
  lines.push({
    key: "photos",
    label:
      photos === 0 ? "today.photos.none" : photos === 1 ? "today.photos.one" : "today.photos.many",
    vars: { count: photos },
    tone: photos === 0 ? "todo" : "done",
    section: "photos",
  });

  return lines;
}

/** Which of the four "hours logged today" sentences is the true one.
 * Only reached when somebody logged time — `people` is never 0 here. */
function timeKey(hours: number, people: number): StringKey {
  if (hours === 1) return people === 1 ? "today.time.hour.onePerson" : "today.time.hour.manyPeople";
  return people === 1 ? "today.time.hours.onePerson" : "today.time.hours.manyPeople";
}

/** Which punch sentence is the true one. Only reached when at least one
 * of the two counts is non-zero. */
function punchKey(open: number, waiting: number): StringKey {
  if (open === 0) return "today.punch.waiting";
  if (waiting === 0) return open === 1 ? "today.punch.open.one" : "today.punch.open.many";
  return open === 1 ? "today.punch.openAndWaiting.one" : "today.punch.openAndWaiting.many";
}

/** "7.5", "1", "8" — the NUMBER only, because "hour"/"hours" is a word in
 * the sentence around it and belongs to whichever language is drawing it.
 * No trailing ".0", because a foreman reads this at arm's length. */
export function formatHours(hours: number): string {
  return String(roundHours(hours));
}

/** Two decimal places, and the single source of the number that both the
 * printed hours and the singular/plural arm are decided from. */
function roundHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}
