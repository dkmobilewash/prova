// Applying a jurisdiction's overtime rules to a week of entered hours.
//
// Pure arithmetic over rows handed in — no database, no LLM call, same
// family as lib/labor-cost.ts and lib/certified-payroll.ts. A payroll
// clerk will act on what this says, so it has to be reproducible from the
// source rows every time.
//
// WHAT THIS IS NOT. It is not a wage lookup and it never becomes one.
// There is no prevailing-wage dataset in this app; `TimeEntry.payType` is
// still ENTERED by a person, and nothing here rewrites it. What this does
// is compare what was entered against the rules the company recorded for
// that jurisdiction, and report where the two disagree — the same shape as
// compliance-expiry.ts comparing a stored licence status against its date,
// and for the same reason: two facts, both entered by humans, and which
// one is wrong is not knowable from here.
//
// It never guesses a threshold. A rule set with no daily rule recorded
// produces "not checked", never "eight". That distinction is the whole
// honesty of the feature — an app that assumed eight would be asserting
// law it was never told.

export type PayType = "STRAIGHT" | "OVERTIME" | "DOUBLE_TIME" | "SHIFT_DIFFERENTIAL";

export const PAY_TYPES: PayType[] = ["STRAIGHT", "OVERTIME", "DOUBLE_TIME", "SHIFT_DIFFERENTIAL"];

export type HoursByPayType = Record<PayType, number>;

const zeroHours = (): HoursByPayType => ({
  STRAIGHT: 0,
  OVERTIME: 0,
  DOUBLE_TIME: 0,
  SHIFT_DIFFERENTIAL: 0,
});

export interface PrevailingWageRuleSetInput {
  id: string;
  name: string;
  jurisdiction: string;
  /** Null means NO RULE RECORDED. Zero means the premium applies from the
   * first hour, which is how a seventh-day rule is usually written — the
   * two are different and must not be collapsed. */
  dailyOvertimeAfterHours: number | null;
  dailyDoubleTimeAfterHours: number | null;
  weeklyOvertimeAfterHours: number | null;
  seventhDayOvertimeAfterHours: number | null;
  seventhDayDoubleTimeAfterHours: number | null;
  filingDueDays: number | null;
  /** yyyy-mm-dd. */
  effectiveFrom: string;
  effectiveTo: string | null;
}

/**
 * The rule set in force on a date.
 *
 * Same shape and reasoning as findEffectiveFringeRateSchedule: reviewing
 * last year's timesheet has to use last year's rules. `effectiveTo` is
 * inclusive — a rule set ending on the 31st still governs the 31st.
 *
 * Returns null rather than the nearest match. A near-miss silently
 * standing in for the real thing is how a review starts producing
 * confident wrong answers.
 */
export function findEffectiveRuleSet<T extends { effectiveFrom: string; effectiveTo: string | null }>(
  ruleSets: T[],
  dateIso: string,
): T | null {
  return (
    ruleSets.find(
      (rs) => rs.effectiveFrom <= dateIso && (rs.effectiveTo === null || rs.effectiveTo >= dateIso),
    ) ?? null
  );
}

/** Whether this rule set says anything at all about overtime. A rule set
 * recorded only for its filing details is legitimate and simply is not
 * something a timesheet can be checked against. */
export function hasOvertimeRules(ruleSet: PrevailingWageRuleSetInput): boolean {
  return (
    ruleSet.dailyOvertimeAfterHours !== null ||
    ruleSet.dailyDoubleTimeAfterHours !== null ||
    ruleSet.weeklyOvertimeAfterHours !== null ||
    ruleSet.seventhDayOvertimeAfterHours !== null ||
    ruleSet.seventhDayDoubleTimeAfterHours !== null
  );
}

export type DayEntryInput = { date: string; payType: PayType; hours: number };

