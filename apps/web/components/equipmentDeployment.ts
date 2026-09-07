/** Where equipment has been, and how hard it has worked.
 *
 * Nothing here is stored. Where a lift is right now, whether two records
 * contradict each other, and how utilised a piece is are all derived from
 * the assignment history on every read.
 *
 * `Equipment.assignedJobId` held the same fact `currentAssignment` computes,
 * and a stored copy of a derived fact is exactly the thing that eventually
 * disagrees with what it was derived from. Nothing writes it any more, so
 * every reader of it is frozen at the day the writes stopped.
 *
 * THREE surfaces answer "where is the skid steer", and all three must come
 * through this module or they will diverge silently: `/equipment`,
 * `/deployment`, and Ask's `equipment_location` handler. Ask did NOT, and
 * shipped a permanently stale answer while this comment claimed the column
 * was "no longer read at all" — a claim written from one file's vantage
 * point about the whole app. If you add a fourth reader, grep
 * `assignedJobId` across `apps/` before you believe any sentence like that
 * one: the grep is the check, not the comment. */

export type AssignmentData = {
  id: string;
  equipmentId: string;
  equipmentName: string;
  jobId: string;
  jobName: string;
  /** "YYYY-MM-DD", UTC midnight, entered not stamped. */
  sentOutOn: string;
  /** Null means still out — a state, not missing data. */
  returnedOn: string | null;
  notes: string | null;
};

const DAY_MS = 86_400_000;

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round(
    (Date.parse(`${toIso}T00:00:00.000Z`) - Date.parse(`${fromIso}T00:00:00.000Z`)) / DAY_MS,
  );
}

