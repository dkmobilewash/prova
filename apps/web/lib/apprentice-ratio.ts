// The apprentice-to-journeyman ratio, checked per job per day.
//
// Pure arithmetic over rows handed in — no database, no LLM call, same
// family as lib/labor-cost.ts and lib/prevailing-wage.ts.
//
// ARCHITECTURE.md and ApprenticeRatioRule's own schema comment both said
// for weeks that this check could not be built: "ratios are enforced
// daily, not on a monthly rollup, which needs a labor/time-entry data
// model that doesn't exist anywhere in this schema yet." TimeEntry landed
// and closed half that gap; CraftClassification.tier closes the other
// half. Both comments are corrected rather than left standing.
//
// DAILY, not weekly or monthly, because that is how the rule is written
// and enforced. A crew that runs two apprentices to one journeyman on
// Monday and none the rest of the week is out of ratio on Monday, and a
// weekly average would hide exactly the day an inspector asks about.
//
// Measured in HOURS rather than headcount. Both conventions exist and
// which one applies is per program standard; hours is what TimeEntry
// actually holds, and a headcount derived from it would count a two-hour
// visit the same as a full shift. `programStandardReference` on the rule
// is where the company records which convention its standard states.

export type CraftTier = "JOURNEYMAN" | "APPRENTICE" | "FOREMAN";

export interface RatioRuleInput {
  /** e.g. 1 apprentice per 3 journeymen → apprenticeCount 1, journeymenCount 3. */
  apprenticeCount: number;
  journeymenCount: number;
  programStandardReference: string | null;
}

export interface RatioEntryInput {
  date: string;
  hours: number;
  /** Null when the classification has no tier recorded, or the entry has
   * no craft tag at all. Never treated as journeyman. */
  tier: CraftTier | null;
  employeeName: string;
}

export type DayRatioStatus =
  /** Within the ratio. */
  | "WITHIN"
  /** More apprentice hours than the ratio allows against the journeyman
   * hours actually worked. */
  | "OVER"
  /** Apprentice hours worked with no journeyman hours at all — the ratio
   * permits none, so any apprentice hour is over it. Called out
   * separately because the fix is different: you need a journeyman on
   * site, not fewer apprentices. */
  | "NO_JOURNEYMAN"
  /** Some hours could not be classified, so no honest verdict exists. */
  | "INCOMPLETE"
  /** No apprentice hours were worked, so the ratio has nothing to bind. */
  | "NOT_APPLICABLE";

export interface DayRatio {
  date: string;
  journeymanHours: number;
  apprenticeHours: number;
  /** Hours on a craft with no tier recorded, or no craft at all. */
  unclassifiedHours: number;
  /** The most apprentice hours the rule allows against the journeyman
   * hours actually worked. Null when there is no rule to apply. */
  allowedApprenticeHours: number | null;
  /** How far past the allowance, rounded to hundredths. Zero when within. */
  excessApprenticeHours: number;
  status: DayRatioStatus;
  /** Named so the report can say who was on site, which is the first
   * question anyone asks about a flagged day. */
  unclassifiedNames: string[];
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * One job's ratio, day by day.
 *
 * A day with unclassified hours is INCOMPLETE and never WITHIN. Counting
 * unknown hours as journeyman hours would make a job look compliant
 * because nobody had finished tagging its crafts, which is the most
 * dangerous failure available here — it turns a setup gap into a false
 * clean bill of health on the exact record an inspector asks for.
 */
export function reviewRatioByDay(
  entries: RatioEntryInput[],
  rule: RatioRuleInput | null,
): DayRatio[] {
  const byDate = new Map<
    string,
    { journeyman: number; apprentice: number; unclassified: number; names: Set<string> }
  >();

  for (const entry of entries) {
    const day = byDate.get(entry.date) ?? {
      journeyman: 0,
      apprentice: 0,
      unclassified: 0,
      names: new Set<string>(),
    };
    if (entry.tier === "APPRENTICE") {
      day.apprentice += entry.hours;
    } else if (entry.tier === "JOURNEYMAN" || entry.tier === "FOREMAN") {
      // A foreman is a journeyman-level worker; see CraftTier.
      day.journeyman += entry.hours;
    } else {
      day.unclassified += entry.hours;
      day.names.add(entry.employeeName);
    }
    byDate.set(entry.date, day);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, day]) => {
      const journeymanHours = round2(day.journeyman);
      const apprenticeHours = round2(day.apprentice);
      const unclassifiedHours = round2(day.unclassified);

      const allowedApprenticeHours =
        rule && rule.journeymenCount > 0
          ? round2((journeymanHours * rule.apprenticeCount) / rule.journeymenCount)
          : null;

      let status: DayRatioStatus;
      let excess = 0;

      if (unclassifiedHours > 0) {
        status = "INCOMPLETE";
      } else if (apprenticeHours === 0) {
        status = "NOT_APPLICABLE";
      } else if (allowedApprenticeHours === null) {
        // Apprentice hours worked, but no ratio rule recorded for this
        // local. Not a pass — there is simply nothing to measure against.
        status = "INCOMPLETE";
      } else if (journeymanHours === 0) {
        status = "NO_JOURNEYMAN";
        excess = apprenticeHours;
      } else if (apprenticeHours > allowedApprenticeHours) {
        status = "OVER";
        excess = round2(apprenticeHours - allowedApprenticeHours);
      } else {
        status = "WITHIN";
      }

      return {
        date,
        journeymanHours,
        apprenticeHours,
        unclassifiedHours,
        allowedApprenticeHours,
        excessApprenticeHours: excess,
        status,
        unclassifiedNames: [...day.names].sort(),
      };
    });
}

export interface RatioSummary {
  daysChecked: number;
  daysWithin: number;
  daysOver: number;
  daysIncomplete: number;
  /** The worst single day's excess, which is what gets asked about. */
  worstExcessHours: number;
  offendingDates: string[];
}

export function summarizeRatio(days: DayRatio[]): RatioSummary {
  const offending = days.filter((d) => d.status === "OVER" || d.status === "NO_JOURNEYMAN");
  return {
    // Only days the rule could actually bind on. A day with no apprentice
    // hours is not evidence of compliance and is not counted as such.
    daysChecked: days.filter((d) => d.status !== "NOT_APPLICABLE").length,
    daysWithin: days.filter((d) => d.status === "WITHIN").length,
    daysOver: offending.length,
    daysIncomplete: days.filter((d) => d.status === "INCOMPLETE").length,
    worstExcessHours: offending.reduce((worst, d) => Math.max(worst, d.excessApprenticeHours), 0),
    offendingDates: offending.map((d) => d.date),
  };
}

/** "1 apprentice per 3 journeymen". Kept here so the page and any alert
 * word the same rule identically. */
export function ratioLabel(rule: RatioRuleInput): string {
  const apprentices = `${rule.apprenticeCount} apprentice${rule.apprenticeCount === 1 ? "" : "s"}`;
  const journeymen = `${rule.journeymenCount} journeym${rule.journeymenCount === 1 ? "an" : "en"}`;
  return `${apprentices} per ${journeymen}`;
}
