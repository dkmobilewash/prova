import {
  ratioLabel,
  reviewRatioByDay,
  summarizeRatio,
  type DayRatioStatus,
  type RatioEntryInput,
  type RatioRuleInput,
} from "@/lib/apprentice-ratio";
import { formatHours } from "@/lib/render-hours";
import { DEMO_JOB, PanelFrame } from "./panelChrome";

/**
 * One job's apprentice ratio for a week, as the "Apprentice ratio" section of
 * `app/(app)/union-compliance/page.tsx` renders it: the job and its local,
 * the rule in `ratioLabel`'s words, then one line per day —
 *
 *   {date}  {status} · {n} jrny / {n} appr (allows {n}) · {n} hrs unclassified: {names}
 *
 * — with that page's STATUS_LABEL strings ("within ratio", "over ratio",
 * "can't be judged") and STATUS_TONE colours, and its summary sentence above
 * the list ("1 job went over the ratio. 1 job has days that can't be judged.").
 *
 * THE VERDICTS ARE COMPUTED by `reviewRatioByDay` from lib/apprentice-ratio.ts,
 * fed one row per worker per day. That function is the point of the panel:
 * it is DAILY, in HOURS (what TimeEntry holds — not headcount), a foreman
 * counts on the journeyman side, and a day with hours on a craft nobody has
 * tiered is "can't be judged" rather than quietly counted as journeyman. So
 * Tuesday below is over the ratio on Tuesday, and the week as a whole — 120
 * journeyman hours to 40 apprentice — passes a weekly average. That gap is
 * the product's promise, and the rose bar on the flagged day (the app's own
 * accent-bar convention for "the row to look at first", packages/ui Card) is
 * what makes it visible at a glance.
 *
 * The phone's time screen asks the same arithmetic for today
 * (`/api/v1/jobs/[id]/apprentice-ratio`, via `reviewDayByLocal`) and shows
 * only breaches, while the crew can still be changed. The closing line says
 * so, and no more than that.
 */

const RULE: RatioRuleInput = {
  apprenticeCount: 1,
  journeymenCount: 3,
  programStandardReference: "JATC program standards",
};

/** As `localLabel` in lib/union-compliance-query.ts prints it. The local is made up. */
const LOCAL_LABEL = "Carpenters Local 1180 — Northern Nevada";

type Crew = { name: string; tier: RatioEntryInput["tier"] };

const JOURNEYMEN: Crew[] = [
  { name: "Ramón Alvarez", tier: "JOURNEYMAN" },
  { name: "Priya Shah", tier: "JOURNEYMAN" },
  { name: "Marcus Bell", tier: "JOURNEYMAN" },
];
const FOREMAN: Crew = { name: "Luis Mendoza", tier: "FOREMAN" };
const APPRENTICE: Crew = { name: "Dana Okafor", tier: "APPRENTICE" };
/** Logged against a craft nobody has tiered yet. */
const UNTIERED: Crew = { name: "T. Nguyen", tier: null };

/** Who was on site each day, eight hours each. Tuesday one journeyman was
 * pulled to another job and the apprentice stayed — 16 journeyman hours
 * allow 5.33 apprentice hours, and 8 were worked. Over the week it is 120
 * journeyman hours to 40 apprentice, exactly the 1-in-3 allowance, so a
 * weekly or monthly figure would read clean. Thursday one set of hours went
 * on an untiered craft. */
const WEEK: { date: string; crew: Crew[] }[] = [
  { date: "2026-08-24", crew: [FOREMAN, JOURNEYMEN[0], JOURNEYMEN[1], APPRENTICE] },
  { date: "2026-08-25", crew: [FOREMAN, JOURNEYMEN[0], APPRENTICE] },
  { date: "2026-08-26", crew: [FOREMAN, ...JOURNEYMEN.slice(0, 3), APPRENTICE] },
  { date: "2026-08-27", crew: [FOREMAN, JOURNEYMEN[0], JOURNEYMEN[1], APPRENTICE, UNTIERED] },
  { date: "2026-08-28", crew: [FOREMAN, JOURNEYMEN[0], JOURNEYMEN[1], APPRENTICE] },
];

