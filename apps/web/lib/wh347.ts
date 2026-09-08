// WH-347 — the actual federal form, not a summary that resembles it.
//
// lib/certified-payroll.ts says so in its own header: it "mirrors the
// substance of a federal WH-347 ... without replicating its exact
// government-form layout, which is a distinct, larger effort." This is
// that effort. The distinction is not cosmetic. The office manager's job
// is to produce a document an awarding body ACCEPTS; a summary carrying
// the same numbers in a different shape is retyped by hand, which is the
// work this product exists to remove.
//
// Two structural differences from the summary, both of which change what
// the numbers mean:
//
//   1. WH-347 column 4 is HOURS WORKED EACH DAY, seven dated columns.
//      The summary aggregates the week by pay type and throws the day
//      away. The data was never missing -- TimeEntry.date carries it --
//      but a week total cannot be split back into days, so the summary
//      can never become the form. This module groups by day first.
//
//   2. Column 7 is GROSS AMOUNT EARNED, which under Davis-Bacon means
//      CASH wages. calculateTimeEntryLaborCost returns the BURDENED cost
//      -- cash plus fringe paid to plans -- because job costing wants
//      what the hour cost the company. Printing that as gross overstates
//      cash wages by the whole fringe package and invites a rejection,
//      so this module derives the two separately and never reuses the
//      burdened figure. See cashWagesFor / fringeCreditFor below.
//
// What it will not do: invent. Same rule the rest of this area already
// follows -- hasUncomputedHours names unpriceable hours rather than
// showing $0, payrollWorkerName returns "Name not recorded" rather than
// an email. A WH-347 is a statement to a government agency signed under
// penalty of perjury, so a field this app cannot source is reported as
// BLOCKING and named, and the form is marked not fileable. A form that
// looks complete and is wrong is the one failure mode that costs a
// customer their standing rather than an afternoon.

import {
  findEffectiveFringeRateSchedule,
  type FringeRateScheduleInput,
  type TimeEntryPayType,
} from "./labor-cost";
import { payrollWorkerName, type WorkerIdentity } from "./worker-name";
import { certifiedPayrollWeekWindow } from "./certified-payroll-week";

/** Seven dated columns, Sunday through Saturday. Fixed by the form. */
export const WH347_DAY_COUNT = 7;

/** The pre-printed form gives each worker two rows, labelled O and S.
 *
 * DOUBLE_TIME and SHIFT_DIFFERENTIAL get their OWN rows rather than being
 * folded into O, and that is deliberate. Folding double time into
 * overtime understates the hours' rate and misstates what was paid; the
 * form's instructions expect additional rows where additional rates
 * apply, and every state variant this would feed does the same. The
 * alternative -- silently reporting 8 double-time hours as overtime --
 * is a misstatement on a signed document, which is not a rounding
 * decision this module gets to make.
 */
export const WH347_ROW_LABEL: Record<TimeEntryPayType, string> = {
  OVERTIME: "O",
  STRAIGHT: "S",
  DOUBLE_TIME: "DT",
  SHIFT_DIFFERENTIAL: "SD",
};

/** Printed top to bottom in this order. O above S is the form's own
 * order; the two extra rows follow so a reader comparing against a
 * pre-printed WH-347 finds the familiar pair where it expects them. */