/** Newest first, ties broken on id so the order is total and stable. */
export function newestFirst(assignments: AssignmentData[]): AssignmentData[] {
  return [...assignments].sort((a, b) => {
    if (a.sentOutOn !== b.sentOutOn) return a.sentOutOn < b.sentOutOn ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

/** Where it is now: the newest assignment nobody has closed.
 *
 * Null means it is in the yard, which is a normal answer and not missing
 * data. */
export function currentAssignment(assignments: AssignmentData[]): AssignmentData | null {
  return newestFirst(assignments).find((a) => a.returnedOn === null) ?? null;
}

/** Out, spoken for, or in the yard — as of a given day. */
export type DeploymentToday =
  | { kind: "out"; stay: AssignmentData }
  | { kind: "planned"; stay: AssignmentData }
  | { kind: "yard" };

/** Where a piece is TODAY, which is not the same question as which stay is
 * open.
 *
 * Dispatching ahead is ordinary: "the lift goes to Maple on Tuesday" is
 * written down on Friday. `currentAssignment` answers a date-free question
 * — what stay has nobody closed — so on Friday it names Tuesday's job, and
 * `/equipment` printed "On Maple St Tower" and dropped the lift out of "N
 * in the yard" for a machine still sitting in the yard. The line directly
 * beneath said "due out Tuesday", because `stayLength` already knew. One
 * card, two contradictory statements. See issue #149.
 *
 * So: a stay that has not started yet is a PLAN. The piece is in the yard
 * and counted there, and the row says what it is spoken for instead of
 * claiming it has gone. `currentAssignment` is unchanged and is still what
 * the overlap rules and Ask use, because "is a stay open" is the right
 * question for both. */
export function deploymentToday(assignments: AssignmentData[], today: string): DeploymentToday {
  const ordered = newestFirst(assignments);

  // Out means gone, so the stay has to have started. An open stay dated
  // ahead of an older open one is a contradiction `contradictions()`
  // reports; it must not hide the deployment the machine is actually on.
  const out = ordered.find((a) => a.returnedOn === null && a.sentOutOn <= today);
  if (out) return { kind: "out", stay: out };

  // Not gone. It may still be spoken for — the SOONEST stay that has not
  // started, which is the last of a newest-first list.
  const upcoming = ordered.filter((a) => a.sentOutOn > today);
  const next = upcoming.length > 0 ? upcoming[upcoming.length - 1] : null;
  return next ? { kind: "planned", stay: next } : { kind: "yard" };
}

/** Do two stays overlap?
 *
 * A null return date means "still out", which extends the range forward
 * indefinitely — so an open assignment collides with everything after it
 * starts.
 *
 * Touching at a boundary is deliberately NOT an overlap: returned on the
 * 10th and sent somewhere else on the 10th is an ordinary day's work — back
 * to the yard in the morning, out again after lunch. Treating that as a
 * contradiction would make the app argue with a dispatcher who did nothing
 * wrong, and a rule that cries wolf on the normal case is one people learn
 * to click past.
 */
export function rangesOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null,
): boolean {
  const aEnds = aEnd ?? "9999-12-31";
  const bEnds = bEnd ?? "9999-12-31";
  return aStart < bEnds && bStart < aEnds;
}

/** The existing stay this one would contradict, if any.
 *
 * Checked against every assignment for the piece, not just the open one. A
 * backdated entry collides with a CLOSED stay just as easily as with an
 * open one — "the lift went to Maple on the 3rd" is wrong in exactly the
 * same way whether or not it has since come back, and only checking for an
 * open assignment would let the record quietly hold two places at once for
 * a week in the past.
 *
 * `ignoreId` exists so editing a stay doesn't find itself.
 */
export function findOverlap(
  existing: AssignmentData[],
  candidate: { sentOutOn: string; returnedOn: string | null; ignoreId?: string },
): AssignmentData | null {
  return (
    newestFirst(existing).find(
      (a) =>
        a.id !== candidate.ignoreId &&
        rangesOverlap(a.sentOutOn, a.returnedOn, candidate.sentOutOn, candidate.returnedOn),
    ) ?? null
  );
}

function nextDay(iso: string): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** The days a stay covers inside a window, counting the day it went out and
 * not the day it came back — a lift that leaves and returns the same day
 * was out for a day's work, and a stay from the 1st to the 8th is seven
 * days, not eight. The window itself is half-open the same way: `windowEnd`
 * is the first day NOT measured.
 *
 * Returns the days rather than a count because `utilisation` has to dedupe
 * across overlapping records, and it must do that against THIS rule. There
 * used to be a second copy of the rule inlined in `utilisation`'s loop, and
 * the two disagreed about the case this docstring makes a point of: a
 * same-day stay counted as one day here and as nothing there, so a lift
 * working ten single-day jobs rendered "out 0 of the last 90 days (0%)"
 * while the test suite stayed green about the opposite. One rule now, and it
 * is this one. See issue #151. */
export function daysOutWithin(
  assignment: AssignmentData,
  windowStart: string,
  windowEnd: string,
): string[] {
  const start = assignment.sentOutOn > windowStart ? assignment.sentOutOn : windowStart;
  const rawEnd = assignment.returnedOn ?? windowEnd;
  const end = rawEnd < windowEnd ? rawEnd : windowEnd;

  const days: string[] = [];
  for (let d = start; d < end; d = nextDay(d)) days.push(d);

  // Out and back the same day is a day's work, and the half-open range above
  // is empty for it. A stay wholly outside the window is empty for a
  // different reason and stays empty.
  if (
    days.length === 0 &&
    assignment.returnedOn === assignment.sentOutOn &&
    assignment.sentOutOn >= windowStart &&
    assignment.sentOutOn < windowEnd
  ) {
    days.push(assignment.sentOutOn);
  }

  return days;
}

export type Utilisation = {
  daysOut: number;
  daysTracked: number;
  /** Whole percent, or null when there is no window to measure over. */
  percent: number | null;
};

/** How much of the window this piece spent on a job.
 *
 * The denominator is the honest part. We have no acquisition date for any
 * equipment — nothing in the schema records when a contractor bought a
 * mixer — so the window is clamped to `knownSince`, the day the record
 * itself was created. That makes the figure "since we started tracking it"
 * rather than a claim about the machine's life, and a lift added yesterday
 * reports on one day rather than looking 99% idle for a quarter it wasn't
 * ours for.
 *
 * Null rather than 0% when the window is empty, for the same reason the
 * delivery rate is null with nothing confirmed: a confident zero is a claim,
 * and there is nothing here to make a claim from.
 */
export function utilisation(
  assignments: AssignmentData[],
  windowStart: string,
  windowEnd: string,
  knownSince: string,
): Utilisation {
  const start = knownSince > windowStart ? knownSince : windowStart;
  const daysTracked = daysBetween(start, windowEnd);
  if (daysTracked <= 0) return { daysOut: 0, daysTracked: 0, percent: null };

  // Overlapping records are a contradiction the UI reports separately; they
  // must not let a piece be counted as out twice and read over 100%. Which
  // days a stay covers is `daysOutWithin`'s question, not this function's —
  // asking it twice is how the two answers came to disagree.
  const days = new Set<string>();
  for (const a of assignments) {
    for (const day of daysOutWithin(a, start, windowEnd)) days.add(day);
  }

  const daysOut = days.size;
  return { daysOut, daysTracked, percent: Math.round((daysOut / daysTracked) * 100) };
}

/** Every piece that two records claim was in two places at once.
 *
 * Surfaced rather than silently resolved: which of the two entries is wrong
 * is a question about what actually happened on a site, and the app does not
 * know. It says so and lets a person fix it. */
export function contradictions(assignments: AssignmentData[]): AssignmentData[][] {
  const byEquipment = new Map<string, AssignmentData[]>();
  for (const a of assignments) {
    const bucket = byEquipment.get(a.equipmentId);
    if (bucket) bucket.push(a);
    else byEquipment.set(a.equipmentId, [a]);
  }

  const clashes: AssignmentData[][] = [];
  for (const group of byEquipment.values()) {
    const ordered = newestFirst(group);
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        if (
          rangesOverlap(
            ordered[i].sentOutOn,
            ordered[i].returnedOn,
            ordered[j].sentOutOn,
            ordered[j].returnedOn,
          )
        ) {
          clashes.push([ordered[i], ordered[j]]);
        }
      }
    }
  }
  return clashes;
}

export function dayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** How long a stay has run, in a person's words.
 *
 * A stay dated in the FUTURE is not a stay yet — it is a plan. Dispatching
 * ahead ("the lift goes to Maple on Tuesday") is ordinary and allowed, but
 * calling it "out since today" would report a machine as deployed while it
 * is still sitting in the yard, which is the kind of thing somebody drives
 * across town to discover. Found by clicking, not by a test. */
export function stayLength(assignment: AssignmentData, today: string): string {
  if (assignment.sentOutOn > today) {
    return assignment.returnedOn === null
      ? `due out ${dayLabel(assignment.sentOutOn)}`
      : `due out ${dayLabel(assignment.sentOutOn)}, back ${dayLabel(assignment.returnedOn)}`;
  }
  const end = assignment.returnedOn ?? today;
  const days = daysBetween(assignment.sentOutOn, end);
  if (assignment.returnedOn === null) {
    return days <= 0 ? "out since today" : `out ${days} ${days === 1 ? "day" : "days"}`;
  }
  return days <= 0 ? "same day" : `${days} ${days === 1 ? "day" : "days"}`;
}
