/**
 * READING A WAGE RATE OFF A DETERMINATION, as a person types it.
 *
 * Pure, so the rules can be held to a test rather than discovered on a
 * government document at five o'clock. The action in lib/actions/labor.ts
 * is the thin half; everything that can be wrong is decided here.
 *
 * THESE FIGURES ARE COPIED FROM A PDF, which drives two decisions:
 *
 * - **Currency furniture is stripped, not rejected.** Somebody pasting
 *   `$52.34` or `1,284.00` out of a determination is doing the normal
 *   thing, and refusing it teaches them to retype a number they had
 *   right — which is how a digit gets dropped.
 * - **A zero BASE wage is refused; a zero FRINGE is kept.** No
 *   determination publishes a base rate of nothing, so a 0 there is a
 *   mis-key or an empty box read as a figure, and it would price work at
 *   nothing. A fringe of 0 is ordinary — plenty of determinations carry no
 *   training contribution — so it is a fact, not a mistake.
 */

export type WageRateInput = {
  classification: string;
  craftClassificationId: string | null;
  baseWage: number;
  pensionRate: number | null;
  vacationRate: number | null;
  healthWelfareRate: number | null;
  trainingRate: number | null;
};

export type WageRateRead =
  | { ok: true; value: WageRateInput }
  | { ok: false; error: string };

/** The fringe fields, in the order the form asks for them. Exported so a
 * test can hold the parser and the type together rather than trusting
 * both separately. */
export const FRINGE_FIELDS = [
  "pensionRate",
  "vacationRate",
  "healthWelfareRate",
  "trainingRate",
] as const;

export type FringeField = (typeof FRINGE_FIELDS)[number];

/** `$1,284.00` -> 1284. Returns null for blank, NaN for unreadable — the
 * two are different and the caller treats them differently. */
export function readMoney(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,\s]/g, "");
  if (cleaned === "") return null;
  // Not Number(): Number("") is 0 and Number("12abc") is NaN, but
  // Number("0x10") is 16, and a hex-looking paste is not a wage.
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return Number.NaN;
  return Number(cleaned);
}

export function readWageRateForm(get: (key: string) => string | null): WageRateRead {
  const classification = (get("classification") ?? "").trim();
  if (!classification) {
    return { ok: false, error: "Say which classification this rate is for, as the determination names it." };
  }

  const base = readMoney(get("baseWage"));
  if (base == null) return { ok: false, error: "A base wage is required." };
  if (Number.isNaN(base)) return { ok: false, error: "That base wage is not a number." };
  if (base < 0) return { ok: false, error: "A base wage cannot be negative." };
  // See the header: a zero base would price the work at nothing.
  if (base === 0) {
    return { ok: false, error: "A base wage of 0 is not a rate — check the determination." };
  }

  const fringes: Record<FringeField, number | null> = {
    pensionRate: null,
    vacationRate: null,
    healthWelfareRate: null,
    trainingRate: null,
  };
  for (const field of FRINGE_FIELDS) {
    const value = readMoney(get(field));
    if (value == null) continue;
    if (Number.isNaN(value)) return { ok: false, error: `That ${label(field)} is not a number.` };
    if (value < 0) return { ok: false, error: `${label(field)} cannot be negative.` };
    fringes[field] = value;
  }

  const craft = (get("craftClassificationId") ?? "").trim();

  return {
    ok: true,
    value: {
      classification,
      // Blank means nobody has mapped it yet, which is a legitimate state:
      // the document's classification names are not ours.
      craftClassificationId: craft || null,
      baseWage: base,
      ...fringes,
    },
  };
}

function label(field: FringeField): string {
  return {
    pensionRate: "pension rate",
    vacationRate: "vacation rate",
    healthWelfareRate: "health & welfare rate",
    trainingRate: "training rate",
  }[field];
}