export type SkipReason =
  /** The day carries shift-differential hours, which are a premium for
   * WHEN the shift ran, not for how long it was. No hours-based rule has
   * anything to say about them, so the day is reported and not judged. */
  | "SHIFT_DIFFERENTIAL"
  /** No daily or seventh-day rule recorded, and no weekly rule either. */
  | "NO_RULE";

export interface DayReview {
  date: string;
  /** 1-based position in the current unbroken run of worked days. */
  consecutiveDay: number;
  totalHours: number;
  entered: HoursByPayType;
  /** Null when the day was not judged — see `skipped`. */
  expected: HoursByPayType | null;
  skipped: SkipReason | null;
  differs: boolean;
}

export interface WeekReview {
  ruleSetName: string | null;
  jurisdiction: string | null;
  /** False when there is nothing to check against. `reason` says which. */
  checked: boolean;
  reason: string | null;
  days: DayReview[];
  disagreements: DayReview[];
  totalHours: number;
  /** True when the weekly threshold actually moved hours, so the UI can
   * explain a day whose own daily rule was satisfied. */
  weeklyThresholdApplied: boolean;
}

function splitDay(
  hours: number,
  overtimeAfter: number | null,
  doubleTimeAfter: number | null,
): HoursByPayType {
  const split = zeroHours();

  // A null threshold is not zero and not infinity-by-accident: it means
  // that premium has no recorded trigger, so nothing crosses into it.
  const otThreshold = overtimeAfter ?? doubleTimeAfter ?? Number.POSITIVE_INFINITY;
  // Double time cannot begin before overtime does; a rule set recorded the
  // other way round is a data-entry error, and clamping keeps the split
  // arithmetically sound rather than producing negative overtime.
  const dtThreshold = Math.max(doubleTimeAfter ?? Number.POSITIVE_INFINITY, otThreshold);

  split.STRAIGHT = Math.min(hours, otThreshold);
  split.OVERTIME = Math.max(0, Math.min(hours, dtThreshold) - otThreshold);
  split.DOUBLE_TIME = Math.max(0, hours - dtThreshold);
  return split;
}

/** Rounded to hundredths before comparing. Hours are Decimal(5,2) in the
 * database, and a float subtraction producing 7.999999999 must not read as
 * a disagreement with 8. */
function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function sameSplit(a: HoursByPayType, b: HoursByPayType) {
  return (["STRAIGHT", "OVERTIME", "DOUBLE_TIME"] as PayType[]).every(
    (type) => round2(a[type]) === round2(b[type]),
  );
}

