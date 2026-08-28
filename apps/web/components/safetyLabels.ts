/** Display labels and OSHA semantics for the safety enums, shared by the
 * form and the log so they can't drift. */
export const INCIDENT_OUTCOMES = [
  { value: "DEATH", label: "Death", recordable: true },
  { value: "DAYS_AWAY", label: "Days away from work", recordable: true },
  { value: "RESTRICTED_OR_TRANSFER", label: "Restricted duty or job transfer", recordable: true },
  { value: "OTHER_RECORDABLE", label: "Other recordable case", recordable: true },
  { value: "FIRST_AID_ONLY", label: "First aid only (not recordable)", recordable: false },
] as const;

export const INCIDENT_CLASSIFICATIONS = [
  { value: "INJURY", label: "Injury" },
  { value: "SKIN_DISORDER", label: "Skin disorder" },
  { value: "RESPIRATORY_CONDITION", label: "Respiratory condition" },
  { value: "POISONING", label: "Poisoning" },
  { value: "HEARING_LOSS", label: "Hearing loss" },
  { value: "OTHER_ILLNESS", label: "Other illness" },
] as const;

export function outcomeLabel(value: string) {
  return INCIDENT_OUTCOMES.find((o) => o.value === value)?.label ?? value;
}

export function classificationLabel(value: string) {
  return INCIDENT_CLASSIFICATIONS.find((c) => c.value === value)?.label ?? value;
}

/** Everything except first aid is recordable on the 300 log. Derived from
 * the outcome rather than stored, so it can never disagree with it. */
export function isRecordable(outcome: string) {
  return INCIDENT_OUTCOMES.find((o) => o.value === outcome)?.recordable ?? false;
}
