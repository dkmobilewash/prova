// The alert engine: one shape for every "somebody needs to know this",
// and the rule that keeps a dismissal from silencing the wrong thing.
//
// Pure derivation over inputs handed in — no database, no LLM call, same
// family as lib/compliance-expiry.ts (which this wraps rather than
// reimplements), lib/wip.ts and lib/retainage.ts.
//
// WHAT THIS IS NOT, said plainly because the audit row it closes has been
// misread once already: this is not push. Nothing here emails, texts or
// notifies anyone who is not looking at the app. What it adds over the
// dashboard tiles that came before is that an alert now has an identity,
// a severity comparable across kinds, a place of its own that is reachable
// from every page, and a record of whether a person has dealt with it.
// A delivery channel is a separate piece of work and needs an email
// sender, which does not exist on main.
//
// THE KEY RULE. An alert's key includes the FACT that would change what it
// says, not just the row it is about:
//
//     RENEWAL:license_abc:2026-11-30      not  RENEWAL:license_abc
//
// Renew that licence and the key changes, so a dismissal recorded against
// the old key stops applying and the alert returns when the new date comes
// round. Without that, "dismiss" would mean "never tell me about this
// licence again", which is how alert systems become furniture.

import {
  type Renewal,
  daysUntil as daysUntilIso,
  renewalTiming,
} from "@/lib/compliance-expiry";

import type { Capability } from "@/lib/permissions";

export type AlertKind =
  | "RENEWAL"
  | "BACKCHARGE_RESPONSE"
  | "RETAINAGE_RELEASE"
  | "CLOSEOUT_WITH_GC"
  | "CLOSEOUT_REJECTED"
  | "CERTIFIED_PAYROLL"
  | "APPRENTICE_RATIO"
  | "WIP_VARIANCE"
  | "CONTACT_FOLLOW_UP";

/** Three levels, not five. OVERDUE is "a date has passed"; DUE_SOON is "a
 * date is coming"; STANDING is a condition with no deadline attached to
 * it at all — a job forecast over contract value is true today and will
 * still be true tomorrow, and dressing that up as a deadline would make
 * the two indistinguishable in a list where the difference is the whole
 * point. */
export type AlertSeverity = "OVERDUE" | "DUE_SOON" | "STANDING";

export type Alert = {
  key: string;
  kind: AlertKind;
  severity: AlertSeverity;
  /** What it is, in the words the user would use. */
  title: string;
  /** Which one, and why it matters now. */
  detail: string;
  /** Where to go and do something about it. */
  href: string;
  /** The date this hangs on, or null for a standing condition. */
  dueOn: string | null;
  /** Negative once past. Null when there is no date. */
  daysUntil: number | null;
  /** Money riding on it, where there is a figure. Used for ordering
   * within a severity: two overdue things are not equally urgent when one
   * is holding up $42,000. */
  amount: number | null;
};

/**
 * What a person must be able to see for an alert of this kind to reach
 * them at all.
 *
 * Without this, the alert list is a hole straight through the job
 * functions: a foreman with no access to billing would still be told, by
 * name and to the dollar, that a $42,000 backcharge is unanswered. An
 * alert is a summary of the thing it points at, so it needs the same
 * permission the thing itself does.
 *
 * Applied in lib/alerts-query.ts, which is also what the bell counts —
 * so the badge and the list can never disagree about how many there are.
 */
export const ALERT_CAPABILITY: Record<AlertKind, Capability> = {
  RENEWAL: "MANAGE_COMPLIANCE",
  BACKCHARGE_RESPONSE: "MANAGE_BILLING",
  RETAINAGE_RELEASE: "MANAGE_BILLING",
  // Not billing: whether the GC has answered the closeout package is
  // operational, and the money on it is dropped separately below.
  CLOSEOUT_WITH_GC: "MANAGE_JOBS",
  // Same gate, same reason: whose move it is on the closeout package is
  // operational. The retainage it is holding up is dropped separately.
  CLOSEOUT_REJECTED: "MANAGE_JOBS",
  CERTIFIED_PAYROLL: "MANAGE_COMPLIANCE",
  APPRENTICE_RATIO: "MANAGE_COMPLIANCE",
  WIP_VARIANCE: "VIEW_JOB_COSTS",
  // Same gate as the interactions/bid-invitations section it comes from on
  // /contacts/[id] -- relationship work, not billing or compliance.
  CONTACT_FOLLOW_UP: "MANAGE_ESTIMATING",
};

/**
 * Drops alerts this person may not see, and strips the money figure from
 * the ones they may see but should not be told the value of.
 *
 * The second half matters as much as the first. A foreman can legitimately
 * be told the GC has sat on the closeout package for six weeks; being told
 * it is holding up $42,000 of retainage is the company's margin
 * conversation, not theirs.
 */
export function visibleToPrincipal(
  alerts: Alert[],
  holds: (capability: Capability) => boolean,
): Alert[] {
  return alerts
    .filter((alert) => holds(ALERT_CAPABILITY[alert.kind]))
    .map((alert) =>
      alert.amount !== null && !holds("VIEW_COMPANY_FINANCIALS") && !holds("MANAGE_BILLING")
        ? { ...alert, amount: null }
        : alert,
    );
}

