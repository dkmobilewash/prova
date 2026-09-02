// The monthly fringe remittance to the trust funds, computed from hours
// actually logged.
//
// Pure arithmetic over rows handed in, reusing lib/labor-cost.ts's
// effective-schedule lookup rather than a second copy of it — the rate
// that applies to an hour is one question with one answer, and two
// implementations of it would eventually disagree about a historical
// month.
//
// The four components are broken out (pension, vacation, health &
// welfare, training) because that is how a remittance form is filled in:
// each fund is a separate line and a separate cheque. A single "fringe"
// total would have to be taken apart again by hand, which is the manual
// re-entry this whole product exists to remove.
//
// Fringe is paid at the flat per-hour rate REGARDLESS of pay type — an
// overtime hour earns time-and-a-half on the base wage and the same
// fringe as any other hour. That is the Davis-Bacon convention
// lib/labor-cost.ts already follows, and getting it wrong would overstate
// every remittance in a month with overtime in it.

import {
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
} from "./labor-cost";

export interface RemittanceEntryInput {
  date: Date;
  hours: number;
  craftClassificationId: string | null;
  craftLabel: string | null;
  unionLocalId: string | null;
  unionLocalLabel: string | null;
  employeeName: string;
  jobName: string;
}

export interface FringeComponents {
  pension: number;
  vacation: number;
  healthWelfare: number;
  training: number;
}

export interface RemittanceCraftRow {
  craftClassificationId: string;
  craftLabel: string;
  hours: number;
  components: FringeComponents;
  total: number;
  /** Hours on this craft with no schedule effective on their date. They
   * are counted in `hours` and contribute nothing to the money, and the
   * flag is what stops the total reading as complete. */
  uncomputedHours: number;
}

export interface RemittanceLocalRow {
  unionLocalId: string;
  unionLocalLabel: string;
  crafts: RemittanceCraftRow[];
  hours: number;
  components: FringeComponents;
  total: number;
  uncomputedHours: number;
}

export interface RemittanceReport {
  periodStart: string;
  periodEnd: string;
  locals: RemittanceLocalRow[];
  totalHours: number;
  total: number;
  /** Hours that could not be priced at all — no craft tag, or no schedule
   * effective on the date. Reported, never silently valued at zero. */
  uncomputedHours: number;
  /** Employees behind those hours, so the gap can be chased rather than
   * merely noted. */
  uncomputedNames: string[];
}

const zero = (): FringeComponents => ({ pension: 0, vacation: 0, healthWelfare: 0, training: 0 });