const STATUS_TONE: Record<DayRatioStatus, string> = {
  WITHIN: "text-tag-green-ink",
  OVER: "text-tag-rose-ink",
  NO_JOURNEYMAN: "text-tag-rose-ink",
  INCOMPLETE: "text-tag-amber-ink",
  NOT_APPLICABLE: "text-ink-muted",
};

const STATUS_LABEL: Record<DayRatioStatus, string> = {
  WITHIN: "within ratio",
  OVER: "over ratio",
  NO_JOURNEYMAN: "apprentice on site with no journeyman",
  INCOMPLETE: "can't be judged",
  NOT_APPLICABLE: "no apprentice hours",
};

function buildReview() {
  const entries: RatioEntryInput[] = WEEK.flatMap(({ date, crew }) =>
    crew.map((person) => ({ date, hours: 8, tier: person.tier, employeeName: person.name })),
  );
  const days = reviewRatioByDay(entries, RULE);
  return { days, summary: summarizeRatio(days) };
}

export function ApprenticeRatioPanel({ className }: { className?: string }) {
  const { days, summary } = buildReview();
  const flaggedJobs = summary.daysOver > 0 ? 1 : 0;
  const incompleteJobs = summary.daysIncomplete > 0 ? 1 : 0;

  return (
    <PanelFrame
      title="Apprentice ratio"
      meta="Union fringe & apprenticeship · August 2026"
      caption="Checked per job, per local, per day, from the hours actually logged — nothing here is stored."
      className={className}
    >
      {(flaggedJobs > 0 || incompleteJobs > 0) && (
        <p className="mb-3 text-sm text-ink-body">
          {flaggedJobs > 0 && (
            <span className="text-tag-rose-ink">
              {flaggedJobs} {flaggedJobs === 1 ? "job" : "jobs"} went over the ratio.{" "}
            </span>
          )}
          {incompleteJobs > 0 && (
            <span className="text-tag-amber-ink">
              {incompleteJobs} {incompleteJobs === 1 ? "job has" : "jobs have"} days that can&apos;t be judged.
            </span>
          )}
        </p>
      )}

      <div className="rounded-lg border border-line-card bg-canvas p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
          <p className="text-sm text-ink">{DEMO_JOB.name}</p>
          <p className="text-xs text-ink-muted">{LOCAL_LABEL}</p>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          {ratioLabel(RULE)}
          {RULE.programStandardReference && ` · ${RULE.programStandardReference}`}
        </p>

        <ul className="mt-2 flex flex-col gap-1">
          {days
            .filter((day) => day.status !== "NOT_APPLICABLE")
            .map((day) => {
              const breach = day.status === "OVER" || day.status === "NO_JOURNEYMAN";
              return (
                <li
                  key={day.date}
                  className={`-ml-3 border-l-[3px] py-0.5 pl-[9px] text-sm ${
                    breach ? "border-bar-rose" : "border-transparent"
                  }`}
                >
                  <span className="font-mono text-xs tabular-nums text-ink-muted">{day.date}</span>{" "}
                  <span className={`${STATUS_TONE[day.status]} ${breach ? "font-semibold" : ""}`}>
                    {STATUS_LABEL[day.status]}
                  </span>
                  <span className="tabular-nums text-ink-muted">
                    {" "}
                    · {formatHours(day.journeymanHours)} jrny /{" "}
                    {formatHours(day.apprenticeHours)} appr
                    {day.allowedApprenticeHours !== null &&
                      ` (allows ${formatHours(day.allowedApprenticeHours)})`}
                    {day.unclassifiedHours > 0 &&
                      ` · ${formatHours(day.unclassifiedHours)} hrs unclassified: ${day.unclassifiedNames.join(", ")}`}
                  </span>
                </li>
              );
            })}
        </ul>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-ink-body">
        Tuesday is flagged on Tuesday. Averaged over the week this crew is inside the ratio, which is how a
        violation goes unnoticed until someone else finds it. The phone&rsquo;s time screen runs the same check
        for today and warns while the crew can still change.
      </p>
    </PanelFrame>
  );
}
