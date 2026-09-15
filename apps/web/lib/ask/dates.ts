import { formatCalendarDate } from "@/lib/render-date";
import { addDays } from "./numbers";

/**
 * Dates a person SAID, parsed by code — the numbers.ts rule applied to the
 * one kind of value where a guess is worse than a wrong figure, because a
 * wrong figure is visibly wrong and a date a year off is not.
 *
 * The model never supplies a date. It hands over the person's own words —
 * "October 6", "10/6", "next Monday", "a week later", "back a week" — and
 * this file decides what they mean relative to `today`, the person's own
 * calendar day (`ctx.today`, resolved server-side from their timezone).
 * Everything it accepts is pinned in dates.test.ts against fixed todays;
 * everything else is `null`, and the command asks rather than guesses.
 *
 * Four answers, because a date phrase is not always a day:
 *
 *   on      — a calendar day. "October 6", "10/6/2026", "next Monday",
 *             "tomorrow", "in two weeks" (from today).
 *   shift   — a move relative to the date ALREADY ON THE JOB, direction
 *             known: "a week later" is +7, "three days earlier" is −3.
 *             Only the caller, holding the row, can turn it into a day.
 *   shift-either-way — a move whose direction English does not settle.
 *             "Back a week" means a week earlier to some people and a
 *             week's postponement to others, and a bare "a week" says
 *             nothing at all. The caller offers both as chips.
 *   which-year — a month and day with no year that has ALREADY PASSED this
 *             year. "September 1" said on September 11 is either ten days
 *             ago (a correction) or next year (a plan); both are offered as
 *             chips. A month-day still ahead this year is taken as this
 *             year, which is the one reading nobody disputes.
 *
 * Not supported on purpose, each returning null: months as a unit ("in a
 * month" — Oct 31 plus a month has no agreed answer), "next week" (which
 * day?), "this Monday" (the past one or the coming one?), day-first
 * numerics ("6/10" is read as June 10, the US order this app's forms use),
 * and any word that is not on the lists below.
 */
export type ParsedDate =
  | { kind: "on"; day: string }
  | { kind: "shift"; days: number }
  | { kind: "shift-either-way"; days: number }
  | { kind: "which-year"; thisYear: string; nextYear: string };

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SMALL_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

const MONTH = `(${Object.keys(MONTHS).join("|")})\\.?`;
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4}))?";
const COUNT = `(\\d{1,3}|${Object.keys(SMALL_NUMBERS).join("|")})`;
const UNIT = "(days?|weeks?)";
const LATER = "later|out|ahead|forward|forwards";
const EARLIER = "earlier|sooner";
const EITHER = "back|backward|backwards";

const ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const US_NUMERIC = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/;
const MONTH_DAY = new RegExp(`^${MONTH}\\s+${DAY}${YEAR}$`);
const DAY_MONTH = new RegExp(`^${DAY}\\s+(?:of\\s+)?${MONTH}${YEAR}$`);
const WEEKDAY = new RegExp(`^(?:next\\s+)?(${Object.keys(WEEKDAYS).join("|")})$`);
const IN_FROM_TODAY = new RegExp(`^in\\s+${COUNT}\\s+${UNIT}$`);
const COUNT_THEN_DIRECTION = new RegExp(`^${COUNT}\\s+${UNIT}(?:\\s+(${LATER}|${EARLIER}|${EITHER}))?$`);
const DIRECTION_THEN_COUNT = new RegExp(`^(${LATER}|${EARLIER}|${EITHER})\\s+(?:by\\s+)?${COUNT}\\s+${UNIT}$`);
const IS_LATER = new RegExp(`^(?:${LATER})$`);
const IS_EARLIER = new RegExp(`^(?:${EARLIER})$`);

/** Leading words that place a date without changing it: "to October 6",
 * "by a week", "the 6th of October". Stripped one at a time so "by" on a
 * shift and "on" on a day both fall away. "in" is deliberately absent —
 * "in a week" is a day counted from today, not a lead-in. */
const LEAD_IN = /^(?:on|to|at|until|till|through|thru|for|by|from|the|of)\s+/;

