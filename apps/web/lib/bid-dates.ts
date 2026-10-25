/**
 * The dates on a bid invitation beyond "the day it is due": a due TIME, the job
 * walk / pre-bid meeting, and the RFI cutoff. Pure — no database, no clock
 * (the caller passes `today`), so every rule here is testable on its own.
 *
 * ── HOW A TIME IS STORED, AND WHY NOT AS A TIMESTAMP ──
 *
 * Minutes after midnight (0-1439) in an Int, the representation the delay log
 * already uses (`DelayEvent.startMinute`). A bid invitation says "2:00 PM" and
 * no zone; it means the clock where the work is. Storing an instant would force
 * a zone guess at write time and a second guess at read time (the reader's
 * `prova_tz`), and the two can disagree by hours on a deadline. Stored and
 * shown as written, the number can only be wrong if the person typed it wrong.
 *
 * The DAY stays what every date here is: UTC midnight, rendered in UTC.
 */

export const MINUTES_PER_DAY = 1440;

/** The "how soon is soon" for a walk or an RFI cutoff. */
export const BID_DATE_WARN_DAYS = 7;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` from a date input as UTC midnight; null when empty; "invalid"
 * for anything that is not a real calendar day (2026-02-30 is not). */
export function calendarDay(raw: string | null | undefined): Date | null | "invalid" {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  if (!DAY.test(text)) return "invalid";
  const date = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return "invalid";
  return date;
}

/** `HH:MM` from a time input as minutes after midnight; null when empty. */
export function minuteOfDay(raw: string | null | undefined): number | null | "invalid" {
  const text = (raw ?? "").trim();
  if (text === "") return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) return "invalid";
  const hh = Number(match[1]);
  const minutes = Number(match[2]);
  if (hh > 23 || minutes > 59) return "invalid";
  return hh * 60 + minutes;
}

/** The `HH:MM` a time input round-trips, or "" for none. */
export function timeInputValue(minute: number | null | undefined): string {
  if (minute === null || minute === undefined) return "";
  const hh = Math.floor(minute / 60);
  return `${String(hh).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

/** 840 -> "2:00 PM". Midnight is "12:00 AM", noon "12:00 PM". */
export function formatClock(minute: number): string {
  const hh = Math.floor(minute / 60);
  const suffix = hh >= 12 ? "PM" : "AM";
  const twelve = hh % 12 === 0 ? 12 : hh % 12;
  return `${twelve}:${String(minute % 60).padStart(2, "0")} ${suffix}`;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Thu" for a `YYYY-MM-DD`. Weekday of the calendar day itself, so UTC. */
export function weekdayOf(iso: string): string {
  return WEEKDAY[new Date(`${iso}T00:00:00.000Z`).getUTCDay()]!;
}

/** "Thu 2:00 PM", or just "Thu" when no time was recorded. */
export function dayAndTime(iso: string, minute: number | null | undefined): string {
  return minute === null || minute === undefined ? weekdayOf(iso) : `${weekdayOf(iso)} ${formatClock(minute)}`;
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

export type BidDatesInput = {
  dueDate: Date | null;
  dueMinute: number | null;
  walkDate: Date | null;
  walkMinute: number | null;
  rfiCutoffDate: Date | null;
};

/** What is wrong with these dates, in a sentence, or null. A time with no day
 * to hang it on is refused rather than saved: a "2:00 PM" with no date would
 * sit in the row meaning nothing and look like data. */
export function bidDatesProblem(input: BidDatesInput): string | null {
  if (input.dueMinute !== null && input.dueDate === null) return "A due time needs a due date.";
  if (input.walkMinute !== null && input.walkDate === null) return "A job walk time needs a job walk date.";
  for (const minute of [input.dueMinute, input.walkMinute]) {
    if (minute !== null && (!Number.isInteger(minute) || minute < 0 || minute >= MINUTES_PER_DAY)) {
      return "That time is not a time of day.";
    }
  }
  return null;
}

export type UpcomingBidDate = {
  kind: "walk" | "rfi";
  iso: string;
  minute: number | null;
  daysLeft: number;
  /** "Job walk Tue 9:00 AM" / "RFIs close Fri" — with "today" and "tomorrow"
   * spelled out, because the weekday alone is ambiguous at 0 and 1 day. */
  label: string;
};

/**
 * The walk and the RFI cutoff that fall in the next `BID_DATE_WARN_DAYS` days,
 * soonest first. Today counts; yesterday does not (a walk that has happened is
 * history, not a warning). Only for bids still being priced — the caller
 * decides that, since a won bid's RFI cutoff is not news.
 */
export function upcomingBidDates(
  bid: { walkDate: Date | null; walkMinute: number | null; rfiCutoffDate: Date | null },
  today: string,
  withinDays: number = BID_DATE_WARN_DAYS,
): UpcomingBidDate[] {
  const out: UpcomingBidDate[] = [];
  const consider = (kind: "walk" | "rfi", date: Date | null, minute: number | null) => {
    if (!date) return;
    const iso = date.toISOString().slice(0, 10);
    const daysLeft = daysBetween(today, iso);
    if (daysLeft < 0 || daysLeft > withinDays) return;
    const when = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : weekdayOf(iso);
    const at = minute === null ? "" : ` ${formatClock(minute)}`;
    out.push({
      kind,
      iso,
      minute,
      daysLeft,
      label: kind === "walk" ? `Job walk ${when}${at}` : `RFIs close ${when}`,
    });
  };
  consider("walk", bid.walkDate, bid.walkMinute);
  consider("rfi", bid.rfiCutoffDate, null);
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** The bid-date fields of a form, parsed. Names are the form's; the caller
 * adds its own project/trade/amount/notes. */
export function bidDatesFromForm(
  formData: FormData,
): { ok: true; value: BidDatesInput } | { ok: false; error: string } {
  const field = (name: string) => String(formData.get(name) ?? "");
  const dueDate = calendarDay(field("dueDate"));
  const walkDate = calendarDay(field("walkDate"));
  const rfiCutoffDate = calendarDay(field("rfiCutoffDate"));
  const dueMinute = minuteOfDay(field("dueTime"));
  const walkMinute = minuteOfDay(field("walkTime"));
  if (dueDate === "invalid") return { ok: false, error: "The bid due date is not a valid date." };
  if (walkDate === "invalid") return { ok: false, error: "The job walk date is not a valid date." };
  if (rfiCutoffDate === "invalid") return { ok: false, error: "The RFI cutoff date is not a valid date." };
  if (dueMinute === "invalid") return { ok: false, error: "The bid due time is not a valid time." };
  if (walkMinute === "invalid") return { ok: false, error: "The job walk time is not a valid time." };
  const value = { dueDate, dueMinute, walkDate, walkMinute, rfiCutoffDate };
  const problem = bidDatesProblem(value);
  return problem ? { ok: false, error: problem } : { ok: true, value };
}
