/** Daily field reports, grouped into the week a schedule dispute is argued
 * over.
 *
 * Nothing here is stored. Which week a report belongs to, whether a day is
 * missing, and how complete a week is are all derived on every read — same
 * rule as every other computed state in this app.
 *
 * The thing this exists to surface is the GAP. A field report only has
 * value as evidence, and evidence with an unexplained hole in it is worth
 * less than evidence that names its own hole. So a week that is missing
 * Tuesday says so, out loud, rather than quietly listing four days and
 * looking complete.
 */

export type ReportData = {
  id: string;
  jobId: string;
  jobName: string;
  /** "YYYY-MM-DD", UTC midnight, entered not stamped. */
  reportDate: string;
  crewPresent: string | null;
  workPerformed: string;
  weather: string | null;
  delays: string | null;
  filedByName: string | null;
};

const DAY_MS = 86_400_000;

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`)) / DAY_MS,
  );
}

/** 0 = Monday … 6 = Sunday.
 *
 * NOT `getUTCDay()`, which calls Sunday 0 and would put Sunday at the START
 * of a new week. On a Monday-to-Sunday construction week that is an
 * off-by-one with teeth: Sunday's report would land in the week that hadn't
 * begun yet, and the week just worked would look like it was missing its
 * last day. */
export function weekdayIndex(iso: string): number {
  return (new Date(`${iso}T00:00:00.000Z`).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing this date. */
export function weekStart(iso: string): string {
  return addDays(iso, -weekdayIndex(iso));
}

/** Saturday and Sunday.
 *
 * Weekend work happens in this trade and is NOT treated as unexpected — a
 * weekend report counts as a day worked like any other. What the weekend
 * changes is only whether SILENCE is suspicious: nobody owes a report for a
 * Saturday they didn't work. */
export function isWeekend(iso: string): boolean {
  return weekdayIndex(iso) >= 5;
}

export function weekDates(startIso: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(startIso, i));
}

/** Weekdays in this week with no report, that are already over.
 *
 * Two exclusions, and both matter more than they look:
 *
 * - **Future days are never missing.** On Wednesday, Friday is not a hole
 *   in the record, it is a day that hasn't happened. Flagging it would
 *   make every week in progress look negligent.
 * - **Today is never missing either.** The day is not over. A foreman
 *   opening this at 9am has not failed to file anything yet, and telling
 *   him he has is how a tool teaches people to ignore it.
 *
 * So this only ever reports on days that are finished and unrecorded — the
 * only kind of gap anybody can actually do something about. */
export function missingWorkdays(
  reportDates: string[],
  weekStartIso: string,
  today: string,
  /**
   * The earliest date the caller's set of reports is COMPLETE from.
   *
   * A third exclusion, and the one that was missing. /field-reports loads
   * the newest N reports and groups what came back, so the cut lands in
   * the middle of a week — and every filed report older than the cut was
   * named as a day nobody filed. Days we did not load are UNKNOWN, not
   * absent, and this page exists to argue schedule disputes: a fabricated
   * hole in your own record is worse than a shorter record.
   *
   * Undefined means the caller loaded everything, which is the only
   * condition under which silence is evidence.
   */
  knownFrom?: string,
): string[] {
  const filed = new Set(reportDates);
  return weekDates(weekStartIso).filter(
    (date) =>
      !isWeekend(date) &&
      date < today &&
      !filed.has(date) &&
      (knownFrom === undefined || date >= knownFrom),
  );
}

export type WeekGroup = {
  /** Monday of the week. */
  start: string;
  end: string;
  reports: ReportData[];
  /** Finished weekdays with nothing filed. */
  missing: string[];
  /** Reports that recorded something that cost time. */
  delayDays: ReportData[];
  /** Share of finished weekdays that have a report, as a whole percent.
   * Null before any weekday of the week is over — a week that starts
   * tomorrow is not 0% covered, it is not yet measurable, and rendering a
   * confident 0% on Monday morning would be a lie about a week nobody has
   * worked yet. Also null for a `partial` week, for the same reason: the
   * denominator is knowable and the numerator is not. */
  coveragePercent: number | null;
  /** This week starts before the caller's records are complete from, so
   * some of it was never loaded. Everything reported about it is about
   * the part that was. */
  partial: boolean;
};

/** Reports grouped into Monday-start weeks, newest week first, newest day
 * first inside each week.
 *
 * `knownFrom` is the earliest date `reports` is COMPLETE from — see
 * `missingWorkdays`. Pass it whenever the reports came out of a truncated
 * query; leave it undefined only when every report was loaded. */
export function groupIntoWeeks(
  reports: ReportData[],
  today: string,
  knownFrom?: string,
): WeekGroup[] {
  const byWeek = new Map<string, ReportData[]>();
  for (const report of reports) {
    const start = weekStart(report.reportDate);
    const bucket = byWeek.get(start);
    if (bucket) bucket.push(report);
    else byWeek.set(start, [report]);
  }

  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([start, weekReports]) => {
      const sorted = [...weekReports].sort((a, b) => {
        if (a.reportDate !== b.reportDate) return a.reportDate < b.reportDate ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
      const dates = sorted.map((r) => r.reportDate);
      const missing = missingWorkdays(dates, start, today, knownFrom);
      // The week straddles the point our records run out. Its days before
      // that point were never loaded, so nothing counted over the whole
      // week means anything.
      const partial = knownFrom !== undefined && start < knownFrom;

      const elapsedWeekdays = weekDates(start).filter((d) => !isWeekend(d) && d < today).length;
      const filedWeekdays = new Set(dates.filter((d) => !isWeekend(d) && d < today)).size;

      return {
        start,
        end: addDays(start, 6),
        reports: sorted,
        missing,
        partial,
        delayDays: sorted.filter((r) => (r.delays ?? "").trim() !== ""),
        coveragePercent:
          partial || elapsedWeekdays === 0
            ? null
            : Math.round((filedWeekdays / elapsedWeekdays) * 100),
      };
    });
}

/** A date as a person on a site would say it. UTC because that is how the
 * date was stored — rendering in local time shows the previous day for
 * anyone west of UTC. */
export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function weekLabel(startIso: string): string {
  const opts = { month: "short", day: "numeric", timeZone: "UTC" } as const;
  const start = new Date(`${startIso}T00:00:00.000Z`).toLocaleDateString("en-US", opts);
  const end = new Date(`${addDays(startIso, 6)}T00:00:00.000Z`).toLocaleDateString("en-US", opts);
  return `${start} – ${end}`;
}

/** The week written out as plain text, for handing to a GC.
 *
 * Missing days are NAMED in the output rather than skipped. A summary that
 * silently lists the four days that exist reads as a complete week, and
 * sending a GC a document that overstates your own record is a worse
 * outcome than sending one with a visible hole in it. The hole is the
 * honest part. */
export function weekSummaryText(week: WeekGroup, jobName: string): string {
  const lines: string[] = [`${jobName} — field report, ${weekLabel(week.start)}`, ""];

  for (const date of weekDates(week.start)) {
    const report = week.reports.find((r) => r.reportDate === date);
    if (report) {
      lines.push(`${dayLabel(date)}`);
      if (report.crewPresent) lines.push(`  Crew: ${report.crewPresent}`);
      lines.push(`  Work: ${report.workPerformed}`);
      if (report.weather) lines.push(`  Weather: ${report.weather}`);
      if (report.delays) lines.push(`  Delays: ${report.delays}`);
      lines.push("");
    } else if (week.missing.includes(date)) {
      lines.push(`${dayLabel(date)}`);
      lines.push("  No report filed.");
      lines.push("");
    }
  }

  if (week.delayDays.length > 0) {
    lines.push(`Days with delays recorded: ${week.delayDays.length}`);
  }
  if (week.missing.length > 0) {
    // Joined with a middot, NOT a comma: every day label already contains
    // one ("Mon, Aug 24"), so a comma-joined list reads as twice as many
    // days as it names. This line goes to a GC.
    lines.push(`Days with no report: ${week.missing.map(dayLabel).join(" · ")}`);
  }
  if (week.partial) {
    // This one goes to a GC too. A summary of a week we only half loaded
    // must not read as a summary of the week.
    lines.push(
      "Part of this week is outside the records loaded here — the days above are what was.",
    );
  }

  return lines.join("\n").trimEnd();
}
