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

import { formatHours } from "./render-hours";

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
 *
 * MORE THAN ONE ROW CAN MATCH, so this does not return the first one it
 * finds. `PrevailingWageRuleSet_no_overlapping_rules` (migration
 * 20260902021139) excludes on `tsrange(effectiveFrom, COALESCE(effectiveTo,
 * 'infinity'))`, and tsrange's default bounds are [inclusive, exclusive) —
 * so a rule set ending on 1 June and one starting on 1 June are ADJACENT
 * to Postgres, both insert cleanly, and both match 1 June under the
 * inclusive comparison above. Exactly the hole FringeRateSchedule had
 * (issue #104 finding 3), and the migration's own comment names the cost:
 * "the rules that applied that week" would otherwise depend on row order.
 *
 * The choice is therefore made here rather than left to the caller's fetch
 * order — findMany without an ORDER BY has none to offer, and a review of
 * one signed week must not classify its overtime differently on two page
 * loads. Most recently effective wins: the LATEST `effectiveFrom` among
 * those that match.
 *
 * Ties on `effectiveFrom` are real and are broken on `id`. A one-day rule
 * set (effectiveTo == effectiveFrom, which the create action accepts —
 * it rejects only an end STRICTLY BEFORE the start) has the empty tsrange
 * [x, x), and an empty range overlaps nothing, so the exclusion constraint
 * cannot refuse it alongside a rule set beginning that same day. "Latest
 * effectiveFrom" then has nothing left to compare, and a reduce with a
 * strict `>` would silently fall back to array order. `id` is the primary
 * key, so comparing it is a TOTAL order that always answers. Which id wins
 * is arbitrary as a judgment — an id cannot know which rule set a payroll
 * clerk meant — and stability is the only property claimed for it.
 */
export function findEffectiveRuleSet<
  T extends { id: string; effectiveFrom: string; effectiveTo: string | null },
>(ruleSets: T[], dateIso: string): T | null {
  const matches = ruleSets.filter(
    (rs) => rs.effectiveFrom <= dateIso && (rs.effectiveTo === null || rs.effectiveTo >= dateIso),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, candidate) => {
    if (candidate.effectiveFrom !== best.effectiveFrom) {
      return candidate.effectiveFrom > best.effectiveFrom ? candidate : best;
    }
    return candidate.id > best.id ? candidate : best;
  });
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
  /**
   * Hours that crossed the weekly overtime threshold on a day this review
   * is not allowed to judge — i.e. a day carrying shift-differential
   * hours. Empty on every week where the threshold's effect is fully
   * determined, which is almost all of them.
   *
   * THIS EXISTS BECAUSE ITS ABSENCE CERTIFIED A WEEK CLEAN THAT WAS EIGHT
   * HOURS SHORT. A shift-differential day used to contribute ZERO to the
   * weekly total — the pass summed `day.expected?.STRAIGHT ?? 0` and a
   * skipped day's `expected` is null — so Monday to Friday's eight-hour
   * days never reached forty, the threshold never tripped, and the page
   * printed "Every day matches what the rules imply." over a week owing
   * overtime premium. The footnote about the Saturday was there the whole
   * time and said nothing about the other five days, which is what made
   * it silent rather than merely incomplete.
   *
   * WHY IT IS REPORTED RATHER THAN RESOLVED. The hours that cross forty
   * are the LATEST ones, and when those are the shift-differential hours
   * the honest expectation is "that premium AND overtime" — a combination
   * `HoursByPayType` cannot express, since its buckets are exclusive.
   * Pushing the excess back onto the last judgeable day instead would
   * report Friday as overtime for hours worked inside the first forty of
   * the week: a different wrong answer, not a fix. So the week is counted
   * correctly, the judgeable days keep their correct verdicts, and the
   * part no rule in this app can settle is named and handed to a person.
   */
  weeklyUnresolved: { date: string; hours: number }[];
}

/**
 * Whether this review has nothing at all to raise.
 *
 * A FUNCTION rather than a condition written inline on the page, because
 * the condition written inline on the page was `disagreements.length === 0`
 * and that is how a week eight hours short of its overtime got the green
 * sentence "Every day matches what the rules imply." A verdict that a
 * payroll clerk signs under penalty of perjury should not be a `?:` nobody
 * can execute in a test.
 */
export function reviewIsClean(review: WeekReview): boolean {
  return (
    review.checked && review.disagreements.length === 0 && review.weeklyUnresolved.length === 0
  );
}

/** The sentence for `weeklyUnresolved`, or null when there is nothing to
 * say. Named hours and named dates — a warning a reader cannot act on is
 * barely better than the silence it replaced.
 *
 * The hours go through `formatHours` (#408) rather than being interpolated
 * raw. They are a floating-point SUM of `Decimal(5,2)` values on a payroll
 * screen, which is the exact shape that printed "35.300000000000004" on
 * the certified-payroll page — and `hoursRenderCensus.test.ts` exists so a
 * second implementation cannot appear next to that one. A warning about a
 * DOL finding is the last place to print a number nobody believes. */
