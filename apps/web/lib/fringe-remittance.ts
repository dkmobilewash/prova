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
//
// ----------------------------------------------------------------------
// WHO WORKED THE HOURS IS PART OF THE ANSWER, NOT A DETAIL OF IT.
//
// This module used to roll up to local -> classification and stop there.
// That answers "what do I owe", which is the /union-compliance question,
// and it CANNOT BE FILED. A trust fund credits hours to INDIVIDUAL
// MEMBERS' accounts, because that is how pension vesting and health &
// welfare eligibility work — a member needs N hours in a period to stay
// covered. "Local 300, Journeyman Drywall, 480 hours, $10,368" tells the
// fund how much money is coming and gives it nobody to credit, so the
// office manager re-derives per-person hours by hand: the exact re-entry
// this product exists to remove.
//
// Identity survived in exactly one place — `uncomputedNames`, the people
// behind hours that could NOT be priced. So it was discarded for every
// hour that DID price and kept only for the ones that did not, which is
// backwards. Every priced hour now carries its member through to a line:
// local -> classification -> member.
//
// ONE PERSON, TWO CLASSIFICATIONS IN A MONTH IS TWO LINES. The rates
// differ, the fund needs both, and a blended per-hour rate is a number
// that appears in no agreement. The member dimension therefore hangs off
// the CRAFT row rather than off the local, so the split is structural —
// there is no place to put a collapsed line even if somebody wanted one.
//
// ----------------------------------------------------------------------
// ROUNDING: ROUNDED AT THE MEMBER LINE, THEN SUMMED. Stated once, here,
// because a remittance whose lines do not add up to its own total gets
// bounced by the fund's clerk before anyone looks at the money.
//
// The smallest thing printed and credited is one member's amount for one
// fund on one classification. Rounding each member's exact share
// independently would not add to the classification figure this module
// already publishes (half-hours are everywhere in timesheets, and two
// shares of x.xx5 round up into a cent nobody owes). So each member's
// cents are allocated out of the classification's already-rounded figure
// by LARGEST REMAINDER: no member is credited a fraction of a cent, and
// no cent is invented or lost. See `allocateToCents`.
//
// The consequence, which is the property worth stating: every figure
// above the member line is the EXACT sum of the lines beneath it, at
// every level, with no second rounding applied to an already-rounded
// number. `reconcilesToCraftRows` asserts it and is exported so a
// document can re-check it before printing.

import {
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
  type TimeEntryPayType,
} from "./labor-cost";
import type { PayrollWorkerName } from "./worker-name";

export interface RemittanceEntryInput {
  date: Date;
  hours: number;
  /** Carried so that "fringe ignores pay type" is a rule this code COULD
   * break, and therefore one a test can catch it breaking. Without it
   * there was nothing to multiply by, so the test asserting the rule
   * compared two identical calls and passed against any implementation
   * whatsoever. */
  payType: TimeEntryPayType;
  craftClassificationId: string | null;
  craftLabel: string | null;
  unionLocalId: string | null;
  unionLocalLabel: string | null;
  /** The member these hours are credited to. An ID, not a label: two
   * people with no name recorded on their account are two members with
   * two accounts to credit, and keying on the printed label would merge
   * them into one line for one person who does not exist. */
  employeeUserId: string;
  /** The name to PRINT, as produced by `payrollWorkerName()` in
   * lib/worker-name.ts — never an email address, because the name column
   * on a remittance is a statement to a trust fund about who did the
   * work. Passed in already resolved so this module holds no name policy
   * of its own and cannot acquire an email path by accident. */
  employeeFilingName: PayrollWorkerName;
  /** Internal display string, feeding `uncomputedNames` only. Kept
   * separate from `employeeFilingName` because that list is an internal
   * chase-list on /union-compliance, not a filed document. */
  employeeName: string;
  jobName: string;
}

export interface FringeComponents {
  pension: number;
  vacation: number;
  healthWelfare: number;
  training: number;
}

/**
 * One member's hours on one classification, under one local.
 *
 * This is the smallest thing a trust fund can act on: it credits the
 * hours to this person's account. A row is per CLASSIFICATION, so a
 * member who worked two crafts in the month has two of these under two
 * different `RemittanceCraftRow`s, at the two rates that actually
 * applied — never one line at a blended rate that appears in no
 * agreement.
 */