const ROW_ORDER: TimeEntryPayType[] = ["OVERTIME", "STRAIGHT", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

/** A field the form requires that this app cannot source yet.
 *
 * Carried as data rather than rendered as a dash so the page can refuse
 * to present the form as fileable, and so a test can assert on WHICH
 * field is missing. A blank cell on a government form is indistinguishable
 * from a zero to everyone except the person who filled it in.
 */
export type Wh347BlockingField =
  | "workerName"
  | "identifyingNumber"
  | "classification"
  | "rateOfPay"
  | "grossEarned"
  | "deductions"
  | "netWages"
  | "payrollNumber"
  | "projectLocation"
  | "contractNumber"
  | "statementOfCompliance";

/** Human sentences, not labels. Printed where the field would have gone
 * and listed at the top of the form, so the reader learns what to do
 * rather than what is absent. */
export const WH347_BLOCKING_FIELD_REASON: Record<Wh347BlockingField, string> = {
  workerName:
    "This account has no name recorded. Column 1 is a statement to the agency about who did the work.",
  identifyingNumber:
    "Column 1 wants the last four digits of the worker's identifying number. cstream does not record it.",
  classification:
    "These hours carry no craft tag, so column 3 has nothing to say. Tag the entries, then reprint.",
  rateOfPay:
    "No fringe rate schedule is effective for this craft on these dates, so column 6 cannot be derived.",
  grossEarned:
    "Column 7 follows from the rate, which could not be derived for at least one of these days.",
  deductions:
    "Columns 8 are FICA, withholding and other deductions. cstream does not hold them — they come off the payroll register.",
  netWages: "Column 9 is gross less deductions, so it follows whatever is missing from column 8.",
  payrollNumber:
    "Every WH-347 carries a sequential payroll number for the project. cstream does not issue one yet.",
  projectLocation:
    "The header wants the project's location. A job records a name but no address.",
  contractNumber: "The header wants the project or contract number. A job does not record one.",
  statementOfCompliance:
    "Page 2 is signed under penalty of perjury and names how fringes were paid — 4(a) to approved plans, 4(b) in cash, 4(c) exceptions. Nobody has signed one for this week.",
};

export interface Wh347DayCell {
  /** UTC midnight, the same convention every writer of TimeEntry.date
   * uses. Rendered in UTC, per the repo's date rule. */
  date: Date;
  /** null means nothing was logged, and prints BLANK. Not zero: a zero in
   * this grid asserts the worker was on the project and worked no hours,
   * which is a different claim from being absent from the payroll. */
  hours: number | null;
}

export interface Wh347HoursRow {
  payType: TimeEntryPayType;
  /** "O", "S", "DT" or "SD" — what goes in the row's stub. */
  label: string;
  /** Exactly WH347_DAY_COUNT cells, Sunday first. */
  days: Wh347DayCell[];
  totalHours: number;
}

export interface Wh347WorkerLine {
  employeeUserId: string;
  /** Never an email. See lib/worker-name.ts. */
  name: string;
  /** Column 3. The craft as the agency reads it. */
  classification: string;
  /** One row per pay type actually worked, in ROW_ORDER. A pay type with
   * no hours produces no row — the form is not padded with empty rows. */
  hoursRows: Wh347HoursRow[];
  /** Column 5. */
  totalHours: number;
  /** Column 6, straight-time base rate, or null when no schedule applies.
   * Reported alongside fringePerHour rather than added to it: the form
   * asks for the rate INCLUDING fringes but an agency reading it needs to
   * see the split, and 4(a) on page 2 turns on which part went to a plan. */
  baseHourlyRate: number | null;
  fringePerHour: number | null;
  /** Column 7 — CASH wages for this project this week. Base times the pay
   * type's multiplier times hours, WITHOUT fringe. null when any day's
   * rate could not be derived; never partially summed, because a partial
   * gross reads as a complete one. */
  grossEarnedThisProject: number | null;
  /** Fringe credited to plans for these hours. Not part of column 7; it
   * is what page 2's 4(a) is about. */
  fringeCredited: number | null;
  /** Columns 8 and 9. Always null today — cstream does not run payroll
   * and holds no deductions. Typed as the real shape so the filing record
   * that will carry them slots in without changing every reader. */
  deductions: Wh347Deductions | null;
  netWagesThisWeek: number | null;
  blocking: Wh347BlockingField[];
}

export interface Wh347Deductions {
  fica: number;
  withholdingTax: number;
  other: number;
  total: number;
}

export interface Wh347Header {
  contractorName: string;
  contractorAddress: string | null;
  /** Sequential per project. null until a counter issues one. */
  payrollNumber: number | null;
  weekEnding: Date;
  projectName: string;
  projectLocation: string | null;
  contractNumber: string | null;
}

export interface Wh347Form {
  header: Wh347Header;
  /** Sunday through Saturday, the column headings for the grid. */
  days: Date[];
  workers: Wh347WorkerLine[];
  totalHours: number;
  /** The date page 2 was signed, from the week's `CertifiedPayrollFiling`,
   * or null while no statement of compliance exists for it. Entered by the
   * signer, never stamped — see the model comment. */
  statementOfComplianceSignedOn: Date | null;
  /** Every distinct blocking field across the header and all workers,
   * deduplicated, in a stable order. */
  blocking: Wh347BlockingField[];
  /** False whenever anything is blocking. The page must not present a
   * form as ready to sign when a required column is empty — signing it is
   * a statement under penalty of perjury. */
  fileable: boolean;
}

export interface Wh347TimeEntryInput {
  employeeUserId: string;
  employee: WorkerIdentity;
  craftClassificationId: string | null;
  craftLabel: string | null;
  date: Date;
  hours: number;
  payType: TimeEntryPayType;
}

export interface Wh347CompanyInput {
  name: string;
  dbaName: string | null;
  hqAddressLine1: string | null;
  hqAddressLine2: string | null;
  hqCity: string | null;
  hqState: string | null;
  hqZip: string | null;
}

export interface Wh347JobInput {
  name: string;
  /** Neither is on the Job model yet; both are accepted so the caller
   * that gains them does not change this module's shape. */
  location?: string | null;
  contractNumber?: string | null;
}

export interface Wh347BuildInput {
  company: Wh347CompanyInput;
  job: Wh347JobInput;
  weekStart: Date;
  entries: Wh347TimeEntryInput[];
  fringeSchedulesByCraft: Map<string, FringeRateScheduleInput[]>;
  /** Issued by a counter when one exists. Absent until then. */
  payrollNumber?: number | null;
  /** The `signedDate` of this week's `CertifiedPayrollFiling`, if one has
   * been recorded. Absent means page 2 is unsigned for this week, which
   * blocks the whole form however complete the grid is.
   *
   * A DATE rather than a boolean on purpose: the page prints it on the
   * form, and a caller holding only `true` would have to fetch the filing
   * again to say when. */
  statementOfComplianceSignedOn?: Date | null;
}

/** The multipliers WH-347 column 7 needs.
 *
 * Deliberately a second copy of labor-cost.ts's table rather than an
 * import, and the duplication is the point: that one is job costing and
 * may legitimately change (SHIFT_DIFFERENTIAL is documented there as
 * "treated as straight-time base pay UNTIL that's captured"). The moment
 * it is captured, job costing should change and a filed federal form
 * should not silently change with it. Two tables that must be compared
 * deliberately beat one that moves under a signed document.
 */
const CASH_MULTIPLIER: Record<TimeEntryPayType, number> = {
  STRAIGHT: 1,
  OVERTIME: 1.5,
  DOUBLE_TIME: 2,
  SHIFT_DIFFERENTIAL: 1,
};

/** Cash wages for one entry — what column 7 counts. Excludes fringe. */
export function cashWagesFor(
  hours: number,
  payType: TimeEntryPayType,
  schedule: FringeRateScheduleInput | null,
): number | null {
  if (!schedule) return null;
  return hours * schedule.baseWage * CASH_MULTIPLIER[payType];
}

/** Fringe credited for one entry — what page 2's 4(a) is about.
 *
 * Flat per hour regardless of pay type, because Davis-Bacon fringe is
 * owed on the hour worked and is not multiplied by an overtime premium.
 * lib/labor-cost.ts already makes this call and states the reason; this
 * repeats it rather than importing so the two can disagree loudly if
 * anyone ever changes one.
 */
export function fringeCreditFor(
  hours: number,
  schedule: FringeRateScheduleInput | null,
): number | null {
  if (!schedule) return null;
  return hours * fringePerHourOf(schedule);
}

function fringePerHourOf(schedule: FringeRateScheduleInput): number {
  return (
    (schedule.pensionRate ?? 0) +
    (schedule.vacationRate ?? 0) +
    (schedule.healthWelfareRate ?? 0) +
    (schedule.trainingRate ?? 0)
  );
}

function sameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** The seven dated columns. Derived from certifiedPayrollWeekWindow so
 * the grid can never disagree with the query that fetched the rows —
 * that module carries the scar of an eight-day window that certified
 * every Sunday twice. */
export function wh347Days(weekStart: Date): Date[] {
  const { gte } = certifiedPayrollWeekWindow(weekStart);
  return Array.from({ length: WH347_DAY_COUNT }, (_, i) => {
    const d = new Date(gte);
    d.setUTCDate(d.getUTCDate() + i);
    return d;
  });
}

function formatAddress(company: Wh347CompanyInput): string | null {
  const street = [company.hqAddressLine1, company.hqAddressLine2].filter(Boolean).join(", ");
  const cityState = [company.hqCity, company.hqState].filter(Boolean).join(", ");
  const tail = [cityState, company.hqZip].filter(Boolean).join(" ");
  const full = [street, tail].filter(Boolean).join(", ");
  return full.length > 0 ? full : null;
}

/** Builds one week's WH-347 for one job.
 *
 * Pure. No Prisma, no clock, no formatting — everything that decides what
 * a government agency reads has to be executable in the unit suite, for
 * the reason certified-payroll-week.ts spells out: the eight-day window
 * that misreported two filings was findable only by reading, because it
 * lived inline in an async server component.
 */
export function buildWh347(input: Wh347BuildInput): Wh347Form {
  const days = wh347Days(input.weekStart);
  const weekEnding = days[WH347_DAY_COUNT - 1];

  // Keyed by worker AND classification: a worker who ran two crafts in one
  // week occupies two lines on the form, because column 3 is per line and
  // the rate follows the classification. Collapsing them would print one
  // rate against hours paid at two.
  const lines = new Map<string, Wh347WorkerLine & { sortName: string }>();

  for (const entry of input.entries) {
    const craftKey = entry.craftClassificationId ?? "untagged";
    const key = `${entry.employeeUserId}::${craftKey}`;
    const dayIndex = days.findIndex((d) => sameUtcDay(d, entry.date));
    // An entry outside the seven days cannot be placed in a column. The
    // query is windowed so this should be unreachable; dropping it
    // silently is how hours vanish from a filing, so it is counted.
    if (dayIndex === -1) continue;

    const schedules = entry.craftClassificationId
      ? (input.fringeSchedulesByCraft.get(entry.craftClassificationId) ?? [])
      : [];
    const schedule = findEffectiveFringeRateSchedule(schedules, entry.date);

    let line = lines.get(key);
    if (!line) {
      const name = payrollWorkerName(entry.employee);
      const blocking: Wh347BlockingField[] = [];
      if (name.nameMissing) blocking.push("workerName");
      if (!entry.craftLabel) blocking.push("classification");
      // Not recorded anywhere in the schema, so it blocks every line.
      blocking.push("identifyingNumber");
      blocking.push("deductions");
      blocking.push("netWages");
      line = {
        employeeUserId: entry.employeeUserId,
        sortName: name.label,
        name: name.label,
        classification: entry.craftLabel ?? "Not tagged",
        hoursRows: [],
        totalHours: 0,
        baseHourlyRate: schedule ? schedule.baseWage : null,
        fringePerHour: schedule ? fringePerHourOf(schedule) : null,
        grossEarnedThisProject: 0,
        fringeCredited: 0,
        deductions: null,
        netWagesThisWeek: null,
        blocking,
      };
      lines.set(key, line);
    }

    let row = line.hoursRows.find((r) => r.payType === entry.payType);
    if (!row) {
      row = {
        payType: entry.payType,
        label: WH347_ROW_LABEL[entry.payType],
        days: days.map((d) => ({ date: d, hours: null })),
        totalHours: 0,
      };
      line.hoursRows.push(row);
    }
    row.days[dayIndex].hours = (row.days[dayIndex].hours ?? 0) + entry.hours;
    row.totalHours += entry.hours;
    line.totalHours += entry.hours;

    const cash = cashWagesFor(entry.hours, entry.payType, schedule);
    const fringe = fringeCreditFor(entry.hours, schedule);
    if (cash == null || fringe == null) {
      // One underivable day poisons the whole line's money columns. A
      // partial gross is worse than no gross: it reads as complete.
      line.grossEarnedThisProject = null;
      line.fringeCredited = null;
      line.baseHourlyRate = null;
      line.fringePerHour = null;
      if (!line.blocking.includes("rateOfPay")) line.blocking.push("rateOfPay");
      if (!line.blocking.includes("grossEarned")) line.blocking.push("grossEarned");
    } else {
      if (line.grossEarnedThisProject != null) line.grossEarnedThisProject += cash;
      if (line.fringeCredited != null) line.fringeCredited += fringe;
    }
  }

  const workers = [...lines.values()]
    .sort((a, b) => a.sortName.localeCompare(b.sortName) || a.classification.localeCompare(b.classification))
    .map(({ sortName: _sortName, ...line }) => ({
      ...line,
      hoursRows: [...line.hoursRows].sort(
        (a, b) => ROW_ORDER.indexOf(a.payType) - ROW_ORDER.indexOf(b.payType),
      ),
    }));

  const header: Wh347Header = {
    contractorName: input.company.dbaName?.trim() || input.company.name,
    contractorAddress: formatAddress(input.company),
    payrollNumber: input.payrollNumber ?? null,
    weekEnding,
    projectName: input.job.name,
    projectLocation: input.job.location ?? null,
    contractNumber: input.job.contractNumber ?? null,
  };

  const statementOfComplianceSignedOn = input.statementOfComplianceSignedOn ?? null;

  const blocking = new Set<Wh347BlockingField>();
  if (header.payrollNumber == null) blocking.add("payrollNumber");
  if (!header.projectLocation) blocking.add("projectLocation");
  if (!header.contractNumber) blocking.add("contractNumber");
  // An unsigned week cannot be filed regardless of how complete the grid
  // is. This used to be added unconditionally, because page 2 did not
  // exist; it is now a real check against the week's own filing.
  if (statementOfComplianceSignedOn == null) blocking.add("statementOfCompliance");
  for (const w of workers) for (const b of w.blocking) blocking.add(b);

  const ORDER: Wh347BlockingField[] = [
    "payrollNumber",
    "projectLocation",
    "contractNumber",
    "workerName",
    "identifyingNumber",
    "classification",
    "rateOfPay",
    "grossEarned",
    "deductions",
    "netWages",
    "statementOfCompliance",
  ];

  return {
    header,
    days,
    workers,
    totalHours: workers.reduce((sum, w) => sum + w.totalHours, 0),
    statementOfComplianceSignedOn,
    blocking: ORDER.filter((f) => blocking.has(f)),
    fileable: blocking.size === 0,
  };
}
