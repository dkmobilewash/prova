/** Wording for prevailing wage rule sets. Every threshold and every
 * disagreement is decided in lib/prevailing-wage.ts; nothing here judges
 * anything. */

export const AUTHORITY_LABELS: Record<string, string> = {
  FEDERAL: "Federal (Davis-Bacon)",
  STATE: "State",
  COUNTY: "County",
  CITY: "City",
};

export const FILING_FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Every two weeks",
  SEMI_MONTHLY: "Twice a month",
  MONTHLY: "Monthly",
};

export function authorityLabel(value: string) {
  return AUTHORITY_LABELS[value] ?? value;
}

export function filingFrequencyLabel(value: string) {
  return FILING_FREQUENCY_LABELS[value] ?? value;
}

/** "after 8 hrs" / "from the first hour" / "not recorded".
 *
 * The three-way distinction is the point. Zero means the premium starts
 * immediately, which is how a seventh-day rule is usually written; null
 * means nobody has looked it up. Rendering both as "0" — or either as
 * "none" — would erase exactly the difference the review depends on. */
export function thresholdLabel(hours: number | null): string {
  if (hours === null) return "not recorded";
  if (hours === 0) return "from the first hour";
  return `after ${hours % 1 === 0 ? hours : hours.toFixed(2)} hrs`;
}

export function payTypeLabel(value: string) {
  switch (value) {
    case "STRAIGHT":
      return "straight";
    case "OVERTIME":
      return "OT";
    case "DOUBLE_TIME":
      return "2×";
    case "SHIFT_DIFFERENTIAL":
      return "shift diff";
    default:
      return value;
  }
}

/** "8 straight, 2 OT" — the shape used on both sides of a disagreement so
 * the two are comparable at a glance. */
export function splitLabel(split: Record<string, number>): string {
  const parts = (["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"] as const)
    .filter((type) => (split[type] ?? 0) > 0)
    .map((type) => `${split[type]} ${payTypeLabel(type)}`);
  return parts.length > 0 ? parts.join(", ") : "no hours";
}