function addDays(iso: string, days: number) {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Reviews a run of days against a rule set.
 *
 * The order of operations is deliberate and is where a reviewer should
 * look first if a number surprises them:
 *
 *  1. Each day is split by the DAILY rule (or the seventh-day rule, when
 *     it is the seventh consecutive worked day and one is recorded).
 *  2. Then the WEEKLY threshold converts any straight hours beyond it into
 *     overtime, taking them from the LATEST days first — you cross forty
 *     at the end of a week, not at the start, and converting the earliest
 *     hours would report Monday as overtime because of Friday.
 *
 * `consecutiveDay` counts within the supplied range only. A run that began
 * before the first date passed in is not visible here, so a seventh
 * consecutive day spanning two weeks is not detected — stated plainly
 * rather than half-implemented, since the fix is to pass a wider range.
 */
export function reviewDays(
  entries: DayEntryInput[],
  ruleSet: PrevailingWageRuleSetInput | null,
): WeekReview {
  const byDate = new Map<string, HoursByPayType>();
  for (const entry of entries) {
    const day = byDate.get(entry.date) ?? zeroHours();
    day[entry.payType] += entry.hours;
    byDate.set(entry.date, day);
  }

  const dates = [...byDate.keys()].sort();
  const totalHours = round2(
    [...byDate.values()].reduce((sum, day) => sum + PAY_TYPES.reduce((s, t) => s + day[t], 0), 0),
  );

  const base = {
    ruleSetName: ruleSet?.name ?? null,
    jurisdiction: ruleSet?.jurisdiction ?? null,
    totalHours,
    weeklyThresholdApplied: false,
  };

  if (!ruleSet) {
    return {
      ...base,
      checked: false,
      reason: "No prevailing wage rule set is linked to this job's determination.",
      days: dates.map((date, index) => ({
        date,
        consecutiveDay: index + 1,
        totalHours: round2(PAY_TYPES.reduce((s, t) => s + (byDate.get(date) as HoursByPayType)[t], 0)),
        entered: byDate.get(date) as HoursByPayType,
        expected: null,
        skipped: "NO_RULE" as const,
        differs: false,
      })),
      disagreements: [],
    };
  }

  if (!hasOvertimeRules(ruleSet)) {
    return {
      ...base,
      checked: false,
      reason: `"${ruleSet.name}" records no overtime thresholds, so there is nothing to check these hours against.`,
      days: dates.map((date, index) => ({
        date,
        consecutiveDay: index + 1,
        totalHours: round2(PAY_TYPES.reduce((s, t) => s + (byDate.get(date) as HoursByPayType)[t], 0)),
        entered: byDate.get(date) as HoursByPayType,
        expected: null,
        skipped: "NO_RULE" as const,
        differs: false,
      })),
      disagreements: [],
    };
  }

  const days: DayReview[] = [];
  let consecutive = 0;
  let previous: string | null = null;

  for (const date of dates) {
    consecutive = previous !== null && addDays(previous, 1) === date ? consecutive + 1 : 1;
    previous = date;

    const entered = byDate.get(date) as HoursByPayType;
    const dayTotal = round2(PAY_TYPES.reduce((sum, type) => sum + entered[type], 0));

    if (entered.SHIFT_DIFFERENTIAL > 0) {
      days.push({
        date,
        consecutiveDay: consecutive,
        totalHours: dayTotal,
        entered,
        expected: null,
        skipped: "SHIFT_DIFFERENTIAL",
        differs: false,
      });
      continue;
    }

    const isSeventh =
      consecutive === 7 &&
      (ruleSet.seventhDayOvertimeAfterHours !== null ||
        ruleSet.seventhDayDoubleTimeAfterHours !== null);

    const expected = splitDay(
      dayTotal,
      isSeventh ? ruleSet.seventhDayOvertimeAfterHours : ruleSet.dailyOvertimeAfterHours,
      isSeventh ? ruleSet.seventhDayDoubleTimeAfterHours : ruleSet.dailyDoubleTimeAfterHours,
    );

    days.push({
      date,
      consecutiveDay: consecutive,
      totalHours: dayTotal,
      entered,
      expected,
      skipped: null,
      differs: false,
    });
  }

  // The weekly pass. Latest days first — see the note above.
  let weeklyThresholdApplied = false;
  const weekly = ruleSet.weeklyOvertimeAfterHours;
  if (weekly !== null) {
    const straightTotal = days.reduce((sum, day) => sum + (day.expected?.STRAIGHT ?? 0), 0);
    let excess = round2(straightTotal - weekly);
    for (let i = days.length - 1; i >= 0 && excess > 0; i -= 1) {
      const expected = days[i].expected;
      if (!expected) continue;
      const move = Math.min(expected.STRAIGHT, excess);
      if (move <= 0) continue;
      expected.STRAIGHT = round2(expected.STRAIGHT - move);
      expected.OVERTIME = round2(expected.OVERTIME + move);
      excess = round2(excess - move);
      weeklyThresholdApplied = true;
    }
  }

  for (const day of days) {
    day.differs = day.expected !== null && !sameSplit(day.entered, day.expected);
  }

  return {
    ...base,
    weeklyThresholdApplied,
    checked: true,
    reason: null,
    days,
    disagreements: days.filter((day) => day.differs),
  };
}