const utcMidnight = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** `yyyy-mm-dd` for a real calendar day, or null for February 30. */
function calendarDay(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function count(text: string): number {
  return SMALL_NUMBERS[text] ?? Number(text);
}

function daysFor(n: number, unit: string): number {
  return unit.startsWith("week") ? n * 7 : n;
}

/** A month and day with no year: this year when it is still ahead (or is
 * today), otherwise both candidates for the caller to offer. */
function monthDay(month: number, day: number, today: string): ParsedDate | null {
  const year = Number(today.slice(0, 4));
  const thisYear = calendarDay(year, month, day);
  if (!thisYear) return null;
  if (thisYear >= today) return { kind: "on", day: thisYear };
  const nextYear = calendarDay(year + 1, month, day);
  if (!nextYear) return null;
  return { kind: "which-year", thisYear, nextYear };
}

function shift(n: number, unit: string, direction: string | undefined): ParsedDate | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const days = daysFor(n, unit);
  if (!direction) return { kind: "shift-either-way", days };
  if (IS_LATER.test(direction)) return { kind: "shift", days };
  if (IS_EARLIER.test(direction)) return { kind: "shift", days: -days };
  return { kind: "shift-either-way", days };
}

export function parseDateWords(text: string | undefined, today: string): ParsedDate | null {
  if (!text) return null;
  let words = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^["']|["']$/g, "")
    .replace(/[.]+$/, "")
    .trim();
  for (let stripped = words.replace(LEAD_IN, ""); stripped !== words; stripped = words.replace(LEAD_IN, "")) {
    words = stripped;
  }
  if (!words) return null;

  let m: RegExpMatchArray | null;

  if ((m = words.match(ISO))) {
    const day = calendarDay(Number(m[1]), Number(m[2]), Number(m[3]));
    return day ? { kind: "on", day } : null;
  }

  if ((m = words.match(US_NUMERIC))) {
    const month = Number(m[1]);
    const dayOfMonth = Number(m[2]);
    if (!m[3]) return monthDay(month, dayOfMonth, today);
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const day = calendarDay(year, month, dayOfMonth);
    return day ? { kind: "on", day } : null;
  }

  if ((m = words.match(MONTH_DAY))) {
    const month = MONTHS[m[1]];
    const dayOfMonth = Number(m[2]);
    if (!m[3]) return monthDay(month, dayOfMonth, today);
    const day = calendarDay(Number(m[3]), month, dayOfMonth);
    return day ? { kind: "on", day } : null;
  }

  if ((m = words.match(DAY_MONTH))) {
    const dayOfMonth = Number(m[1]);
    const month = MONTHS[m[2]];
    if (!m[3]) return monthDay(month, dayOfMonth, today);
    const day = calendarDay(Number(m[3]), month, dayOfMonth);
    return day ? { kind: "on", day } : null;
  }

  if (words === "today") return { kind: "on", day: today };
  if (words === "tomorrow") return { kind: "on", day: addDays(today, 1) };

  if ((m = words.match(WEEKDAY))) {
    // The first such day strictly after today. "Next Monday" said on a
    // Monday is a week away; said on a Friday it is three days away. The
    // card shows the weekday beside the date, so the reading is visible.
    const wanted = WEEKDAYS[m[1]];
    const todayIndex = utcMidnight(today).getUTCDay();
    const ahead = (wanted - todayIndex + 7) % 7 || 7;
    return { kind: "on", day: addDays(today, ahead) };
  }

  if ((m = words.match(IN_FROM_TODAY))) {
    return { kind: "on", day: addDays(today, daysFor(count(m[1]), m[2])) };
  }

  if ((m = words.match(COUNT_THEN_DIRECTION))) {
    return shift(count(m[1]), m[2], m[3]);
  }
  if ((m = words.match(DIRECTION_THEN_COUNT))) {
    return shift(count(m[2]), m[3], m[1]);
  }

  return null;
}

/** "Oct 6, 2026 (Tuesday)": the shared calendar-day formatter (#242, UTC
 * in and UTC out) with the weekday beside it, because a schedule date on
 * a Saturday is worth noticing before the tap. */
export function dayLabel(day: string): string {
  const date = utcMidnight(day);
  return `${formatCalendarDate(date)} (${WEEKDAY_NAMES[date.getUTCDay()]})`;
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((utcMidnight(to).getTime() - utcMidnight(from).getTime()) / 86_400_000);
}

/** "10 days ago", "today", "in 25 days" — for a chip's detail line. */
export function relativeToToday(day: string, today: string): string {
  const days = daysBetween(today, day);
  if (days === 0) return "today";
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  return days < 0 ? `${n} ${unit} ago` : `in ${n} ${unit}`;
}