/**
 * How far ahead each kind is worth warning about.
 *
 * Not one global number, for the same reason RENEWAL_HORIZON_DAYS is not:
 * the lead time you need is the lead time the thing takes. Answering a
 * backcharge is a letter and a look at the daily reports, so a week is
 * enough — but it is a CONTRACTUAL deadline, and being warned late is
 * being warned after the right to object has gone, so it gets the longest
 * runway of the three deadline kinds relative to how long the work takes.
 * Certified payroll is a report someone runs, due weekly.
 */
/**
 * CONTACT_FOLLOW_UP sits at 7, the floor for any horizon in this table and
 * not a smaller number picked for feel. notification-milestones.ts fires
 * its "week" rung at days<=7 and its "approaching" rung off severity
 * (days<=horizon) -- give a kind a horizon below 7 and "week" crosses
 * before "approaching" ever does, so the earlier warning silently never
 * sends and the tighter-sounding one arrives first. Flagged in Slack
 * before this shipped; keep at 7 or above, or raise it with whoever owns
 * notification-milestones.ts first.
 */
export const ALERT_HORIZON_DAYS: Partial<Record<AlertKind, number>> = {
  BACKCHARGE_RESPONSE: 10,
  RETAINAGE_RELEASE: 14,
  CERTIFIED_PAYROLL: 7,
  CONTACT_FOLLOW_UP: 7,
};

/**
 * How long a closeout package can sit with the GC before it is worth
 * chasing.
 *
 * 21 days rather than a contractual number, because there usually isn't
 * one — most subcontracts say when payment is due after acceptance and
 * nothing at all about how long acceptance may take. So this is a
 * chasing threshold, named as such, not a deadline being asserted.
 */
export const CLOSEOUT_CHASE_DAYS = 21;

/** The ONLY way an alert key is built. Kept in one function because the
 * `fact` segment is what makes a dismissal lapse when the situation
 * changes, and a call site that forgot it would produce a key that
 * silences a licence forever.
 *
 * Several facts are joined with `~` rather than passed as one string,
 * because `assertKeyShape` in lib/actions/alerts.ts splits on `:` and
 * requires exactly three parts. An alert whose situation is "this date AND
 * this much money" therefore keys on both, in one segment.
 *
 * NOTHING A CAPABILITY FILTER STRIPS MAY APPEAR HERE. The key is a prop of
 * the client component AlertRow, so it is in the RSC flight payload and in
 * view-source for everyone the alert reaches — including the people
 * `visibleToPrincipal` exists to keep a dollar figure away from. Money goes
 * in through `moneyFact` below, never as itself. Issue #109.
 */
export function alertKey(kind: AlertKind, subjectId: string, ...facts: string[]): string {
  return `${kind}:${subjectId}:${facts.join("~")}`;
}

/** FNV-1a, 32 bits, hex. Written out rather than imported: this module is
 * pure and has no dependencies, and `node:crypto` would make it
 * unimportable from anywhere that is not Node. */
