import type { Alert } from "@/lib/alerts";
import { daysUntil as daysUntilIso } from "@/lib/compliance-expiry";
import { nextMonthlyDate, obligationSentence } from "./obligations";

/**
 * Subcontract deadlines as alerts — the one builder behind the
 * `SUBCONTRACT_OBLIGATION` kind in lib/alerts.ts, kept here so the shared
 * alerts module gains a type member and a capability and nothing more.
 * Pure; alerts are derived on every read and never stored.
 *
 *   NOTICE_WINDOW — a RULE, not a date ("48 h written notice of any delay").
 *     STANDING, for as long as the obligation exists: it has no due date, and
 *     dressing it up as one would put a fake deadline in a red badge. The
 *     event that starts the clock (a delay) is not known here; the
 *     DELAY_GC_NOT_TOLD alert already watches logged delays.
 *   MONTHLY_DAY — the next occurrence, DUE_SOON inside the horizon.
 *   DATED — the person's own date: DUE_SOON inside the horizon, OVERDUE after.
 */

export const SUBCONTRACT_OBLIGATION_HORIZON_DAYS = 7;

export type ObligationAlertSource = {
  id: string;
  jobId: string;
  jobName: string;
  kind: "NOTICE_WINDOW" | "MONTHLY_DAY" | "DATED";
  label: string;
  dayOfMonth: number | null;
  /** ISO date, UTC. */
  dueOn: string | null;
  recipient: string | null;
  form: string | null;
};

export function subcontractObligationAlerts(
  sources: readonly ObligationAlertSource[],
  todayIso: string,
  horizon: number = SUBCONTRACT_OBLIGATION_HORIZON_DAYS,
): Alert[] {
  const alerts: Alert[] = [];
  for (const row of sources) {
    const detail = `${row.jobName}: ${obligationSentence(row)} From the subcontract.`;
    if (row.kind === "NOTICE_WINDOW") {
      alerts.push({
        // The label is the fact: change the window and a dismissal lapses.
        key: `SUBCONTRACT_OBLIGATION:${row.id}:${row.label.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60)}`,
        kind: "SUBCONTRACT_OBLIGATION",
        severity: "STANDING",
        title: `${row.label} applies on ${row.jobName}`,
        detail,
        href: `/jobs/${row.jobId}/subcontract-review`,
        dueOn: null,
        daysUntil: null,
        amount: null,
      });
      continue;
    }
    const dueOn = row.kind === "MONTHLY_DAY" && row.dayOfMonth ? nextMonthlyDate(row.dayOfMonth, todayIso) : row.dueOn;
    if (!dueOn) continue;
    const days = daysUntilIso(dueOn, todayIso);
    if (days > horizon) continue;
    // A MONTHLY day never goes overdue — next month's occurrence takes over.
    const severity = days < 0 ? "OVERDUE" : "DUE_SOON";
    alerts.push({
      key: `SUBCONTRACT_OBLIGATION:${row.id}:${dueOn}`,
      kind: "SUBCONTRACT_OBLIGATION",
      severity,
      title: `${row.label} — ${row.jobName}`,
      detail,
      href: `/jobs/${row.jobId}/subcontract-review`,
      dueOn,
      daysUntil: days,
      amount: null,
    });
  }
  return alerts;
}
