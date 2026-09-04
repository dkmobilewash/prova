/**
 * What we actually know about a sales lead, derived from SalesActivity.
 *
 * /sales lists leads. This answers the two questions a list of leads
 * cannot: when did we last speak to them, and do we owe them a call.
 * Nothing here is stored -- every value is computed from the logged rows
 * at read time, so correcting an activity's date moves these with it.
 *
 * Owner-only, like everything else under /sales. See assertSalesAccess.
 */

import { daysUntil } from "./compliance-expiry";

export type SalesActivityType = "CALL" | "EMAIL" | "DEMO" | "MEETING" | "NOTE";

export interface LoggedActivity {
  id: string;
  type: SalesActivityType;
  /** ISO day at UTC midnight. Entered, not stamped. */
  occurredOn: string;
  /** Null = nothing owed after this one. */
  followUpOn: string | null;
  /**
   * The full timestamp the row was written, used ONLY to break ties
   * between two activities logged on the same day. Two calls on one
   * Tuesday is ordinary, and something has to decide which of them is the
   * lead's current state -- the one entered later wins, because that is
   * the one the person wrote most recently.
   */
  createdAt: string;
}

/**
 * A NOTE is not contact. Writing yourself a reminder about a prospect is
 * not the same as having spoken to them, and a "last contact" that a
 * private note can advance would let a lead look warm while nobody has
 * called it in two months -- which is the exact thing this number exists
 * to expose.
 */
const CONTACT_TYPES: readonly SalesActivityType[] = ["CALL", "EMAIL", "DEMO", "MEETING"];

export function isContact(type: SalesActivityType): boolean {
  return CONTACT_TYPES.includes(type);
}

/** Latest by the day it happened, ties broken by the moment it was logged. */
function byRecencyDesc(a: LoggedActivity, b: LoggedActivity): number {
  if (a.occurredOn !== b.occurredOn) return a.occurredOn < b.occurredOn ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return 0;
}

/** Most recent activity of any kind, or null when none is logged. */
export function latestActivity(activities: readonly LoggedActivity[]): LoggedActivity | null {
  if (activities.length === 0) return null;
  return [...activities].sort(byRecencyDesc)[0];
}

/**
 * The activities that have ACTUALLY HAPPENED as of today.
 *
 * A row dated in the future has not happened, so it cannot be the last
 * contact and it cannot have superseded anything. Found by a browser
 * tester on 2026-09-04: a note dated tomorrow silently emptied the
 * follow-up queue, marking a real outstanding email "since superseded"
 * for a conversation that had not taken place. A private note quietly
 * clearing what you owe somebody is the worst version of this feature's
 * supersession rule, and the rule was never meant to reach forwards.
 *
 * createSalesActivity now refuses a future date outright, so new rows
 * cannot be like this. This filter is what makes the rows already in the
 * database read correctly.
 */
export function occurredBy(
  activities: readonly LoggedActivity[],
  todayIso: string,
): LoggedActivity[] {
  return activities.filter((a) => daysUntil(a.occurredOn, todayIso) <= 0);
}

/**
 * When we last actually spoke to them, or null when nobody has logged
 * contact.
 *
 * Null is not "never contacted" and must never be rendered as a zero or
 * as a date -- it means nobody has written it down. A lead created five
 * minutes ago and a lead somebody has been calling for a year without
 * logging it are indistinguishable from here, and saying so is the
 * honest answer.
 */
export function lastContactOn(
  activities: readonly LoggedActivity[],
  todayIso: string,
): string | null {
  const contacts = occurredBy(activities, todayIso).filter((a) => isContact(a.type));
  return latestActivity(contacts)?.occurredOn ?? null;
}

/**
 * The one follow-up a lead currently owes, or null.
 *
 * Read from the LATEST activity only. An older activity's followUpOn is
 * history -- it was superseded the moment the next contact was logged,
 * and treating every past followUpOn as still open would leave a lead
 * owing four calls for the same conversation. The trade is stated on the
 * column itself in sales.prisma: clearing a follow-up is the explicit act
 * of logging the next activity with the date left blank.
 */
