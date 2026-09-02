import { prisma } from "@prova/db";
import {
  emailSetupProblem,
  readEmailConfig,
  sendEmail,
} from "@prova/integrations";
import { loadAlerts } from "@/lib/alerts-query";
import { digestBody, digestSubject } from "@/lib/notification-digest";
import {
  keysConsumed,
  noticesDue,
  type DueNotice,
} from "@/lib/notification-milestones";

/**
 * The join: the alert engine on one side, #38's sender on the other, and
 * the ledger that stops it repeating itself in between.
 *
 * Nothing here decides what is true and nothing here decides what is
 * urgent. `lib/alerts-query.ts` answers both, already filtered to what
 * this person may see and already stripped of what they have silenced.
 * `lib/notification-milestones.ts` decides what has already been said.
 * This runs the sequence and writes down what happened.
 *
 * **THE ORDER IS THE DESIGN.** The dispatch rows are claimed BEFORE the
 * provider is called, and the unique constraint on
 * `(userId, dispatchKey)` is the lock. A crash between sending and
 * recording is then a notice that was sent and recorded, not one that
 * goes again tomorrow.
 *
 * The cost is that a failed send does not retry itself, and that is
 * deliberate. It is the same judgement `sendOutboundEmail` already makes
 * about `mayHaveSent`: a second copy is worse than a late one. Everything
 * that happened is in the delivery log, including the failure and its
 * reason, and a person decides what to do about it. The alternative —
 * recording after a successful send — turns every timeout into a repeat,
 * and a duplicate compliance warning is exactly the thing that teaches
 * somebody to filter these.
 */

export type DispatchOutcome =
  | { ok: true; sent: false; reason: "nothing-due" | "already-claimed" }
  | { ok: false; error: string; claimed: 0; unconfigured: true }
  | {
      ok: true;
      sent: true;
      noticeCount: number;
      messageId: string;
      toAddress: string;
    }
  | { ok: false; error: string; claimed: number };

/** Everything the digest needs about one person, resolved together. */
type Recipient = {
  id: string;
  companyId: string;
  email: string;
  name: string | null;
  /** Passed in rather than looked up, so this reads exactly the principal
   * the caller already resolved. Two places deciding what somebody's role
   * is would be two answers to a question that gates what they are told. */
  role: string;
  jobFunction: string | null;
};

/**
 * Works out what this person has not been told, tells them, and records it.
 *
 * `todayIso` is passed in rather than read from the clock so a caller can
 * be a scheduled run, a button, or a test, and all three agree about what
 * day it is — the same reason every derivation module in this app takes a
 * date instead of calling `new Date()`.
 */
export async function dispatchAlertDigest(
  recipient: Recipient,
  todayIso: string,
  baseUrl: string,
): Promise<DispatchOutcome> {
  const { visible } = await loadAlerts(
    recipient.companyId,
    recipient.id,
    todayIso,
    {
      role: recipient.role,
      jobFunction: recipient.jobFunction,
    },
  );

  // Only what this person can see and has not silenced. `loadAlerts` has
  // already applied both; re-deriving either here would be a second
  // opinion about a question that has one answer.
  const sentKeys = await sentKeysFor(
    recipient.id,
    visible.map((alert) => alert.key),
  );
  const notices = noticesDue(visible, sentKeys);
  if (notices.length === 0)
    return { ok: true, sent: false, reason: "nothing-due" };

  // BEFORE claiming anything. Sending that was never set up is not a
  // failed send — it is a send that was never attempted, and there is no
  // copy anywhere to worry about duplicating.
  //
  // Claiming first here was a real bug, and the worst one this feature
  // could have: a company with no sending domain yet — which is every
  // company on day one, so the likeliest first click there is — burned
  // every milestone permanently. The licence warnings could then never be
  // sent, not even after email was configured, because the ledger said
  // they already had been. Nothing failed loudly; the emails simply never
  // existed.
  //
  // This is the one failure that releases nothing because it takes
  // nothing. Everything below it keeps its claim on purpose.
  const config = readEmailConfig();
  if (!config) {
    return {
      ok: false,
      error: emailSetupProblem() ?? "Email sending isn't set up yet.",
      claimed: 0,
      unconfigured: true,
    };
  }

  const claimed = await claim(recipient, notices);
  // Another run got there first. Not an error: the person is being told,
  // just not by us.
  if (claimed === 0)
    return { ok: true, sent: false, reason: "already-claimed" };

  const subject = digestSubject(notices);
  const body = digestBody(notices, baseUrl);

  const message = await prisma.outboundMessage.create({
    data: {
      companyId: recipient.companyId,
      channel: "EMAIL",
      toAddress: recipient.email,
      toName: recipient.name,
      subject,
      body,
      fromAddress: config.from,
      relatedType: "ALERT_DIGEST",
      // Deliberately no sentByUserId: nobody sent this. Attributing it to
      // the recipient would put their name on mail they did not write.
    },
  });

  await linkClaimsToMessage(recipient.id, notices, message.id);

  const result = await sendEmail({
    to: recipient.email,
    toName: recipient.name,
    subject,
    text: body,
  });

  if (!result.ok) {
    const mayHaveSent = result.mayHaveSent === true;

    await prisma.outboundMessageEvent.create({
      data: {
        messageId: message.id,
        // Same distinction the composer draws: a send the provider
        // accepted without returning an id DID reach it, and recording
        // that as failed invites a second copy.
        type: mayHaveSent ? "QUEUED" : "FAILED",
        occurredAt: new Date(),
        detail: result.error,
      },
    });

    // `mayHaveSent` decides whether the claim stands, and it is the only
    // thing that should.
    //
    // A copy may be in somebody's inbox → the claim stands, because a
    // duplicate compliance warning is worse than a late one and that is
    // the whole judgement this feature is built on.
    //
    // Nothing was sent — the network never carried it, or the provider
    // refused it outright — → the claim is released, because there is no
    // copy anywhere and a second attempt cannot duplicate one. Keeping it
    // was a bug of the same shape as claiming before checking config, and
    // worse for happening in production long after everything worked: one
    // Resend outage, one expired key, one unverified domain during a
    // nightly run, and every milestone for every user is spent for good.
    // Every send fails loudly in the log and the warnings are gone anyway.
    if (!mayHaveSent) {
      await releaseClaims(recipient.id, notices, message.id);
      return { ok: false, error: result.error, claimed: 0 };
    }

    return { ok: false, error: result.error, claimed };
  }

  await prisma.$transaction([
    prisma.outboundMessage.update({
      where: { id: message.id },
      data: {
        providerMessageId: result.providerMessageId,
        fromAddress: result.from,
      },
    }),
    prisma.outboundMessageEvent.create({
      data: { messageId: message.id, type: "QUEUED", occurredAt: new Date() },
    }),
  ]);

  return {
    ok: true,
    sent: true,
    noticeCount: notices.length,
    messageId: message.id,
    toAddress: recipient.email,
  };
}

