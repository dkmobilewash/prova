import type { ScheduleRow } from "./types";

/**
 * The schedule as the screen reads it: days in order, each with its
 * people in order.
 *
 * In `lib` rather than in the screen for the reason the icon map is:
 * anything a test should reach cannot live in a file that imports React
 * Native, because the test runner is node and the screen is not.
 */
export type ScheduleDay = { date: string; people: ScheduleRow[] };

export function groupByDay(rows: ScheduleRow[]): ScheduleDay[] {
  const days = new Map<string, ScheduleRow[]>();
  for (const row of rows) {
    const people = days.get(row.workDate) ?? [];
    people.push(row);
    days.set(row.workDate, people);
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, people]) => ({
      date,
      people: [...people].sort((a, b) => a.workerName.localeCompare(b.workerName)),
    }));
}
