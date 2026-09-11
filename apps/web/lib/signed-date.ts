/**
 * Issue #106 finding 7. `signedAt.toLocaleDateString(...)` with no
 * `timeZone` formats in the SERVER's own clock — UTC on Vercel — not the
 * signer's. An evening signature west of UTC is already tomorrow in UTC,
 * so it rendered a day late on the one date a dispute can turn on. Pulled
 * out to one function so /esign/[token] and /jobs/[id] format the same
 * date the same way, and so the fix is testable without a request or a
 * timezone-aware DOM.
 */
import { formatInstant } from "@/lib/render-date";

export function formatSignedDate(date: Date, timeZone: string): string {
  return formatInstant(date, timeZone);
}