/** Which of this person's dispatch keys are already spent.
 *
 * Narrowed to the alerts in hand rather than reading the whole ledger: the
 * table only grows, and a company two years in should not load every
 * notice it has ever sent to decide whether to send one. */
async function sentKeysFor(
  userId: string,
  alertKeys: string[],
): Promise<Set<string>> {
  if (alertKeys.length === 0) return new Set();
  const rows = await prisma.notificationDispatch.findMany({
    where: { userId, alertKey: { in: alertKeys } },
    select: { dispatchKey: true },
  });
  return new Set(rows.map((row) => row.dispatchKey));
}

/**
 * Claims every rung these notices consume, before anything is sent.
 *
 * `skipDuplicates` makes a concurrent run lose rather than crash: two runs
 * starting together both compute the same notices, and the second inserts
 * nothing and sends nothing. The count it returns is how many rows THIS
 * call created, which is the only reliable signal of who won.
 */
async function claim(
  recipient: Recipient,
  notices: DueNotice[],
): Promise<number> {
  const rows = notices.flatMap((notice) =>
    keysConsumed(notice).map((dispatchKey) => ({
      companyId: recipient.companyId,
      userId: recipient.id,
      dispatchKey,
      alertKey: notice.alert.key,
      rung: String(notice.rung),
    })),
  );

  const result = await prisma.notificationDispatch.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Points the claims at the message they went out as.
 *
 * Only the rung that FIRED gets the link, not the looser rungs a
 * late-added record burned on the way past — those were spent, never sent,
 * and saying they were in this email would be a small lie in the one place
 * somebody looks to find out what happened.
 *
 * `messageId` is unique on the table, so this is one row per message.
 */
async function linkClaimsToMessage(
  userId: string,
  notices: DueNotice[],
  messageId: string,
): Promise<void> {
  const fired = notices.map((notice) => `${notice.alert.key}@${notice.rung}`);
  if (fired.length === 0) return;
  await prisma.notificationDispatch.updateMany({
    where: { userId, dispatchKey: { in: fired }, messageId: null },
    data: { messageId },
  });
}

/**
 * Gives back milestones for a send that provably never went out, so the
 * next run says the same thing again.
 *
 * Scoped to the keys THIS call claimed, and only while they are unlinked
 * or linked to this call's own message — a concurrent run that succeeded
 * has linked its fired rung to a different message and is not touched.
 * The message row and its FAILED event stay: what happened is still what
 * happened, and the log is the only place anyone can see it.
 */
async function releaseClaims(
  userId: string,
  notices: DueNotice[],
  messageId: string,
): Promise<void> {
  const keys = notices.flatMap(keysConsumed);
  if (keys.length === 0) return;

  await prisma.notificationDispatch.deleteMany({
    where: {
      userId,
      dispatchKey: { in: keys },
      OR: [{ messageId: null }, { messageId }],
    },
  });
}
