import { formatCalendarDay } from "@/lib/render-date";

/**
 * Is this prevailing-wage determination still the one in force for this
 * job? Derived on every read from ENTERED dates, stored nowhere — the same
 * rule as lib/coi-standing.ts and lib/emr.ts, and for the same reason: a
 * stored flag can disagree with the dates it was derived from.
 *
 * THE RULE, AS PUBLISHED (California, DIR general determinations):
 *
 *   1. "The date of the first advertisement for bids … determines which
 *      prevailing wage determination is used" — 8 CCR §16000, "Date of
 *      Notice or Call for Bids"; DIR's prevailing-wage FAQ gives the
 *      worked example: advertised 15 Aug 2009, bids opened 10 Sep 2009,
 *      governed by issue 2009-1 and NOT the issue published at the end of
 *      August. https://www.dir.ca.gov/oprl/FAQ_PrevailingWage.html
 *   2. General determinations are issued twice a year, 22 February and
 *      22 August, and take effect TEN DAYS later (4 March in a non-leap
 *      year; 1 September). Same FAQ.
 *   3. After the expiration date printed on the determination: a SINGLE
 *      asterisk means the determination in effect on the bid-advertisement
 *      date holds for the life of the project; a DOUBLE asterisk means a
 *      predetermined increase applies to work after that date and the rate
 *      must be updated from DIR's increase sheet. Same FAQ, and the
 *      predetermined-increase sheets themselves, e.g.
 *      https://www.dir.ca.gov/OPRL/2026-1/PWD/Increases/Northern/NC-023-31-1-Pre.pdf
 *
 * HOW THOSE CITATIONS WERE CHECKED, stated because it bounds what this
 * file may claim. Each was LOCATED AND SUMMARISED THROUGH WEB SEARCH on
 * 2026-09-22; the container the rule was written in could not fetch
 * dir.ca.gov, so none of the three pages has been read in full by the
 * person or agent who wrote this. The rule is implemented exactly as the
 * plan states it and not improved from memory. A human clicking those
 * links is still owed before this line is relied on in front of a GC.
 *
 * WHAT THIS IS AND IS NOT. It applies a published rule mechanically to two
 * entered dates and says which rule. It does not compute a legal deadline
 * (liens.prisma's rule stands), it does not know a wage rate, and it never
 * decides a job IS public works — a determination on a job nobody marked
 * public is judged exactly the same, because the document either governs
 * the advertised date or it does not. Federal (Davis-Bacon) rows are out
 * of scope: 29 CFR 1.6 locks in differently, and a federal row with dates
 * entered will be judged by the DIR calendar here, which is wrong for it.
 * Phase 5 of the plan owns that; until then the jurisdiction label is the
 * reader's cue.
 *
 * "Stale" is therefore THREE different things, and each gets its own kind
 * rather than one boolean:
 *   - wrong_issue: the row's effective window does not contain the
 *     bid-advertisement date (rule 1 + 2);
 *   - increase_due: it is the right issue, its expiration has passed, and
 *     it carries a double asterisk (rule 3);
 *   - unchecked: nothing to judge, because the ad date, the issue date or
 *     (past expiry) the marker was never entered.
 */

export type DeterminationMarker = "NONE" | "SINGLE" | "DOUBLE";

export type DeterminationFacts = {
  issuedOn: Date | null;
  expiresOn: Date | null;
  expirationMarker: DeterminationMarker | null;
};

export type JobBidFacts = {
  bidAdvertisedOn: Date | null;
};

export type DeterminationStanding =
  /** Nothing to judge. `reason` says which entered date is missing. */
  | { kind: "unchecked"; reason: string }
  /** The issue in force on the bid-advertisement date. `expiryPassedUnmarked`
   *  is the one honest gap inside "in force": the printed expiration has
   *  passed and nobody recorded which asterisk follows it. */
  | {
      kind: "in_force";
      advertisedOn: string;
      effectiveOn: string;
      expiresOn: string | null;
      marker: DeterminationMarker | null;
      expiryPassedUnmarked: boolean;
    }
  /** The row's effective window does not contain the advertisement date. */
  | { kind: "wrong_issue"; advertisedOn: string; effectiveOn: string; supersededOn: string; detail: string }
  /** Right issue, expiration passed, double asterisk: a predetermined
   *  increase is due on work after `since`. */
  | { kind: "increase_due"; advertisedOn: string; since: string }
  /** Right issue, expiration passed, single asterisk: holds for the life
   *  of the project. */
  | { kind: "life_of_project"; advertisedOn: string; since: string };

/** DIR general determinations take effect this many days after issue. */
export const DIR_EFFECTIVE_LAG_DAYS = 10;

/** The two issue dates in DIR's year, as [month, day] with month 1-based. */
export const DIR_ISSUE_DATES: readonly (readonly [number, number])[] = [
  [2, 22],
  [8, 22],
];

const DAY_MS = 86_400_000;

function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(iso: string): number {
  return Date.parse(`${iso}T00:00:00.000Z`);
}

