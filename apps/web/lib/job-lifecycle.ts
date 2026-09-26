/**
 * Where a job actually is, from bid to warranty — DERIVED, never stored.
 *
 * FEATURE-AUDIT asked for "bid → awarded → active → substantially complete
 * → closed/warranty" against a four-value `JobStatus`, and the obvious
 * reading is that the enum is short by two. It is not. Every stage already
 * exists; two of them are better things than enum values:
 *
 *   bid / awarded / active   `JobStatus` ESTIMATE / CONTRACTED / IN_PROGRESS
 *   substantially complete   `Job.substantialCompletionDate`, a DATE
 *   closeout / closed        `CloseoutSubmission`, with its own status chain
 *   warranty                 `WarrantyPeriod` (startsOn + months)
 *
 * `substantialCompletionDate`'s own comment in jobs.prisma says it plainly:
 * "A plain field, not a JobStatus stage." Adding `SUBSTANTIALLY_COMPLETE`
 * beside a date that can disagree with it is exactly what CLAUDE.md's
 * "derived state is never stored" forbids — you would then have two
 * answers to one question and no rule for which wins.
 *
 * THE ACTUAL GAP, and all this module fixes: nothing DERIVED the stage for
 * a reader. That date drives the retainage release forecast, the closeout
 * row and the cash-flow forecast, and nowhere does the app say "this job is
 * substantially complete". The figures knew; the person did not.
 *
 * TODAY IS A PARAMETER. Whether a warranty is running is a question about
 * the reader's calendar day, so it arrives as `todayIso` from
 * `viewerToday()` rather than being read from the clock in here. A module
 * that calls `new Date()` gives a different answer to the same job
 * depending on which server answered, which is the bug lib/viewerToday.ts
 * exists to end.
 *
 * FURTHEST STAGE WINS. The inputs overlap on purpose — a job can be
 * IN_PROGRESS, substantially complete, and punching out, all true at once.
 * Ranking them and taking the furthest is the only rule that does not
 * need a priority table nobody can remember, and it means a stage can
 * never go BACKWARDS because somebody edited a status.
 */

export type JobLifecycleStage =
  | "bidding"
  | "awarded"
  | "in_progress"
  | "substantially_complete"
  | "closeout"
  | "closed"
  | "warranty";

/** Ranked earliest to furthest. The index IS the ordering. */
const ORDER: JobLifecycleStage[] = [
  "bidding",
  "awarded",
  "in_progress",
  "substantially_complete",
  "closeout",
  "closed",
  "warranty",
];

export const STAGE_LABELS: Record<JobLifecycleStage, string> = {
  bidding: "Bidding",
  awarded: "Awarded",
  in_progress: "In progress",
  substantially_complete: "Substantially complete",
  closeout: "In closeout",
  closed: "Closed",
  warranty: "In warranty",
};

export interface JobLifecycleInput {
  status: string;
  /** UTC midnight, as everything dated in this app is stored. */
  substantialCompletionDate: Date | null;
  /** Every attempt at handing the package over — several rows per job is
   * normal (a package that comes back short goes again). */
  closeoutSubmissions: { status: string }[];
  warranty: { startsOn: Date; months: number } | null;
  /** The READER's calendar day, YYYY-MM-DD, from `viewerToday()`. */
  todayIso: string;
}

export interface JobLifecycle {
  stage: JobLifecycleStage;
  label: string;
  /**
   * WHICH INPUT won.
   *
   * The job header already shows the stored `JobStatus`, so a lifecycle
   * line that merely restates it reads "In progress — the job's status is
   * in progress" and teaches a reader to stop looking. `"status"` means
   * this module found nothing the status did not already say, and the
   * caller should stay quiet.
   */
  source: "status" | "substantial-completion" | "closeout" | "warranty" | "unknown";
  /**
   * What in the data puts it here.
   *
   * Never omitted. A stage label with no evidence behind it is the app
   * asserting something about somebody's job, and the whole reason this is
   * derived rather than stored is that the evidence is the truth and the
   * label is a reading of it.
   */
  because: string;
}

