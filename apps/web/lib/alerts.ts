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
 * silences a licence forever. */
export function alertKey(kind: AlertKind, subjectId: string, fact: string): string {
  return `${kind}:${subjectId}:${fact}`;
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
      key: alertKey("BACKCHARGE_RESPONSE", bc.id, bc.respondByDate),
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
 */
export function retainageAlerts(
  sources: RetainageAlertSource[],
  todayIso: string,
): Alert[] {
  const alerts: Alert[] = [];

  for (const job of sources) {
    if (job.balance <= 0) continue;

    if (job.closeoutAcceptedOn) {
      const days = daysUntilIso(job.closeoutAcceptedOn, todayIso);
      alerts.push({
        key: alertKey("RETAINAGE_RELEASE", job.jobId, job.closeoutAcceptedOn),
        kind: "RETAINAGE_RELEASE",
        severity: "OVERDUE",
        title: `Retainage on ${job.jobName} is collectable`,
        detail: `The GC accepted the closeout package ${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} ago and this is still held.`,
        href: "/closeout",
        dueOn: job.closeoutAcceptedOn,
        daysUntil: days,
        amount: job.balance,
      });
      continue;
    }

    if (job.substantialCompletionDate && job.substantialCompletionDate <= todayIso) {
      alerts.push({
        key: alertKey("RETAINAGE_RELEASE", job.jobId, job.substantialCompletionDate),
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
};

/** A closeout package the GC has had longer than anyone should have to
 * wait, with no response recorded. Callers pass only submissions still
 * outstanding. */
export function closeoutAlerts(sources: CloseoutAlertSource[], todayIso: string): Alert[] {
  const alerts: Alert[] = [];

  for (const job of sources) {
    const daysWith = -daysUntilIso(job.submittedOn, todayIso);
    if (daysWith < CLOSEOUT_CHASE_DAYS) continue;

    alerts.push({
      key: alertKey("CLOSEOUT_WITH_GC", job.jobId, job.submittedOn),
      kind: "CLOSEOUT_WITH_GC",
      severity: "STANDING",
      title: `Closeout package on ${job.jobName} has had no response`,
      detail: `Sent ${daysWith} days ago and nothing recorded back.`,
      href: "/closeout",
      dueOn: job.submittedOn,
      daysUntil: -daysWith,
      amount: job.retainageBalance > 0 ? job.retainageBalance : null,
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
 */
export function apprenticeRatioAlerts(sources: ApprenticeRatioAlertSource[]): Alert[] {
  const alerts: Alert[] = [];

  for (const job of sources) {
    if (job.offendingDates.length === 0) continue;
    const count = job.offendingDates.length;

    alerts.push({
      key: alertKey("APPRENTICE_RATIO", job.jobId, job.offendingDates.join(",")),
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
      key: alertKey("WIP_VARIANCE", job.jobId, job.overrun.toFixed(2)),
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