function fnv1a(values: string[]): string {
  let hash = 0x811c9dc5;
  for (const value of values) {
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    // Separator, so ["ab","c"] and ["a","bc"] are not the same fact.
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Which doubling a figure sits in. Null for "no money on this".
 *
 * A key must lapse a dismissal when the situation MATERIALLY changes, and
 * for money that is neither "any change at all" nor "never". Cent-exact
 * was the old answer for WIP_VARIANCE and it made that alert undismissable
 * on any job with daily cost entries: one $12.40 delivery ticket minted a
 * new key and the alert came straight back. Ignoring the amount entirely
 * was the answer everywhere else, and it meant a retainage alert dismissed
 * at $500 stayed dismissed at $42,000 — the same sentence about a
 * completely different problem.
 *
 * A doubling is the line between those. $47,231.88 and $47,244.28 are the
 * same band; $500 and $42,000 are six bands apart. Near a boundary a small
 * change does flip the band and the alert returns once — being shown
 * something an extra time is the safe direction of that error.
 */
export function amountBand(amount: number | null): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.floor(Math.log2(amount));
}

/**
 * The money part of a key: which band, hashed, never the figure.
 *
 * Hashed because of where a key ends up. `visibleToPrincipal` nulls
 * `amount` for anyone without a money capability, and the key travels to
 * that same person's browser — so a readable band would hand a foreman
 * "somewhere between $32,768 and $65,536", which is the margin
 * conversation the filter exists to withhold, only vaguer.
 *
 * Said honestly, because a security claim that oversells is worse than
 * none: this is obfuscation, not encryption. Someone holding this source
 * could enumerate the few dozen possible bands and invert one. What it
 * removes is the exact figure sitting in plain text in view-source for
 * anyone who opens it, which is what issue #109 found.
 */
export function moneyFact(amount: number | null): string {
  const band = amountBand(amount);
  return band === null ? "m-none" : `m-${fnv1a([`band${band}`])}`;
}

/**
 * A fixed-width stand-in for a fact that is a SET rather than a value.
 *
 * Most facts are one date and go in the key as themselves, which is worth
 * keeping: a key you can read tells you why a dismissal lapsed. A set of
 * dates cannot, because it has no bound. `assertKeyShape` caps a key at
 * 200 characters, and an apprentice-ratio alert listing its offending days
 * crossed that at fifteen of them — so "Seen it" answered "That alert
 * reference is not one of ours" exactly on the jobs that were persistently
 * over ratio, and only on those. Issue #111.
 *
 * What this must preserve is the property the fact was there for: add or
 * remove a day and the digest changes, so an old dismissal lapses. So it
 * is order-independent — the caller's ordering is not part of the fact —
 * and it carries the count in the clear, because a digest that reads
 * `17d-a3f19c2b` still says something to a person reading the table.
 *
 * FNV-1a, through the shared `fnv1a` above. Collisions are not a security
 * question here — the worst a collision does is let one dismissal cover a
 * different set of days on the same job.
 */
export function factDigest(values: string[]): string {
  return `${values.length}d-${fnv1a([...values].sort())}`;
}

function severityForDate(dateIso: string | null, todayIso: string, horizon: number): AlertSeverity | null {
  if (!dateIso) return null;
  const days = daysUntilIso(dateIso, todayIso);
  if (days < 0) return "OVERDUE";
  if (days <= horizon) return "DUE_SOON";
  return null;
}

/* ------------------------------------------------------------- renewals */

/** Wraps what lib/compliance-expiry.ts already ranks, rather than deciding
 * expiry a second time. A COI's urgency is that module's answer; this only
 * gives it an identity and a place in one list with everything else. */
export function renewalAlert(renewal: Renewal): Alert {
  const severity: AlertSeverity =
    renewal.urgency === "EXPIRED" ? "OVERDUE" : renewal.urgency === "DUE_SOON" ? "DUE_SOON" : "STANDING";

  return {
    // An undated record and a disagreeing one both key off the date they
    // have (or its absence), so fixing either one clears the dismissal.
    key: alertKey("RENEWAL", renewal.id, renewal.date ?? "undated"),
    kind: "RENEWAL",
    severity,
    title: renewal.title,
    detail: [renewal.detail, renewal.disagreement ?? renewalTiming(renewal)]
      .filter(Boolean)
      .join(" — "),
    href: renewal.href,
    dueOn: renewal.date,
    daysUntil: renewal.daysUntil,
    amount: null,
  };
}

/* ---------------------------------------------------------- backcharges */

export type BackchargeAlertSource = {
  id: string;
  number: number;
  jobName: string;
  status: string;
  claimedAmount: number;
  respondByDate: string | null;
};

/**
 * A backcharge we have not answered, with the deadline to object in sight
 * or gone.
 *
 * Only RECEIVED ones. Disputing, accepting or settling are all responses,
 * and a response after the deadline is still a response that happened —
 * continuing to shout about it would bury the ones nobody has touched.
 * A backcharge with no deadline recorded raises nothing: we do not know of
 * one, which is not the same as there being none, and inventing a
 * contractual date is the one thing this app must never do.
 */
export function backchargeAlerts(
  sources: BackchargeAlertSource[],
  todayIso: string,
): Alert[] {
  const horizon = ALERT_HORIZON_DAYS.BACKCHARGE_RESPONSE ?? 10;
  const alerts: Alert[] = [];

  for (const bc of sources) {
    if (bc.status !== "RECEIVED") continue;
    const severity = severityForDate(bc.respondByDate, todayIso, horizon);
    if (!severity || !bc.respondByDate) continue;

    const days = daysUntilIso(bc.respondByDate, todayIso);
    alerts.push({
      // Both facts. The deadline moving is one situation changing; the
      // claimed amount moving by a doubling is another, and a backcharge
      // dismissed at $500 is not the same sentence at $42,000 — issue
      // #109. Neither the figure nor its magnitude is readable here.
      key: alertKey("BACKCHARGE_RESPONSE", bc.id, bc.respondByDate, moneyFact(bc.claimedAmount)),
      kind: "BACKCHARGE_RESPONSE",
      severity,
      title: `Backcharge ${bc.number} on ${bc.jobName} is unanswered`,
      detail:
        days < 0
          ? `The deadline to object in writing passed ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago.`
          : `Object in writing within ${days} ${days === 1 ? "day" : "days"}.`,
      href: "/backcharges",
      dueOn: bc.respondByDate,
      daysUntil: days,
      amount: bc.claimedAmount,
    });
  }

  return alerts;
}

/* ------------------------------------------------------------ retainage */

export type RetainageAlertSource = {
  jobId: string;
  jobName: string;
  balance: number;
  /** The date the GC accepted the closeout package, if they have. */
  closeoutAcceptedOn: string | null;
  /** The forecast anchor, used only when there is no accepted package. */
  substantialCompletionDate: string | null;
  /** `Job.status === "COMPLETE"`. The work is done, so held money is no
   * longer normal accrual — see the third branch below. */
  workIsFinished: boolean;
  /** Whether ANY closeout submission exists on this job, in any state. A
   * job with one is already being chased by `closeoutAlerts`; a job with
   * none is the case nothing was saying anything about at all. */
  hasCloseoutSubmission: boolean;
};

/**
 * Retainage that is now collectable, or about to be.
 *
 * Two grounds, and they are not equally good, so the wording says which
 * one it is. An ACCEPTED closeout package is an event: the GC took the
 * paperwork, and whatever the contract says the clock started. Substantial
 * completion is a FORECAST — Job.substantialCompletionDate records when a
 * job is expected to reach it, not that it did (lib/retainage.ts learned
 * that the hard way and says so). So a forecast-grounded alert is raised
 * only once the date is behind us and is worded as a prompt to check, not
 * as a claim that money is due.
 *
 * Nothing is raised on a zero balance: there is no money to release.
 *
 * THREE grounds now, not two. The third is money held on a finished job
 * that neither of the first two can see — issue #109, and the largest sum
 * this app tracks was the one thing it said nothing about.
 */
export function retainageAlerts(
  sources: RetainageAlertSource[],
  todayIso: string,
): Alert[] {
  const chase = ALERT_HORIZON_DAYS.RETAINAGE_RELEASE ?? 14;
  const alerts: Alert[] = [];

  for (const job of sources) {
    if (job.balance <= 0) continue;

    if (job.closeoutAcceptedOn) {
      const sinceAccepted = -daysUntilIso(job.closeoutAcceptedOn, todayIso);
      // NOT overdue the instant acceptance is recorded, which is what this
      // did before: it hardcoded OVERDUE, so "the GC accepted the closeout
      // package 0 days ago and this is still held" sorted above genuinely
      // blown deadlines on the strength of carrying the biggest number.
      // ALERT_HORIZON_DAYS.RETAINAGE_RELEASE existed the whole time and
      // nothing read it. Issue #109.
      //
      // What that 14 is, said plainly: OUR chasing threshold, the same
      // kind of number as CLOSEOUT_CHASE_DAYS, not a contractual one. Most
      // subcontracts say payment is due some number of days after
      // acceptance and this app does not record which; asserting a
      // deadline we were never told is the one thing it must not do.
      const chaseFrom = addDays(job.closeoutAcceptedOn, chase);
      const days = daysUntilIso(chaseFrom, todayIso);
      const elapsed = `${sinceAccepted} ${sinceAccepted === 1 ? "day" : "days"} ago`;

      alerts.push({
        key: alertKey(
          "RETAINAGE_RELEASE",
          job.jobId,
          job.closeoutAcceptedOn,
          moneyFact(job.balance),
        ),
        kind: "RETAINAGE_RELEASE",
        severity: days < 0 ? "OVERDUE" : "DUE_SOON",
        title: `Retainage on ${job.jobName} is collectable`,
        detail:
          days < 0
            ? `The GC accepted the closeout package ${elapsed} and this is still held — past the ${chase} days this app waits before chasing. What the contract allows after acceptance is not recorded here.`
            : `The GC accepted the closeout package ${elapsed} and this is still held. What the contract allows after acceptance is not recorded here.`,
        href: "/closeout",
        dueOn: chaseFrom,
        daysUntil: days,
        amount: job.balance,
      });
      continue;
    }

    if (job.substantialCompletionDate && job.substantialCompletionDate <= todayIso) {
      alerts.push({
        key: alertKey(
          "RETAINAGE_RELEASE",
          job.jobId,
          job.substantialCompletionDate,
          moneyFact(job.balance),
        ),
        kind: "RETAINAGE_RELEASE",
        severity: "STANDING",
        title: `Retainage on ${job.jobName} may be due`,
        // Deliberately hedged. This date is a forecast of substantial
        // completion, not a record that it happened, and an alert that
        // asserts money is owed on the strength of a forecast is an alert
        // that will be wrong in front of a GC.
        detail:
          "Its forecast substantial completion has passed. Worth confirming the job actually reached it — nothing here records that it did.",
        href: "/closeout",
        dueOn: job.substantialCompletionDate,
        daysUntil: daysUntilIso(job.substantialCompletionDate, todayIso),
        amount: job.balance,
      });
      continue;
    }

    // Money held on a finished job with NOTHING to date it from.
    //
    // This raised nothing at all before — on the largest sum the app
    // tracks. The two branches above both need an anchor: an accepted
    // package, or a forecast completion date that has passed. A job that
    // finished, never had a closeout package assembled, and never had a
    // substantial completion date entered has neither, so its retainage
    // was invisible to every alert here, and to closeoutAlerts as well,
    // which only ever sees jobs that DID submit something. Issue #109.
    //
    // Gated on the work being finished, and that gate is the honesty of
    // it: retainage held on a job still being built is the contract
    // working as written, and alerting on every active job would turn this
    // list into the furniture the header of this file warns about. Gated
    // on there being no submission for the same reason — a job with one is
    // already being chased by name.
    //
    // No date, so STANDING and no dueOn. The alert's whole content is that
    // the date does not exist, and inventing one to sort by would be the
    // same mistake in a new place.
    if (
      job.workIsFinished &&
      !job.hasCloseoutSubmission &&
      job.substantialCompletionDate === null
    ) {
      alerts.push({
        key: alertKey("RETAINAGE_RELEASE", job.jobId, "unanchored", moneyFact(job.balance)),
        kind: "RETAINAGE_RELEASE",
        severity: "STANDING",
        title: `Retainage on ${job.jobName} is held with nothing to date it`,
        detail:
          "The job is marked complete, no closeout package has been submitted, and no substantial completion date is recorded — so nothing here can say when this becomes collectable.",
        href: "/closeout",
        dueOn: null,
        daysUntil: null,
        amount: job.balance,
      });
    }
  }

  return alerts;
}

/* ------------------------------------------------------------- closeout */

export type CloseoutAlertSource = {
  jobId: string;
  jobName: string;
  submittedOn: string;
  retainageBalance: number;
  /**
   * Where the LATEST attempt stands.
   *
   * Required rather than optional, because the whole of issue #111 item 3
   * was a caller that only ever passed one of the three enum values and a
   * function that could not tell. CloseoutSubmissionStatus has three:
   * ACCEPTED is not a chase and the caller drops it (retainageAlerts picks
   * that case up instead); the other two both are, and they are chases of
   * completely different things.
   */
  status: "SUBMITTED" | "REJECTED";
  /** The day the GC answered, on a REJECTED attempt. Null while it is
   * still with them — and, on bad data, on a rejection nobody dated. */
  respondedOn: string | null;
};

/**
 * A closeout package that somebody has to do something about.
 *
 * TWO ALERTS, NOT ONE, and the difference is whose move it is.
 *
 * SUBMITTED is the GC sitting on it. Nothing is wrong yet, so it waits out
 * CLOSEOUT_CHASE_DAYS before it says anything — chasing a GC on day three
 * is how a list stops being read.
 *
 * REJECTED is the ball back in our court, and it raised NOTHING at all
 * until issue #111: alerts-query fed through `status === "SUBMITTED"`
 * only, so the moment the GC bounced the package the chase vanished — at
 * exactly the point the retainage stopped moving and somebody had to
 * assemble a second attempt. It gets no threshold, because there is
 * nothing to wait for: /closeout's own needsAttention already lists a
 * REJECTED job the same day, and the two screens disagreeing about that
 * is the bug in miniature.
 *
 * The wording is separate for the same reason. "Sent 31 days ago and
 * nothing recorded back" is false about a package they answered, and an
 * alert that misdescribes the record it is derived from is worse than no
 * alert — it is the thing this file's header calls furniture.
 *
 * Callers pass ACCEPTED submissions nowhere near this function.
 */
export function closeoutAlerts(sources: CloseoutAlertSource[], todayIso: string): Alert[] {
  const alerts: Alert[] = [];

  for (const job of sources) {
    const amount = job.retainageBalance > 0 ? job.retainageBalance : null;

    if (job.status === "REJECTED") {
      // Dated from the response, so a package bounced today reads as
      // today rather than as however long the GC took to bounce it.
      //
      // Falling back to submittedOn is for bad data, not for a state the
      // app can produce: recordCloseoutResponse requires a respondedOn.
      // Staying silent on a row missing it would hide a live rejection to
      // punish a data problem, so it is raised on the date we do have and
      // the wording stops claiming to know when.
      const since = job.respondedOn ?? job.submittedOn;
      const days = daysUntilIso(since, todayIso);
      const ago = Math.abs(days);
      const elapsed = ago === 0 ? "today" : `${ago} ${ago === 1 ? "day" : "days"} ago`;

      alerts.push({
        key: alertKey("CLOSEOUT_REJECTED", job.jobId, since, moneyFact(amount)),
        kind: "CLOSEOUT_REJECTED",
        // No deadline exists to be past: most subcontracts say nothing
        // about how fast a bounced package must go back. Same argument as
        // the SUBMITTED case, and the reason neither claims OVERDUE.
        severity: "STANDING",
        title: `Closeout package on ${job.jobName} was sent back`,
        detail: job.respondedOn
          ? `The GC returned it ${elapsed} and nothing has gone back to them since.`
          : "The GC returned it and no response date was recorded. Nothing has gone back to them since.",
        href: "/closeout",
        dueOn: since,
        daysUntil: days,
        amount,
      });
      continue;
    }

    const daysWith = -daysUntilIso(job.submittedOn, todayIso);
    if (daysWith < CLOSEOUT_CHASE_DAYS) continue;

    alerts.push({
      key: alertKey("CLOSEOUT_WITH_GC", job.jobId, job.submittedOn, moneyFact(amount)),
      kind: "CLOSEOUT_WITH_GC",
      severity: "STANDING",
      title: `Closeout package on ${job.jobName} has had no response`,
      detail: `Sent ${daysWith} days ago and nothing recorded back.`,
      href: "/closeout",
      dueOn: job.submittedOn,
      daysUntil: -daysWith,
      amount,
    });
  }

  return alerts;
}

/* ---------------------------------------------------- certified payroll */

export type CertifiedPayrollAlertSource = {
  jobId: string;
  jobName: string;
  /** The Monday of a finished week that has time entries on it. */
  weekStart: string;
  /** The Sunday. The report is due after the week closes, not during it. */
  weekEnd: string;
  /**
   * Days after the period closes that this jurisdiction actually allows,
   * from the rule set attached to the job's wage determination. Null when
   * nobody has recorded one, and the generic horizon below stands in — the
   * alert says which of the two it used, because "due in 7 days" sourced
   * from a citation and "due in 7 days" sourced from our own default are
   * not the same claim.
   */
  filingDueDays?: number | null;
};

/**
 * A prevailing-wage job with a finished week of hours and no certified
 * payroll report covering it.
 *
 * The caller is responsible for passing ONLY jobs carrying a
 * PrevailingWageDetermination. That gate is the honesty of this alert:
 * certified payroll is not required on private work, and nagging about
 * every job would train people to ignore the one that matters. A job
 * where nobody recorded the determination raises nothing — we do not know
 * it is prevailing-wage, and guessing is exactly what this codebase does
 * not do.
 *
 * The due date is the week's end plus the horizon; the convention this
 * follows is weekly filing shortly after the pay date, which is what
 * Davis-Bacon and its state equivalents require. It is a prompt, not a
 * statutory calculation: the exact deadline depends on the contract and
 * the jurisdiction, and there is no wage-determination dataset in this app
 * to read one from.
 */
export function certifiedPayrollAlerts(
  sources: CertifiedPayrollAlertSource[],
  todayIso: string,
): Alert[] {
  const horizon = ALERT_HORIZON_DAYS.CERTIFIED_PAYROLL ?? 7;
  const alerts: Alert[] = [];

  for (const week of sources) {
    // A week still running is not late. The report covers a closed week.
    if (week.weekEnd >= todayIso) continue;

    const recorded = week.filingDueDays ?? null;
    const dueOn = addDays(week.weekEnd, recorded ?? horizon);
    const days = daysUntilIso(dueOn, todayIso);
    const window = recorded === null ? "the usual filing window" : "this jurisdiction's filing window";

    alerts.push({
      key: alertKey("CERTIFIED_PAYROLL", week.jobId, week.weekStart),
      kind: "CERTIFIED_PAYROLL",
      severity: days < 0 ? "OVERDUE" : "DUE_SOON",
      title: `Certified payroll for ${week.jobName}, week of ${week.weekStart}`,
      detail:
        days < 0
          ? `Hours were logged that week and nothing covering it has been filed. ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} past ${window}.`
          : "Hours were logged that week and nothing covering it has been filed yet.",
      href: "/compliance",
      dueOn,
      daysUntil: days,
      amount: null,
    });
  }

  return alerts;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/* ---------------------------------------------------- apprentice ratio */

export type ApprenticeRatioAlertSource = {
  jobId: string;
  jobName: string;
  unionLocalLabel: string;
  /** Days in the period that broke the ratio. */
  offendingDates: string[];
  worstExcessHours: number;
};

/**
 * A job that ran over its apprentice-to-journeyman ratio.
 *
 * STANDING rather than dated, even though each breach happened on a
 * specific day: the day is in the past and cannot be fixed by acting
 * sooner, so an OVERDUE severity that grew more urgent with the calendar
 * would be inventing a deadline that does not exist. What CAN be acted on
 * is the crew composition tomorrow, and the count of days is the size of
 * the problem.
 *
 * Keyed on the offending dates, so a dismissal lapses the moment another
 * day breaches — the same mechanism every other alert here uses, applied
 * to a set rather than a single date.
 *
 * Through factDigest(), NOT by listing them. A set has no bound and the
 * joined list went past `assertKeyShape`'s 200-character cap at fifteen
 * days, which made "Seen it" fail outright on precisely the jobs worth
 * dismissing — see issue #111 and factDigest's own note.
 */
export function apprenticeRatioAlerts(sources: ApprenticeRatioAlertSource[]): Alert[] {
  const alerts: Alert[] = [];

  for (const job of sources) {
    if (job.offendingDates.length === 0) continue;
    const count = job.offendingDates.length;

    alerts.push({
      key: alertKey("APPRENTICE_RATIO", job.jobId, factDigest(job.offendingDates)),
      kind: "APPRENTICE_RATIO",
      severity: "STANDING",
      title: `${job.jobName} ran over its apprentice ratio`,
      detail: `${count} ${count === 1 ? "day" : "days"} over the ratio for ${job.unionLocalLabel}, worst by ${job.worstExcessHours} ${job.worstExcessHours === 1 ? "hour" : "hours"}. Ratios are enforced per day, so a compliant week does not undo one.`,
      href: "/union-compliance",
      dueOn: null,
      daysUntil: null,
      amount: null,
    });
  }

  return alerts;
}

/* --------------------------------------------------------- WIP variance */

export type WipAlertSource = {
  jobId: string;
  jobName: string;
  /** Forecast cost at completion minus contract value. Positive = trouble. */
  overrun: number;
};

/** A job forecast to finish over its contract value. A standing condition
 * with no date on it, which is why it never reads as OVERDUE — it is true
 * until somebody re-forecasts or raises a change order, and a severity
 * that escalates with the calendar would be inventing urgency the data
 * does not have. */
export function wipAlerts(sources: WipAlertSource[]): Alert[] {
  const alerts: Alert[] = [];

  for (const job of sources) {
    if (job.overrun <= 0) continue;
    alerts.push({
      // The overrun's BAND, hashed — not the figure, and not to the cent.
      // This key was `WIP_VARIANCE:<jobId>:47231.88`: the exact overrun,
      // in the flight payload and in view-source, on an alert whose whole
      // money filter exists to keep that number away from a foreman. And
      // because it was cent-exact, one $12.40 delivery ticket minted a new
      // key and the alert came back — on a job with daily cost entries it
      // could never be dismissed at all. Both halves of issue #109.
      key: alertKey("WIP_VARIANCE", job.jobId, moneyFact(job.overrun)),
      kind: "WIP_VARIANCE",
      severity: "STANDING",
      title: `${job.jobName} is forecast over its contract value`,
      detail: "Forecast cost at completion is above what the job is contracted to bill.",
      href: `/jobs/${job.jobId}`,
      dueOn: null,
      daysUntil: null,
      amount: job.overrun,
    });
  }

  return alerts;
}

/* ------------------------------------------------ contact follow-ups */

export type ContactFollowUpAlertSource = {
  interactionId: string;
  contactId: string;
  contactName: string;
  followUpOn: string;
  assignedToName: string | null;
};

/**
 * A follow-up promised on a logged call, email, site visit or note, and
 * not yet cleared.
 *
 * There is no separate "resolved" flag for a follow-up -- same "derive,
 * don't duplicate" rule as everything else here. Clearing followUpOn (via
 * updateContactInteraction, e.g. after actually making the call) is what
 * retires one; this function only ever sees rows where it is still set.
 *
 * Keyed on followUpOn, so rescheduling it is a new key and an old
 * dismissal lapses -- the standard mechanism, applied to a promise instead
 * of a document's expiry date.
 *
 * Visible to everyone holding CONTACT_FOLLOW_UP's capability, not scoped
 * to followUpAssignedToUserId -- no alert kind in this file is scoped to
 * one user today, and adding the first would be a real behavior fork in
 * shared code. The assignee's name is named in the detail text instead.
 */
export function contactFollowUpAlerts(
  sources: ContactFollowUpAlertSource[],
  todayIso: string,
): Alert[] {
  const horizon = ALERT_HORIZON_DAYS.CONTACT_FOLLOW_UP ?? 7;
  const alerts: Alert[] = [];

  for (const source of sources) {
    const severity = severityForDate(source.followUpOn, todayIso, horizon);
    if (!severity) continue;

    const days = daysUntilIso(source.followUpOn, todayIso);
    const timing =
      days < 0
        ? `Was due ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago.`
        : days === 0
          ? "Due today."
          : `Due in ${days} ${days === 1 ? "day" : "days"}.`;

    alerts.push({
      key: alertKey("CONTACT_FOLLOW_UP", source.interactionId, source.followUpOn),
      kind: "CONTACT_FOLLOW_UP",
      severity,
      title: `Follow up with ${source.contactName}`,
      detail: source.assignedToName ? `${timing} Assigned to ${source.assignedToName}.` : timing,
      href: `/contacts/${source.contactId}`,
      dueOn: source.followUpOn,
      daysUntil: days,
      amount: null,
    });
  }

  return alerts;
}

/* ------------------------------------------------- ordering and silence */

const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  OVERDUE: 0,
  DUE_SOON: 1,
  STANDING: 2,
};

/**
 * Worst first; within a severity, most money first; then soonest.
 *
 * Money before date within a level is deliberate. Two overdue items are
 * not equally urgent when one is holding up $42,000 and the other a
 * $400 cleanup charge, and a list ordered purely by date puts whichever
 * happened to be dated earlier on top.
 */
export function rankAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;

    const byAmount = (b.amount ?? 0) - (a.amount ?? 0);
    if (byAmount !== 0) return byAmount;

    if (a.daysUntil !== null && b.daysUntil !== null && a.daysUntil !== b.daysUntil) {
      return a.daysUntil - b.daysUntil;
    }
    return a.title.localeCompare(b.title);
  });
}

