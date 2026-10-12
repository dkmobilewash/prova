import { formatHours } from "@/lib/render-hours";
import { formatCalendarDay } from "@/lib/render-date";
import type { WeeklyHours } from "@/lib/weekly-hours";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** People down the side, Monday to Sunday across, totals on the right and
 * along the bottom. Read-only; an empty cell means no hours that day. */
export function WeeklyHoursTable({ week, caption }: { week: WeeklyHours; caption: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line-card bg-surface">
      <table className="w-full min-w-[36rem] text-sm tabular-nums">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line-row text-xs text-ink-label">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Person
            </th>
            {week.days.map((day, i) => (
              <th key={day} scope="col" className="px-2 py-2 text-right font-medium">
                {WEEKDAYS[i]}
                <span className="block font-normal text-ink-muted">{formatCalendarDay(day, "dayMonth")}</span>
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              Total
            </th>
          </tr>
        </thead>
        <tbody>
          {week.people.map((person) => (
            <tr key={person.id} className="border-b border-line-row">
              <th scope="row" className="px-3 py-2 text-left font-normal text-ink">
                {person.name}
              </th>
              {person.dayHours.map((dayHours, i) => (
                <td key={week.days[i]} className="px-2 py-2 text-right text-ink-body">
                  {dayHours ? formatHours(dayHours) : ""}
                </td>
              ))}
              <td className="px-3 py-2 text-right font-semibold text-ink">
                {formatHours(person.totalHours)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-ink">
            <th scope="row" className="px-3 py-2 text-left font-semibold">
              All
            </th>
            {week.dayHours.map((dayHours, i) => (
              <td key={week.days[i]} className="px-2 py-2 text-right font-medium">
                {dayHours ? formatHours(dayHours) : ""}
              </td>
            ))}
            <td className="px-3 py-2 text-right font-semibold">
              {formatHours(week.totalHours)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
