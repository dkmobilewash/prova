/** Wording and colour for alerts. Nothing decided here — every severity,
 * date and figure comes from lib/alerts.ts, so the bell, the list and the
 * tiles cannot tell different stories about the same alert. */

import type { AlertKind, AlertSeverity } from "@/lib/alerts";

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  RENEWAL: "Expiry",
  BACKCHARGE_RESPONSE: "Backcharge",
  RETAINAGE_RELEASE: "Retainage",
  CLOSEOUT_WITH_GC: "Closeout",
  CLOSEOUT_REJECTED: "Closeout",
  CERTIFIED_PAYROLL: "Certified payroll",
  APPRENTICE_RATIO: "Apprentice ratio",
  WIP_VARIANCE: "Job health",
  CONTACT_FOLLOW_UP: "Follow-up",
};

export function kindLabel(kind: AlertKind) {
  return ALERT_KIND_LABELS[kind] ?? kind;
}

export function severityLabel(severity: AlertSeverity) {
  switch (severity) {
    case "OVERDUE":
      return "Past due";
    case "DUE_SOON":
      return "Coming up";
    case "STANDING":
      // Not "low priority". A job forecast over its contract value is not
      // less important than a COI expiring in three weeks — it just has no
      // date attached, which is a different thing.
      return "Standing";
  }
}

export function severityBadgeClass(severity: AlertSeverity) {
  switch (severity) {
    case "OVERDUE":
      return "bg-tag-rose text-tag-rose-ink";
    case "DUE_SOON":
      return "bg-tag-amber text-tag-amber-ink";
    case "STANDING":
      return "border border-line-card bg-tag-slate text-tag-slate-ink";
  }
}