/** YYYY-MM-DD in UTC — the form every stored date and `todayIso` share, so
 * comparisons are string comparisons and no timezone gets a vote. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `startsOn` plus `months`, in UTC. Month arithmetic clamps: a warranty
 * starting 31 Jan and running one month ends 28 Feb, not 3 March. */
export function warrantyEndsOn(startsOn: Date, months: number): Date {
  const end = new Date(startsOn.getTime());
  const targetMonth = end.getUTCMonth() + months;
  const day = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(targetMonth);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0),
  ).getUTCDate();
  end.setUTCDate(Math.min(day, lastDayOfTargetMonth));
  return end;
}

const FROM_STATUS: Record<string, JobLifecycleStage> = {
  ESTIMATE: "bidding",
  CONTRACTED: "awarded",
  IN_PROGRESS: "in_progress",
  // COMPLETE is not its own reader-facing stage: "complete" and
  // "substantially complete" would sit next to each other meaning almost
  // the same thing, and the date is the one with evidence behind it.
  COMPLETE: "substantially_complete",
};

export function jobLifecycle(input: JobLifecycleInput): JobLifecycle {
  const candidates: { stage: JobLifecycleStage; because: string; source: JobLifecycle["source"] }[] = [];

  const fromStatus = FROM_STATUS[input.status];
  if (fromStatus) {
    candidates.push({
      stage: fromStatus,
      because:
        input.status === "COMPLETE"
          ? "The job is marked complete."
          : `The job's status is ${input.status.toLowerCase().replace(/_/g, " ")}.`,
      source: "status",
    });
  }

  if (input.substantialCompletionDate) {
    const on = isoDay(input.substantialCompletionDate);
    // A date in the FUTURE is a plan, not a fact. Treating it as reached
    // would tell somebody a job is substantially complete because a date
    // was pencilled in.
    if (on <= input.todayIso) {
      candidates.push({
        stage: "substantially_complete",
        because: `Substantially complete on ${on}.`,
        source: "substantial-completion",
      });
    }
  }

  const accepted = input.closeoutSubmissions.some((s) => s.status === "ACCEPTED");
  const inFlight = input.closeoutSubmissions.length > 0 && !accepted;
  if (accepted) {
    candidates.push({
      stage: "closed",
      because: "The GC accepted the closeout package.",
      source: "closeout",
    });
  } else if (inFlight) {
    const rejected = input.closeoutSubmissions.some((s) => s.status === "REJECTED");
    candidates.push({
      stage: "closeout",
      because: rejected
        ? "A closeout package came back rejected and has not been accepted since."
        : "The closeout package is with the GC.",
      source: "closeout",
    });
  }

  if (input.warranty) {
    const endsOn = isoDay(warrantyEndsOn(input.warranty.startsOn, input.warranty.months));
    const startsOn = isoDay(input.warranty.startsOn);
    if (startsOn <= input.todayIso && input.todayIso <= endsOn) {
      candidates.push({ stage: "warranty", because: `Under warranty until ${endsOn}.`, source: "warranty" });
    }
    // An EXPIRED warranty deliberately adds nothing. It is not a further
    // stage — the job is closed and the obligation is over — and inventing
    // a "warranty expired" stage would put every old job in a state that
    // reads like an event just happened.
  }

  if (candidates.length === 0) {
    // A status this module has never heard of. Says so rather than
    // guessing a stage, because a wrong stage on a job page is a confident
    // claim and "we do not know" is a true one.
    return {
      stage: "in_progress",
      label: "Status unknown",
      because: `The job's status is "${input.status}", which this app does not recognise.`,
      source: "unknown",
    };
  }

  const furthest = candidates.reduce((best, current) =>
    ORDER.indexOf(current.stage) > ORDER.indexOf(best.stage) ? current : best,
  );
  return {
    stage: furthest.stage,
    label: STAGE_LABELS[furthest.stage],
    because: furthest.because,
    source: furthest.source,
  };
}