function addInto(target: FringeComponents, source: FringeComponents) {
  target.pension += source.pension;
  target.vacation += source.vacation;
  target.healthWelfare += source.healthWelfare;
  target.training += source.training;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function roundComponents(components: FringeComponents): FringeComponents {
  return {
    pension: round2(components.pension),
    vacation: round2(components.vacation),
    healthWelfare: round2(components.healthWelfare),
    training: round2(components.training),
  };
}

function sum(components: FringeComponents) {
  return round2(
    components.pension + components.vacation + components.healthWelfare + components.training,
  );
}

/**
 * Rolls a period's hours up into what is owed to each trust fund.
 *
 * Grouped by union local first and craft classification second, because
 * that is the shape of the filing: one remittance per local, itemised by
 * classification. An hour with no craft tag, or whose craft has no
 * schedule effective on its date, contributes HOURS and no money, and is
 * counted in `uncomputedHours` — the same rule lib/certified-payroll.ts
 * already follows. A remittance that quietly valued those at zero would
 * under-report a real liability to a trust fund, which is the expensive
 * direction to be wrong in.
 */
export function buildRemittanceReport(
  entries: RemittanceEntryInput[],
  schedulesByCraft: Map<string, FringeRateScheduleInput[]>,
  periodStart: string,
  periodEnd: string,
): RemittanceReport {
  const locals = new Map<string, RemittanceLocalRow>();
  const uncomputedNames = new Set<string>();
  let totalHours = 0;
  let uncomputedHours = 0;

  for (const entry of entries) {
    totalHours += entry.hours;

    const schedule = entry.craftClassificationId
      ? findEffectiveFringeRateSchedule(
          schedulesByCraft.get(entry.craftClassificationId) ?? [],
          entry.date,
        )
      : null;

    if (!entry.craftClassificationId || !entry.unionLocalId || !schedule) {
      uncomputedHours += entry.hours;
      uncomputedNames.add(entry.employeeName);
      // Still recorded against its local when we know it, so the hours
      // show on the right filing even though the money cannot.
      if (entry.unionLocalId && entry.craftClassificationId) {
        const local = locals.get(entry.unionLocalId) ?? {
          unionLocalId: entry.unionLocalId,
          unionLocalLabel: entry.unionLocalLabel ?? "Unnamed local",
          crafts: [],
          hours: 0,
          components: zero(),
          total: 0,
          uncomputedHours: 0,
        };
        const craft = local.crafts.find((c) => c.craftClassificationId === entry.craftClassificationId);
        if (craft) {
          craft.hours += entry.hours;
          craft.uncomputedHours += entry.hours;
        } else {
          local.crafts.push({
            craftClassificationId: entry.craftClassificationId,
            craftLabel: entry.craftLabel ?? "Unnamed classification",
            hours: entry.hours,
            components: zero(),
            total: 0,
            uncomputedHours: entry.hours,
          });
        }
        local.hours += entry.hours;
        local.uncomputedHours += entry.hours;
        locals.set(entry.unionLocalId, local);
      }
      continue;
    }

    const components: FringeComponents = {
      pension: (schedule.pensionRate ?? 0) * entry.hours,
      vacation: (schedule.vacationRate ?? 0) * entry.hours,
      healthWelfare: (schedule.healthWelfareRate ?? 0) * entry.hours,
      training: (schedule.trainingRate ?? 0) * entry.hours,
    };

    const local = locals.get(entry.unionLocalId) ?? {
      unionLocalId: entry.unionLocalId,
      unionLocalLabel: entry.unionLocalLabel ?? "Unnamed local",
      crafts: [],
      hours: 0,
      components: zero(),
      total: 0,
      uncomputedHours: 0,
    };

    let craft = local.crafts.find((c) => c.craftClassificationId === entry.craftClassificationId);
    if (!craft) {
      craft = {
        craftClassificationId: entry.craftClassificationId,
        craftLabel: entry.craftLabel ?? "Unnamed classification",
        hours: 0,
        components: zero(),
        total: 0,
        uncomputedHours: 0,
      };
      local.crafts.push(craft);
    }

    craft.hours += entry.hours;
    addInto(craft.components, components);
    local.hours += entry.hours;
    addInto(local.components, components);
    locals.set(entry.unionLocalId, local);
  }

  const localRows = [...locals.values()]
    .map((local) => ({
      ...local,
      hours: round2(local.hours),
      uncomputedHours: round2(local.uncomputedHours),
      components: roundComponents(local.components),
      total: sum(local.components),
      crafts: local.crafts
        .map((craft) => ({
          ...craft,
          hours: round2(craft.hours),
          uncomputedHours: round2(craft.uncomputedHours),
          components: roundComponents(craft.components),
          total: sum(craft.components),
        }))
        .sort((a, b) => a.craftLabel.localeCompare(b.craftLabel)),
    }))
    .sort((a, b) => a.unionLocalLabel.localeCompare(b.unionLocalLabel));

  return {
    periodStart,
    periodEnd,
    locals: localRows,
    totalHours: round2(totalHours),
    total: round2(localRows.reduce((s, local) => s + local.total, 0)),
    uncomputedHours: round2(uncomputedHours),
    uncomputedNames: [...uncomputedNames].sort(),
  };
}

/** Whether a filed UNION_FRINGE_BENEFIT_FILING covers the whole period.
 *
 * A document whose period merely overlaps is not evidence the period was
 * filed — the same rule the certified-payroll alert applies to a week, and
 * for the same reason: a partial filing hides a real gap. */
export function periodIsFiled(
  filings: { periodStart: string | null; periodEnd: string | null }[],
  periodStart: string,
  periodEnd: string,
): boolean {
  return filings.some(
    (f) => f.periodStart !== null && f.periodEnd !== null && f.periodStart <= periodStart && f.periodEnd >= periodEnd,
  );
}
