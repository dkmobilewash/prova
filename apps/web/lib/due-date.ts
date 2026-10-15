import { daysPastDueFor } from "@/lib/cash-flow";
import { formatCalendarDate } from "@/lib/render-date";

/**
 * How a due date reads, everywhere Concept G shows one: "due Oct 17" until
 * the day has passed, then "overdue 8 days" in the danger tone.
 *
 * `asOf` is the VIEWER'S calendar day at UTC midnight — `viewerAsOf()` from
 * lib/viewerToday.ts on the server — never `new Date()`. A raw instant makes
 * the answer depend on the time of day, and the server's own day is already
 * tomorrow every evening west of UTC (lib/cash-flow.ts `daysPastDueFor`,
 * CLAUDE.md "Dates"). A pay app due today is due today, all day.
 */
export function overdueText(days: number, startOfLine = false): string {
  return `${startOfLine ? "Overdue" : "overdue"} ${days} ${days === 1 ? "day" : "days"}`;
}

export function dueStatus(dueAt: Date, asOf: Date): { text: string; overdue: boolean } {
  const late = daysPastDueFor(dueAt, asOf);
  return late > 0
    ? { text: overdueText(late), overdue: true }
    : { text: `due ${formatCalendarDate(dueAt, "dayMonth")}`, overdue: false };
}
