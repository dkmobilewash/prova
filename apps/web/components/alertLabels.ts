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
  DOCUMENT_INTAKE: "Document intake",
  RFI_UNANSWERED: "RFI",
  SUBMITTAL_OVERDUE: "Submittal",
  // The set, not the sheet: one alert covers every unreceived revision on
  // one drawing set, so the singular would misname what the row is about.
  DRAWING_REVISION_UNRECEIVED: "Drawings",
  LIEN_DEADLINE: "Lien deadline",
  // The four field kinds. Each names the THING rather than the failure —
  // "Delivery" not "Late delivery" — because the severity chip beside it
  // already says whether it is overdue, and saying it twice reads as two
  // problems. The same reason "Submittal" above is not "Overdue submittal".
  MATERIAL_DELIVERY_LATE: "Delivery",
  PUNCH_ITEM_AGING: "Punch item",
  EQUIPMENT_OUT_LONG: "Equipment",
  // Not "Delay": the alert is not about the delay, which is recorded and
  // fine. It is about the NOTICE that is missing, which is the thing a
  // person can still act on.
  DELAY_GC_NOT_TOLD: "GC notice",
  // The FORM NUMBER, not "Apprenticeship": these are the two names a
  // contractor and an enforcement officer both use, they are printed at the
  // top of the documents themselves, and a chip reading "Apprenticeship" on
  // two different deadlines would make them indistinguishable in a list
  // where the difference is which form has to go out.
  DAS140_NOTICE: "DAS 140",
  DAS142_DISPATCH: "DAS 142",
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