export type Acknowledgement = {
  alertKey: string;
  /** Null = dismissed until the underlying fact changes. */
  snoozedUntil: string | null;
  /**
   * How bad it was when they said they had seen it. Null on rows written
   * before AlertAcknowledgement carried the column — read as
   * ACK_SEVERITY_WHEN_UNRECORDED, never as "matches anything".
   */
  acknowledgedSeverity: AlertSeverity | null;
};

/**
 * What an acknowledgement with no recorded severity is taken to have meant.
 *
 * Every row written before the column existed is NULL, and the choice for
 * them is a real trade with no free option:
 *
 * - Treat NULL as "matches anything" and today's behaviour is preserved
 *   exactly — including issue #110 staying live for those rows, forever.
 *   A licence somebody dismissed at sixty days would still never be
 *   mentioned again, and its "due" email would still never send.
 * - Treat NULL as STANDING (the mildest) and every dated dismissal anyone
 *   has ever made comes back at once, whether or not anything escalated.
 *   Correct, and it un-silences a pile of things nobody escalated.
 *
 * DUE_SOON is the middle and it is the one that matches what the failure
 * actually is. #110 is not "a dismissal lasted too long", it is "a
 * dismissal survived the transition to OVERDUE" — the moment the sentence
 * changes from a warning into a fact. Reading NULL as DUE_SOON keeps every
 * old dismissal working for STANDING and DUE_SOON alerts, so nothing
 * resurfaces that has not actually got worse, and guarantees that nothing
 * stays silenced once its date has passed.
 *
 * The one cost is a row genuinely acknowledged while already OVERDUE: it
 * reappears once. It then self-heals, because the next "Seen it" writes a
 * real severity. Being shown an overdue thing one extra time is the safe
 * direction of that error; never being shown it is the one that costs
 * money.
 */
