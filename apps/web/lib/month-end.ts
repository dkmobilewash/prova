/** The last calendar day of the month a `YYYY-MM-DD` day falls in. Empty in,
 * empty out, because the user's own date is "" until the browser has read it. */
export function monthEnd(day: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.test(day) ? day.split("-").map(Number) : null;
  if (!match) return "";
  const [year, month] = match;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