/** `iso` plus `days` calendar days, in UTC, as YYYY-MM-DD. */
export function addDays(iso: string, days: number): string {
  return new Date(utcDate(iso) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The first scheduled DIR issue date strictly AFTER `issuedIso`. A
 * determination issued off-cycle (a special determination, or a date typed
 * a day out) is superseded by the next scheduled issue, which is the only
 * honest reading of a calendar this file does not otherwise know. */
export function nextDirIssueAfter(issuedIso: string): string {
  const year = Number(issuedIso.slice(0, 4));
  for (const y of [year, year + 1]) {
    for (const [month, day] of DIR_ISSUE_DATES) {
      const candidate = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (candidate > issuedIso) return candidate;
    }
  }
  // Unreachable: the next year's 22 February is always after any date in
  // `year`. Thrown rather than returned as something plausible.
  throw new Error(`no DIR issue date follows ${issuedIso}`);
}

/** The window in which a determination issued on `issuedIso` is the one
 * in force: from its own effective date up to (not including) the day the
 * next scheduled issue takes effect. */
export function dirIssueWindow(issuedIso: string): { effectiveOn: string; supersededOn: string } {
  return {
    effectiveOn: addDays(issuedIso, DIR_EFFECTIVE_LAG_DAYS),
    supersededOn: addDays(nextDirIssueAfter(issuedIso), DIR_EFFECTIVE_LAG_DAYS),
  };
}

export function determinationStanding(
  row: DeterminationFacts,
  job: JobBidFacts,
  todayIso: string,
): DeterminationStanding {
  if (!job.bidAdvertisedOn) {
    return {
      kind: "unchecked",
      reason: "the job's bid-advertisement date hasn't been entered, and that date is what picks the determination in force.",
    };
  }
  if (!row.issuedOn) {
    return { kind: "unchecked", reason: "this determination's issue date hasn't been entered." };
  }

  const advertisedOn = isoOf(job.bidAdvertisedOn);
  const issuedOn = isoOf(row.issuedOn);
  const { effectiveOn, supersededOn } = dirIssueWindow(issuedOn);

  if (advertisedOn < effectiveOn) {
    return {
      kind: "wrong_issue",
      advertisedOn,
      effectiveOn,
      supersededOn,
      detail: `this issue took effect ${formatCalendarDay(effectiveOn)}, after the job was advertised — the determination in force that day is the earlier issue.`,
    };
  }
  if (advertisedOn >= supersededOn) {
    return {
      kind: "wrong_issue",
      advertisedOn,
      effectiveOn,
      supersededOn,
      detail: `the next issue took effect ${formatCalendarDay(supersededOn)}, before the job was advertised — that later issue is the one in force.`,
    };
  }

  const expiresOn = row.expiresOn ? isoOf(row.expiresOn) : null;
  const expired = expiresOn !== null && todayIso > expiresOn;

  if (expired && row.expirationMarker === "DOUBLE") {
    return { kind: "increase_due", advertisedOn, since: expiresOn as string };
  }
  if (expired && row.expirationMarker === "SINGLE") {
    return { kind: "life_of_project", advertisedOn, since: expiresOn as string };
  }

  return {
    kind: "in_force",
    advertisedOn,
    effectiveOn,
    expiresOn,
    marker: row.expirationMarker,
    // NONE is a fact somebody entered ("the document carries no mark");
    // null is nobody having looked. Only the second is a gap.
    expiryPassedUnmarked: expired && row.expirationMarker === null,
  };
}

export type StandingLine = { text: string; tone: "ok" | "warn" | "bad" | "none" };

/** The one sentence the Compliance tab, /prevailing-wage and the Ask tool
 * all show. Kept here, not in a component, so it is tested once and the
 * three surfaces cannot drift from each other. */
export function determinationStandingLine(standing: DeterminationStanding): StandingLine {
  switch (standing.kind) {
    case "unchecked":
      return { text: `Unchecked — ${standing.reason}`, tone: "none" };
    case "wrong_issue":
      return {
        text: `Not the determination in force on your bid-advertisement date (${formatCalendarDay(standing.advertisedOn)}): ${standing.detail}`,
        tone: "warn",
      };
    case "increase_due":
      return {
        text: `Expiration ${formatCalendarDay(standing.since)} has passed and this determination carries a predetermined increase (**) — the rate step is on DIR's increase sheet. Open it.`,
        tone: "bad",
      };
    case "life_of_project":
      return {
        text: `In force on ${formatCalendarDay(standing.advertisedOn)}, when the job was advertised. Its expiration ${formatCalendarDay(standing.since)} has passed with a single asterisk (*), so it holds for the life of the project.`,
        tone: "ok",
      };
    case "in_force": {
      const head = `In force on ${formatCalendarDay(standing.advertisedOn)}, when the job was advertised.`;
      if (standing.expiryPassedUnmarked) {
        return {
          text: `${head} Its expiration ${formatCalendarDay(standing.expiresOn as string)} has passed and the asterisk after it wasn't recorded, so whether a predetermined increase applies isn't known — read it off the document.`,
          tone: "warn",
        };
      }
      if (standing.expiresOn === null) return { text: head, tone: "ok" };
      const expires = formatCalendarDay(standing.expiresOn);
      if (standing.marker === "DOUBLE") {
        return { text: `${head} Expires ${expires} (**) — a predetermined increase applies to work after that date.`, tone: "ok" };
      }
      if (standing.marker === "SINGLE") {
        return { text: `${head} Expires ${expires} (*) — holds for the life of the project after that.`, tone: "ok" };
      }
      return { text: `${head} Expires ${expires}.`, tone: "ok" };
    }
  }
}
