/** Shared backcharge display semantics, so the form, the row and the
 * counters can't disagree about what a status or a category is called.
 *
 * Only naming lives here. Every derived figure — what a backcharge cost
 * us, whether a response is overdue — comes from lib/backcharges.ts, so
 * there is one implementation of each rather than a display copy that can
 * drift from the summed one. */

export const BACKCHARGE_CATEGORIES = [
  { value: "CLEANUP", label: "Cleanup" },
  { value: "DAMAGE_TO_OTHER_TRADES", label: "Damage to other trades" },
  { value: "COMPLETION_BY_OTHERS", label: "Our scope finished by others" },
  { value: "MATERIAL_OR_EQUIPMENT_SUPPLIED", label: "Material or equipment supplied" },
  { value: "SUPERVISION", label: "Supervision" },
  { value: "SAFETY_VIOLATION", label: "Safety violation" },
  { value: "SCHEDULE_DELAY", label: "Schedule delay" },
  { value: "OTHER", label: "Other" },
] as const;

export function categoryLabel(value: string) {
  return BACKCHARGE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

/** `tone` drives the badge colour. Unresolved states read neutral or
 * amber; the outcomes read by what they cost us, so a withdrawal is green
 * and a full acceptance is not. */
export const BACKCHARGE_STATUS_LABELS = [
  { value: "RECEIVED", label: "Not answered", tone: "amber" },
  { value: "DISPUTED", label: "Disputed", tone: "blue" },
  { value: "ACCEPTED", label: "Accepted in full", tone: "slate" },
  { value: "SETTLED", label: "Settled", tone: "slate" },
  { value: "WITHDRAWN", label: "Withdrawn by GC", tone: "green" },
] as const;

export function statusLabel(value: string) {
  return BACKCHARGE_STATUS_LABELS.find((s) => s.value === value)?.label ?? value;
}

export function statusBadgeClass(value: string) {
  const tone = BACKCHARGE_STATUS_LABELS.find((s) => s.value === value)?.tone ?? "slate";
  switch (tone) {
    case "amber":
      return "bg-amber-500/15 text-amber-300";
    case "blue":
      return "bg-blue-500/15 text-blue-300";
    case "green":
      return "bg-green-500/15 text-green-300";
    default:
      return "bg-slate-800 text-slate-400";
  }
}