export const ACK_SEVERITY_WHEN_UNRECORDED: AlertSeverity = "DUE_SOON";

export type PartitionedAlerts = {
  /** What to show. */
  visible: Alert[];
  /** Silenced by this person, kept so they can see what they have hidden
   * and put it back. A silenced alert that vanishes entirely is
   * indistinguishable from one that was fixed. */
  silenced: Alert[];
};

/**
 * True when `severity` is a worse situation than `than` — strictly worse,
 * so equal is not worse.
 *
 * OVERDUE beats DUE_SOON beats STANDING, the same order the list is ranked
 * in, read from the one table rather than re-encoded.
 */
export function severityIsWorseThan(severity: AlertSeverity, than: AlertSeverity): boolean {
  return SEVERITY_ORDER[severity] < SEVERITY_ORDER[than];
}

/**
 * Splits alerts by what this person has already dealt with.
 *
 * A snooze whose date has passed is spent and the alert returns — the
 * acknowledgement row stays, because deleting it would lose the record
 * that somebody looked.
 *
 * TWO things must match, not one, and the second is issue #110.
 *
 * The KEY carries the fact, so an alert whose underlying fact has moved —
 * a renewed licence, a reissued backcharge deadline — never matches an old
 * acknowledgement at all. That half has always worked.
 *
 * The SEVERITY carries what the key deliberately cannot: how bad an
 * UNCHANGED fact has become. A COI sixty days out and the same COI after
 * it lapses are byte-identical keys, so on the key alone one "Seen it" in
 * November silenced the expiry itself, and every one after it, forever —
 * and because the notifier reads `visible`, it silenced the "week" and
 * "due" emails too. An acknowledgement now covers the situation it was
 * made about and anything NO WORSE than it; the moment the alert escalates
 * past that, it is a different sentence and it comes back.
 *
 * It does not work the other way round. An alert that has got BETTER —
 * OVERDUE back to DUE_SOON, which happens when a date is corrected rather
 * than met — stays silenced under the same rule, and should: the person
 * already said they had seen the worse version of it.
 */
