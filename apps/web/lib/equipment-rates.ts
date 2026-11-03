// Equipment cost rates. Pure. A rate belongs to a kind of machine by name, per
// hour, day or week, over a span of days.

export type EquipmentRateUnit = "HOUR" | "DAY" | "WEEK";

export const EQUIPMENT_RATE_UNITS: readonly { value: EquipmentRateUnit; label: string }[] = [
  { value: "HOUR", label: "hour" },
  { value: "DAY", label: "day" },
  { value: "WEEK", label: "week" },
];

export const unitLabel = (unit: EquipmentRateUnit) =>
  EQUIPMENT_RATE_UNITS.find((row) => row.value === unit)?.label ?? unit.toLowerCase();

export type EquipmentRateRow = {
  id: string;
  name: string;
  unit: EquipmentRateUnit;
  rate: number;
  /** Calendar days, `YYYY-MM-DD`, so plain string order is date order. */
  effectiveFrom: string;
  effectiveTo: string | null;
  notes: string | null;
};

type Span = Pick<EquipmentRateRow, "effectiveFrom" | "effectiveTo">;

const covers = (rate: Span, day: string) => rate.effectiveFrom <= day && (!rate.effectiveTo || day <= rate.effectiveTo);

/** The rates in force on a day, by name then unit. */
export function ratesOn<T extends Span & Pick<EquipmentRateRow, "name" | "unit">>(rates: readonly T[], day: string): T[] {
  const order = (unit: EquipmentRateUnit) => EQUIPMENT_RATE_UNITS.findIndex((row) => row.value === unit);
  return rates
    .filter((rate) => covers(rate, day))
    .sort((a, b) => a.name.localeCompare(b.name) || order(a.unit) - order(b.unit));
}

export type RateStanding = "in force" | "not yet in effect" | "ended";

export function rateStanding(rate: Span, today: string): RateStanding {
  if (rate.effectiveFrom > today) return "not yet in effect";
  return rate.effectiveTo && rate.effectiveTo < today ? "ended" : "in force";
}

const overlaps = (a: Span, b: Span) =>
  a.effectiveFrom <= (b.effectiveTo ?? "9999-12-31") && b.effectiveFrom <= (a.effectiveTo ?? "9999-12-31");

/** Two prices for one machine on one day would make a pick a guess. The same name
 * in another unit is fine: a lift has a day rate and a week rate. */
export function overlapProblem(
  candidate: Span & Pick<EquipmentRateRow, "name" | "unit"> & { id?: string },
  others: readonly (Span & Pick<EquipmentRateRow, "id" | "name" | "unit">)[],
): string | null {
  const name = candidate.name.trim().toLowerCase();
  const clash = others.find(
    (other) =>
      other.id !== candidate.id &&
      other.unit === candidate.unit &&
      other.name.trim().toLowerCase() === name &&
      overlaps(candidate, other),
  );
  if (!clash) return null;
  return `${candidate.name} already has a ${unitLabel(candidate.unit)} rate from ${clash.effectiveFrom}. End that one first, or change the dates.`;
}
