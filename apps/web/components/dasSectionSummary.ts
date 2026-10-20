/**
 * The one line a collapsed DAS 140 / DAS 142 section shows on the job's
 * Compliance tab (declutter, 2026-10-13): how many there are and how many
 * are past due, sent, or still to send. Read off the standings
 * `lib/das-forms.ts` already derives — nothing new is decided here.
 */
const PAST_DUE = new Set(["OVERDUE", "NEEDED_DAY_PASSED_UNSENT", "TOO_LATE_TO_SEND"]);

export function dasSectionSummary(statuses: readonly string[]): { text: string; pastDue: boolean } {
  if (statuses.length === 0) return { text: "None recorded", pastDue: false };
  const pastDue = statuses.filter((s) => PAST_DUE.has(s)).length;
  const sent = statuses.filter((s) => s.startsWith("SENT")).length;
  const toSend = statuses.length - pastDue - sent;
  const parts = [
    pastDue > 0 ? `${pastDue} past due` : null,
    toSend > 0 ? `${toSend} to send` : null,
    sent > 0 ? `${sent} sent` : null,
  ].filter(Boolean);
  return { text: parts.join(" · "), pastDue: pastDue > 0 };
}
