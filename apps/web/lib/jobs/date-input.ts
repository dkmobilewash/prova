/** `<input type="date">`'s `defaultValue` from a stored UTC-midnight date —
 * shared by every `/jobs/[id]/*` route that renders a date field (Schedule
 * on Overview, substantial completion on Retainage). Pulled out of the old
 * monolith rather than copied twice. */
export function dateInputValue(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}