export function openFollowUp(
  activities: readonly LoggedActivity[],
  todayIso: string,
): { activityId: string; dueOn: string } | null {
  // Only what has happened can supersede. See occurredBy.
  const latest = latestActivity(occurredBy(activities, todayIso));
  if (latest === null || latest.followUpOn === null) return null;
  return { activityId: latest.id, dueOn: latest.followUpOn };
}

export type FollowUpStanding = "OVERDUE" | "DUE_TODAY" | "UPCOMING";

/**
 * A follow-up due TODAY is due, not late -- the day is not over. Same
 * reasoning as renewalUrgency in compliance-expiry.ts, and for the same
 * reason: a warning that fires a day early is a warning people learn to
 * ignore.
 */
export function followUpStanding(dueOn: string, todayIso: string): FollowUpStanding {
  const days = daysUntil(dueOn, todayIso);
  if (days < 0) return "OVERDUE";
  if (days === 0) return "DUE_TODAY";
  return "UPCOMING";
}

export interface LeadActivitySource {
  leadId: string;
  companyName: string;
  activities: readonly LoggedActivity[];
}

export interface LeadActivitySummary {
  leadId: string;
  companyName: string;
  /** Null when nobody has logged contact -- see lastContactOn. */
  lastContactOn: string | null;
  /**
   * Whole days since the last logged contact, or null when there is none.
   * Null, never 0: zero days means "we spoke today", which is the
   * opposite of "nobody has ever written anything down".
   */
  daysSinceContact: number | null;
  followUpOn: string | null;
  followUpStanding: FollowUpStanding | null;
  /** How many days late, or null when it is not late. Always positive. */
  daysOverdue: number | null;
  activityCount: number;
}

export function summarizeLeadActivity(
  source: LeadActivitySource,
  todayIso: string,
): LeadActivitySummary {
  const contactOn = lastContactOn(source.activities, todayIso);
  const followUp = openFollowUp(source.activities, todayIso);
  const standing = followUp === null ? null : followUpStanding(followUp.dueOn, todayIso);

  return {
    leadId: source.leadId,
    companyName: source.companyName,
    lastContactOn: contactOn,
    // Argument order matters and is not cosmetic: negating daysUntil()
    // returns -0 for a contact logged today, which renders as "-0 days".
    daysSinceContact: contactOn === null ? null : daysUntil(todayIso, contactOn),
    followUpOn: followUp?.dueOn ?? null,
    followUpStanding: standing,
    daysOverdue: standing === "OVERDUE" ? daysUntil(todayIso, followUp!.dueOn) : null,
    activityCount: source.activities.length,
  };
}

/**
 * Every lead that owes a call, soonest first, so the band on /sales reads
 * as a queue rather than as a list to sort by eye. Leads owing nothing
 * are absent entirely -- an empty queue is the good state and should look
 * like one.
 */
export function followUpQueue(
  sources: readonly LeadActivitySource[],
  todayIso: string,
): LeadActivitySummary[] {
  return sources
    .map((source) => summarizeLeadActivity(source, todayIso))
    .filter((summary) => summary.followUpOn !== null)
    .sort((a, b) => {
      if (a.followUpOn !== b.followUpOn) return a.followUpOn! < b.followUpOn! ? -1 : 1;
      return a.companyName.localeCompare(b.companyName);
    });
}

/** For the band's heading. Counted, not derived a second time downstream. */
export function countOverdue(queue: readonly LeadActivitySummary[]): number {
  return queue.filter((summary) => summary.followUpStanding === "OVERDUE").length;
}

export const SALES_ACTIVITY_TYPE_LABELS: Record<SalesActivityType, string> = {
  CALL: "Call",
  EMAIL: "Email",
  DEMO: "Demo",
  MEETING: "Meeting",
  NOTE: "Note",
};