export interface RemittanceEmployeeRow {
  employeeUserId: string;
  /** Safe to print on a filing. Never an email address — see
   * lib/worker-name.ts. */
  employeeName: string;
  /** True when nobody has recorded a name on the account, so
   * `employeeName` is a placeholder. The filing is not ready: a fund
   * cannot credit "Name not recorded". */
  nameMissing: boolean;
  hours: number;
  components: FringeComponents;
  total: number;
  /** This member's hours on this classification with no schedule
   * effective on their date. Counted in `hours`, contributing nothing to
   * the money. `isWhollyUnpriced` reads this row directly — a member line
   * showing $0.00 would state to the fund that nothing is owed for this
   * person, which is a different and false claim. */
  uncomputedHours: number;
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
  /** The members behind this row. Their `hours`, `uncomputedHours` and
   * each of their four `components` sum EXACTLY to the figures above —
   * see the rounding note at the top of this file, and
   * `reconcilesToCraftRows`. Sorted by printed name, then by id so two
   * members with no name recorded keep a stable order. */
  employees: RemittanceEmployeeRow[];
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

const FUNDS = ["pension", "vacation", "healthWelfare", "training"] as const;
type FundKey = (typeof FUNDS)[number];

function toCents(amount: number) {
  return Math.round(amount * 100);
}

/**
 * Splits a rounded cent figure across the exact shares that produced it,
 * by LARGEST REMAINDER.
 *
 * The reason this exists rather than `shares.map(round2)`: rounding each
 * share on its own does not reliably add back up to the figure the row
 * above already publishes. Two shares of x.xx5 each round up, inventing a
 * cent that nobody owes; two of x.xx4 each round down, losing one that is
 * owed. On a remittance either is a document whose lines disagree with
 * its own total, which is the thing a fund's clerk checks first.
 *
 * Every whole cent goes to somebody, the split is deterministic (ties
 * broken by position, so the same input always yields the same
 * document), and — the property everything else here depends on — the
 * result sums to `targetCents` exactly, by construction rather than by
 * luck.
 *
 * Shares of zero never receive a residual cent. A member with no priced
 * hours must not be handed a stray cent to make somebody else's rounding
 * work; their line is unpriced, not one-cent-owed.
 */
export function allocateToCents(shares: number[], targetCents: number): number[] {
  const scaled = shares.map((share) => share * 100);
  // The 1e-6 absorbs binary-float noise. 8 * 11.5 * 100 is 9199.999999999998
  // in IEEE 754, and flooring THAT to 9199 would move a cent between two
  // members for a reason that has nothing to do with their hours.
  const floorOf = (value: number) => Math.floor(value + 1e-6);
  const out = scaled.map(floorOf);

  const eligible = shares
    .map((_, index) => index)
    .filter((index) => shares[index] > 0)
    .sort((a, b) => {
      const remainderA = scaled[a] - floorOf(scaled[a]);
      const remainderB = scaled[b] - floorOf(scaled[b]);
      if (remainderB !== remainderA) return remainderB - remainderA;
      return a - b;
    });

  let residual = targetCents - out.reduce((running, cents) => running + cents, 0);
  if (eligible.length === 0) return out;

  for (let k = 0; residual > 0; k += 1) {
    out[eligible[k % eligible.length]] += 1;
    residual -= 1;
  }
  // The mirror case, reachable only from float noise in the other
  // direction. Bounded rather than `while`, because an unbounded loop that
  // cannot find a cent to give back would hang a page render.
  for (let k = 0; residual < 0 && k < eligible.length * 2; k += 1) {
    const index = eligible[eligible.length - 1 - (k % eligible.length)];
    if (out[index] > 0) {
      out[index] -= 1;
      residual += 1;
    }
  }
  return out;
}

/** Exact accumulators. Separate from the output types because these hold
 * unrounded sums and index their children by id; the published rows hold
 * rounded money and sorted arrays. Conflating the two is how a figure
 * ends up rounded twice. */
type EmployeeAcc = {
  employeeUserId: string;
  employeeName: string;
  nameMissing: boolean;
  hours: number;
  uncomputedHours: number;
  components: FringeComponents;
};

type CraftAcc = {
  craftClassificationId: string;
  craftLabel: string;
  hours: number;
  uncomputedHours: number;
  components: FringeComponents;
  employees: Map<string, EmployeeAcc>;
};

type LocalAcc = {
  unionLocalId: string;
  unionLocalLabel: string;
  crafts: Map<string, CraftAcc>;
};

function finalizeCraft(craft: CraftAcc): RemittanceCraftRow {
  // Sorted by the name that will be PRINTED, then by id — so two members
  // with no name recorded render in a stable order instead of swapping
  // places between two reads of the same month.
  const employees = [...craft.employees.values()].sort(
    (a, b) =>
      a.employeeName.localeCompare(b.employeeName) || a.employeeUserId.localeCompare(b.employeeUserId),
  );

  const components = roundComponents(craft.components);
  const hours = round2(craft.hours);
  const uncomputedHours = round2(craft.uncomputedHours);

  const hoursCents = allocateToCents(
    employees.map((e) => e.hours),
    toCents(hours),
  );
  const uncomputedCents = allocateToCents(
    employees.map((e) => e.uncomputedHours),
    toCents(uncomputedHours),
  );
  const fundCents = Object.fromEntries(
    FUNDS.map((fund) => [
      fund,
      allocateToCents(
        employees.map((e) => e.components[fund]),
        toCents(components[fund]),
      ),
    ]),
  ) as Record<FundKey, number[]>;

  const employeeRows = employees.map((employee, index) => {
    const employeeComponents: FringeComponents = {
      pension: fundCents.pension[index] / 100,
      vacation: fundCents.vacation[index] / 100,
      healthWelfare: fundCents.healthWelfare[index] / 100,
      training: fundCents.training[index] / 100,
    };
    return {
      employeeUserId: employee.employeeUserId,
      employeeName: employee.employeeName,
      nameMissing: employee.nameMissing,
      hours: hoursCents[index] / 100,
      components: employeeComponents,
      total: sum(employeeComponents),
      uncomputedHours: uncomputedCents[index] / 100,
    };
  });

  return {
    craftClassificationId: craft.craftClassificationId,
    craftLabel: craft.craftLabel,
    hours,
    components,
    total: sum(components),
    uncomputedHours,
    employees: employeeRows,
  };
}

/**
 * Rolls a period's hours up into what is owed to each trust fund.
 *
 * Grouped by union local first, craft classification second and MEMBER
 * third, because that is the shape of the filing: one remittance per
 * local, itemised by classification, crediting named individuals. The
 * member level is not decoration — a fund posts hours to a person's
 * account, and a report without it has to be re-derived by hand before it
 * can be sent. An hour with no craft tag, or whose craft has no
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
  const locals = new Map<string, LocalAcc>();
  const uncomputedNames = new Set<string>();
  let totalHours = 0;
  let uncomputedHours = 0;

  /** Finds or opens the local -> craft -> member buckets an entry belongs
   * in. One helper rather than the two near-identical inline copies this
   * used to carry, because those two copies were where a member could be
   * opened on one path and not the other. */
  const bucketsFor = (entry: RemittanceEntryInput, unionLocalId: string, craftClassificationId: string) => {
    const local = locals.get(unionLocalId) ?? {
      unionLocalId,
      unionLocalLabel: entry.unionLocalLabel ?? "Unnamed local",
      crafts: new Map<string, CraftAcc>(),
    };
    locals.set(unionLocalId, local);

    const craft = local.crafts.get(craftClassificationId) ?? {
      craftClassificationId,
      craftLabel: entry.craftLabel ?? "Unnamed classification",
      hours: 0,
      uncomputedHours: 0,
      components: zero(),
      employees: new Map<string, EmployeeAcc>(),
    };
    local.crafts.set(craftClassificationId, craft);

    // Keyed on the user id, never on the printed name: two members with
    // no name recorded are two accounts the fund has to credit, and
    // merging them would credit one of them with the other's hours.
    const employee = craft.employees.get(entry.employeeUserId) ?? {
      employeeUserId: entry.employeeUserId,
      employeeName: entry.employeeFilingName.label,
      nameMissing: entry.employeeFilingName.nameMissing,
      hours: 0,
      uncomputedHours: 0,
      components: zero(),
    };
    craft.employees.set(entry.employeeUserId, employee);

    return { craft, employee };
  };

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
      // show on the right filing even though the money cannot — and
      // against the MEMBER, so the fund is told whose hours they are.
      // Their line carries hours and no money and is flagged unpriced;
      // it must never print as $0.00, which would tell the fund nothing
      // is owed for this person rather than that nobody has priced them.
      if (entry.unionLocalId && entry.craftClassificationId) {
        const { craft, employee } = bucketsFor(entry, entry.unionLocalId, entry.craftClassificationId);
        craft.hours += entry.hours;
        craft.uncomputedHours += entry.hours;
        employee.hours += entry.hours;
        employee.uncomputedHours += entry.hours;
      }
      continue;
    }

    // entry.payType is deliberately NOT read. Fringe is a flat per-hour
    // rate; an overtime hour multiplies the BASE wage only. Multiplying
    // here would overstate every remittance in a month with overtime in
    // it — see the header, and lib/labor-cost.ts, which is where the base
    // multiplier legitimately lives.
    const components: FringeComponents = {
      pension: (schedule.pensionRate ?? 0) * entry.hours,
      vacation: (schedule.vacationRate ?? 0) * entry.hours,
      healthWelfare: (schedule.healthWelfareRate ?? 0) * entry.hours,
      training: (schedule.trainingRate ?? 0) * entry.hours,
    };

    const { craft, employee } = bucketsFor(entry, entry.unionLocalId, entry.craftClassificationId);
    craft.hours += entry.hours;
    addInto(craft.components, components);
    employee.hours += entry.hours;
    addInto(employee.components, components);
  }

  // Every figure is the sum of the rows printed beneath it: members add
  // to their classification, classifications add to their local, locals
  // add to the report. Nothing above the member line is rounded a second
  // time, so a reader adding up the column gets the printed total.
  const localRows: RemittanceLocalRow[] = [...locals.values()]
    .map((local) => {
      const crafts = [...local.crafts.values()]
        .map(finalizeCraft)
        .sort((a, b) => a.craftLabel.localeCompare(b.craftLabel));
      const components = zero();
      for (const craft of crafts) addInto(components, craft.components);
      return {
        unionLocalId: local.unionLocalId,
        unionLocalLabel: local.unionLocalLabel,
        crafts,
        hours: round2(crafts.reduce((running, craft) => running + craft.hours, 0)),
        components: roundComponents(components),
        total: round2(crafts.reduce((running, craft) => running + craft.total, 0)),
        uncomputedHours: round2(crafts.reduce((running, craft) => running + craft.uncomputedHours, 0)),
      };
    })
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