export function weeklyUnresolvedSentence(review: WeekReview): string | null {
  if (review.weeklyUnresolved.length === 0) return null;
  // ONE rounding, and it is the renderer's. Two shift-differential days of
  // 4.1 and 4.2 hours sum to 8.299999999999999 in JavaScript — reachable
  // here, and pinned in the test — so this deliberately does NOT round2
  // first and then format: that would be the second hours implementation
  // `hoursRenderCensus.test.ts` exists to prevent, doing the same job
  // twice and hiding whether either one works.
  const total = review.weeklyUnresolved.reduce((sum, row) => sum + row.hours, 0);
  const dates = review.weeklyUnresolved.map((row) => row.date);
  const dateList =
    dates.length === 1
      ? dates[0]
      : `${dates.slice(0, -1).join(", ")} and ${dates[dates.length - 1]}`;
  return (
    // `formatHours` is called AT the interpolation rather than assigned to
    // a variable first, so `hoursRenderCensus.test.ts` can see it: that
    // census reads the text of each interpolation, and a formatted value
    // behind a plain identifier is indistinguishable to it from a bare
    // float. Writing it where the census can read it is cheaper than an
    // exemption, and an exemption for a number that really IS hours is
    // exactly how that guard would stop guarding.
    //
    // Pluralised off the FORMATTED string: "1" is exactly one hour, and a
    // raw float === 1 is not a question worth asking of a sum.
    `${formatHours(total)} ${formatHours(total) === "1" ? "hour" : "hours"} past the weekly ` +
    `overtime threshold fall on ` +
    `${dateList}, which carries shift-differential hours. This review cannot say what pay type ` +
    `those hours should carry — check them by hand. The other days are judged on the hours ` +
    `inside the threshold and are unaffected.`
  );
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
 * A shift-differential day takes part in step 1's arithmetic even though
 * it is not judged by it. Its hours are hours worked, so they count toward
 * the forty; what this review cannot say is which pay type those hours
 * should carry, and that is a statement about the day, not about the week.
 * The two used to be collapsed, and the cost of collapsing them is written
 * up on `WeekReview.weeklyUnresolved`.
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
    weeklyUnresolved: [] as { date: string; hours: number }[],
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
  /** The hours-band split of every day, INCLUDING the ones not judged.
   *
   * Parallel to `days` by index and deliberately not on `DayReview`: for a
   * judged day it is the same object as `expected`, and for a skipped day
   * it is an expectation this review is not making. It exists so the
   * weekly threshold can count a shift-differential day's hours without
   * anything on screen claiming to know what pay type they should carry.
   *
   * Computing it for a skipped day is sound: the daily rule splits a
   * day's TOTAL HOURS and does not care what pay type was entered. Shift
   * differential is orthogonal to the hours bands — that is exactly why
   * the day cannot be judged — so the bands themselves are still knowable.
   */
  const bands: HoursByPayType[] = [];
  let consecutive = 0;
  let previous: string | null = null;

  for (const date of dates) {
    consecutive = previous !== null && addDays(previous, 1) === date ? consecutive + 1 : 1;
    previous = date;

    const entered = byDate.get(date) as HoursByPayType;
    const dayTotal = round2(PAY_TYPES.reduce((sum, type) => sum + entered[type], 0));

    const isSeventh =
      consecutive === 7 &&
      (ruleSet.seventhDayOvertimeAfterHours !== null ||
        ruleSet.seventhDayDoubleTimeAfterHours !== null);

    const band = splitDay(
      dayTotal,
      isSeventh ? ruleSet.seventhDayOvertimeAfterHours : ruleSet.dailyOvertimeAfterHours,
      isSeventh ? ruleSet.seventhDayDoubleTimeAfterHours : ruleSet.dailyDoubleTimeAfterHours,
    );
    bands.push(band);

    const skipped = entered.SHIFT_DIFFERENTIAL > 0;
    days.push({
      date,
      consecutiveDay: consecutive,
      totalHours: dayTotal,
      entered,
      expected: skipped ? null : band,
      skipped: skipped ? "SHIFT_DIFFERENTIAL" : null,
      differs: false,
    });
  }

  // The weekly pass. Latest days first — see the note above.
  let weeklyThresholdApplied = false;
  const weeklyUnresolved: { date: string; hours: number }[] = [];
  const weekly = ruleSet.weeklyOvertimeAfterHours;
  if (weekly !== null) {
    // Every day's straight band, judged or not. A shift-differential day
    // contributing zero here is the whole of the bug this replaced.
    const straightTotal = days.reduce((sum, _day, index) => sum + bands[index].STRAIGHT, 0);
    let excess = round2(straightTotal - weekly);
    for (let i = days.length - 1; i >= 0 && excess > 0; i -= 1) {
      const expected = days[i].expected;
      if (!expected) {
        // An unjudged day the excess has reached. Its hours ARE the ones
        // that crossed forty, so they are consumed rather than passed back
        // to an earlier day that worked inside the first forty — and named,
        // because no expectation this type can express is the right one.
        const reached = Math.min(bands[i].STRAIGHT, excess);
        if (reached <= 0) continue;
        weeklyUnresolved.unshift({ date: days[i].date, hours: round2(reached) });
        excess = round2(excess - reached);
        continue;
      }
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
    weeklyUnresolved,
    checked: true,
    reason: null,
    days,
    disagreements: days.filter((day) => day.differs),
  };
}
