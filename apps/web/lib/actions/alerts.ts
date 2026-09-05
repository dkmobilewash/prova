"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { loadAlerts } from "@/lib/alerts-query";
import { snoozeIsUnspent, type AlertSeverity } from "@/lib/alerts";
import { prisma } from "@prova/db";
import { viewerToday } from "@/lib/viewerToday";
import { actionFail as fail, actionOk as ok, type ActionResult } from "./shared";

/**
 * Acknowledging an alert. The only writes this feature has.
 *
 * There is no createAlert and there never will be — every alert is derived
 * from the rows that already carry the fact (see lib/alerts.ts). What gets
 * written here is one person saying they have seen one, which is the only
 * part of an alert that is not derivable.
 *
 * Failures are RETURNED, not thrown: production redacts a thrown Server
 * Action message to a digest.
 */

class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/**
 * A key must look like one this app builds — KIND:subject:fact.
 *
 * The key arrives from the client, and it is the whole silencing
 * mechanism, so it does not get to be arbitrary. A row keyed on something
 * this app never generates would sit in the table forever silencing
 * nothing, which is harmless; a key with a wildcard-ish shape someone
 * pasted in is the thing worth refusing outright. Length is capped for
 * the same reason.
 */
function assertKeyShape(key: string) {
  if (!key) throw new InputError("Nothing to acknowledge");
  if (key.length > 200) throw new InputError("That alert reference is not one of ours");
  const parts = key.split(":");
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new InputError("That alert reference is not one of ours");
  }
}

/**
 * How bad this alert is RIGHT NOW, read off the live list.
 *
 * Deliberately NOT a parameter, for the same reason assertKeyShape exists
 * above: the key arrives from the client, the MEANING of it does not.
 * Severity is what the acknowledgement is measured against for the rest
 * of its life, and OVERDUE is the strongest claim there is — nothing is
 * worse than it, so a row recorded at OVERDUE silences that key forever.
 * A client that could name its own severity could reinstate issue #110 at
 * will, one alert at a time, which is worse than the bug being fixed.
 *
 * Null means the key is not on this person's list at all — already
 * resolved, or never theirs. There is nothing to record about a situation
 * that no longer exists, so the caller refuses rather than writing a row
 * whose severity would be a guess.
 *
 * This costs a full alert assembly. countVisibleAlerts already pays that
 * on every page load for the top-bar bell, and there is no cheaper
 * correct answer — every figure in an alert is derived and none of them
 * is stored to be looked up.
 */
async function severityForKey(
  companyId: string,
  user: { id: string; role: string; jobFunction: string | null },
  alertKey: string,
  todayIso?: string,
): Promise<AlertSeverity | null> {
  // Same call as lib/actions/notifications.ts makes, and dated the same
  // way /alerts is. This used to read the server's UTC clock, with a
  // comment saying the user's own calendar day would be better and was
  // not available on a server action. It is now: the browser parks its
  // zone in a cookie and cookies() reads it here (issue #111 item 1). It
  // matters more here than almost anywhere, because this answer decides
  // which severity a dismissal is recorded at and that is what the row is
  // measured against for the rest of its life -- see #110.
  //
  // `todayIso` is passed by snoozeAlert, which has already worked out the
  // viewer's day to validate against and must not be able to end up with
  // two of them. Absent, this reads it itself.
  const today = todayIso ?? (await viewerToday());
  const { visible, silenced } = await loadAlerts(companyId, user.id, today, {
    role: user.role,
    jobFunction: user.jobFunction,
  });
  return [...visible, ...silenced].find((a) => a.key === alertKey)?.severity ?? null;
}

/** Quiet until the underlying fact changes.
 *
 * Note what this deliberately does NOT do: it never touches the thing the
 * alert is about. Dismissing "licence expires in 12 days" does not renew
 * the licence, and the alert returns the moment somebody does — because
 * renewing it changes the date, which changes the key, which stops this
 * row matching. That is the entire expiry mechanism.
 */
export async function dismissAlert(alertKey: string): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertKeyShape(alertKey);

    const acknowledgedSeverity = await severityForKey(company.id, user, alertKey);
    if (acknowledgedSeverity === null) {
      return fail("That alert is not on your list any more — reload the page to see where it went.");
    }

    await prisma.alertAcknowledgement.upsert({
      where: { userId_alertKey: { userId: user.id, alertKey } },
      create: {
        companyId: company.id,
        userId: user.id,
        alertKey,
        snoozedUntil: null,
        acknowledgedSeverity,
      },
      // Re-dismissing something snoozed clears the date rather than
      // keeping the older, weaker instruction. The severity is re-recorded
      // for the same reason: if the alert has escalated since, this person
      // has now seen the worse version and is speaking about that one.
      update: { snoozedUntil: null, acknowledgedAt: new Date(), acknowledgedSeverity },
    });

    revalidatePath("/alerts");
    return ok;
  });
}

/** Quiet until a date, then back. */
export async function snoozeAlert(alertKey: string, formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertKeyShape(alertKey);

    const raw = text(formData, "snoozeUntil");
    if (!raw) throw new InputError("Pick a date to be reminded again");
    const snoozedUntil = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(snoozedUntil.getTime())) throw new InputError("That is not a valid date");

    // A snooze into the past is spent the moment it is written, so the
    // alert would come straight back with no explanation. Refusing says
    // what happened instead of silently doing nothing.
    //
    // MEASURED AGAINST THE VIEWER'S CALENDAR DAY, using the very predicate
    // the list itself will apply — `snoozeIsUnspent` in lib/alerts.ts, the
    // one partitionAlerts calls. This used to read the server's UTC day
    // while the list read the viewer's, which is issue #155: east of UTC
    // the UTC check accepted a date the list then treated as already spent,
    // so the form succeeded and the alert was back on the next render with
    // nothing said; west of UTC, after 17:00, it refused a "tomorrow" the
    // person had picked off their own calendar and told them it was
    // "already over". Not two bugs — one validation and one consumer
    // disagreeing about which day it is. They now cannot: same function,
    // same day, computed once here and handed to severityForKey below so
    // this action reads the clock exactly once.
    const today = await viewerToday();
    const snoozedUntilIso = snoozedUntil.toISOString().slice(0, 10);
    if (!snoozeIsUnspent(snoozedUntilIso, today)) {
      return fail("Pick a date in the future — a snooze until today is already over.");
    }

    const acknowledgedSeverity = await severityForKey(company.id, user, alertKey, today);
    if (acknowledgedSeverity === null) {
      return fail("That alert is not on your list any more — reload the page to see where it went.");
    }

    await prisma.alertAcknowledgement.upsert({
      where: { userId_alertKey: { userId: user.id, alertKey } },
      create: {
        companyId: company.id,
        userId: user.id,
        alertKey,
        snoozedUntil,
        acknowledgedSeverity,
      },
      update: { snoozedUntil, acknowledgedAt: new Date(), acknowledgedSeverity },
    });

    revalidatePath("/alerts");
    return ok;
  });
}

/** Puts a silenced alert back on the list. Deletes the row rather than
 * dating it: the acknowledgement was a decision that has been reversed,
 * and keeping a spent one would only make the next dismissal an update to
 * something already meaningless. */
export async function restoreAlert(alertKey: string): Promise<ActionResult> {
  const { ...user } = await requireCompanyContext();
  return runAction(async () => {
    assertKeyShape(alertKey);

    await prisma.alertAcknowledgement.deleteMany({ where: { userId: user.id, alertKey } });

    revalidatePath("/alerts");
    return ok;
  });
}