/**
 * Every place a member line fails to add up to the row above it, named.
 *
 * Empty means the document can be filed: at every classification, the
 * member lines' hours, unpriced hours, four fund figures and totals sum
 * to the classification's own printed figures, to the cent.
 *
 * Returned as a LIST OF DISCREPANCIES rather than a boolean because a
 * bounced remittance is answered by "which line", not by "no". A document
 * can call this before printing and refuse rather than send a filing a
 * fund's clerk will reject — the arithmetic is guaranteed by construction
 * in `allocateToCents`, and this is the check that the guarantee is still
 * wired up.
 *
 * Compared in integer cents on purpose: `0.1 + 0.2 !== 0.3` in IEEE 754,
 * and a reconciliation check that reports float noise as a discrepancy is
 * a check people learn to ignore.
 */
export function remittanceReconciliationErrors(report: RemittanceReport): string[] {
  const errors: string[] = [];

  for (const local of report.locals) {
    for (const craft of local.crafts) {
      const where = `${local.unionLocalLabel} / ${craft.craftLabel}`;
      const check = (label: string, expected: number, actual: number) => {
        if (toCents(expected) !== toCents(actual)) {
          errors.push(
            `${where}: ${label} — members total ${toCents(actual) / 100}, row says ${toCents(expected) / 100}`,
          );
        }
      };
      const memberSum = (pick: (row: RemittanceEmployeeRow) => number) =>
        craft.employees.reduce((running, row) => running + pick(row), 0);

      check("hours", craft.hours, memberSum((row) => row.hours));
      check("unpriced hours", craft.uncomputedHours, memberSum((row) => row.uncomputedHours));
      for (const fund of FUNDS) {
        check(fund, craft.components[fund], memberSum((row) => row.components[fund]));
      }
      check("total", craft.total, memberSum((row) => row.total));
    }

    const craftSum = (pick: (row: RemittanceCraftRow) => number) =>
      local.crafts.reduce((running, row) => running + pick(row), 0);
    if (toCents(local.total) !== toCents(craftSum((row) => row.total))) {
      errors.push(
        `${local.unionLocalLabel}: total — classifications total ${craftSum((row) => row.total)}, local says ${local.total}`,
      );
    }
  }

  return errors;
}

/**
 * True when NONE of a row's hours could be priced.
 *
 * The table must not print $0.00 across five fund columns for these. The
 * report already counts them as `uncomputedHours` and the copy promises
 * twice that they are "reported as unpriced rather than as $0" — and then
 * rendered five zeroes anyway, which is what anyone reading the column, or
 * exporting it, or adding it up in their head actually takes away. Caught
 * by a browser test; no unit test could see it, because the numbers were
 * right and only the rendering lied.
 *
 * A row with SOME priced hours keeps its money: that money is genuinely
 * owed on the hours that were priced, and blanking it would swing the
 * error the other way.
 */
export function isWhollyUnpriced(row: { hours: number; uncomputedHours: number }): boolean {
  return row.hours > 0 && row.uncomputedHours >= row.hours;
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