export function partitionAlerts(
  alerts: Alert[],
  acknowledgements: Acknowledgement[],
  todayIso: string,
): PartitionedAlerts {
  const byKey = new Map(acknowledgements.map((a) => [a.alertKey, a]));
  const visible: Alert[] = [];
  const silenced: Alert[] = [];

  for (const alert of alerts) {
    const ack = byKey.get(alert.key);
    const unspent = ack !== undefined && (ack.snoozedUntil === null || ack.snoozedUntil > todayIso);
    const escalated =
      ack !== undefined &&
      severityIsWorseThan(
        alert.severity,
        ack.acknowledgedSeverity ?? ACK_SEVERITY_WHEN_UNRECORDED,
      );
    (unspent && !escalated ? silenced : visible).push(alert);
  }

  return { visible: rankAlerts(visible), silenced: rankAlerts(silenced) };
}

export function summarizeAlerts(alerts: Alert[]) {
  return {
    overdue: alerts.filter((a) => a.severity === "OVERDUE").length,
    dueSoon: alerts.filter((a) => a.severity === "DUE_SOON").length,
    standing: alerts.filter((a) => a.severity === "STANDING").length,
    total: alerts.length,
    /** Money named by alerts that carry a figure. Not a total the company
     * owes or is owed — several kinds carry none, and it must never be
     * presented as a balance. */
    amountNamed: alerts.reduce((sum, a) => sum + (a.amount ?? 0), 0),
  };
}
