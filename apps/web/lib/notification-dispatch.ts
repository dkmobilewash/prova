import { prisma } from "@prova/db";
import {
  emailSetupProblem,
  readEmailConfig,
  sendEmail,
} from "@prova/integrations";
import { loadAlerts } from "@/lib/alerts-query";
import { digestBody, digestSubject } from "@/lib/notification-digest";
import {
  consumed,
  keysConsumed,
  noticesDue,
  partitionOwned,
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
 * That was true of the CLAIMS and, until #116, false of the MESSAGE. The
 * message row went first but its handover event and its
 * `providerMessageId` were written afterwards, in a transaction that
 * followed the send. Everything between those two points was a window
 * where the digest had reached a real person and the database said
 * otherwise: no provider id and no events at all, which is exactly what a
 * send that never left looks like. `/messages` read it as "No word back
 * yet", and `reachedProvider` — the guard on deletion — saw nothing to
 * protect. So the handover is now claimed before the send too, and given
 * back only when nothing came back to say it arrived. The cost is the
 * opposite error, and it is the right way round: an overstated send goes
 * stale in a day and somebody checks it; an understated one is evidence
 * that no longer exists.
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

  // WHICH keys this call won, not how many. A count cannot answer the
  // question that matters, because two concurrent runs for one person do
  // not have to compute the same notices: a rung boundary crossed between
  // their two reads is enough to make one run see `approaching` and the
  // other `approaching` + `week`. Claiming then returns a partial win —
  // some keys ours, some already taken — and a count of 1 looked exactly
  // like winning outright. The digest then went out covering every notice
  // in hand, including the ones the other run was at that moment sending,
  // which is two emails about one licence seconds apart: the nag this
  // whole feature exists to prevent, produced by the machinery meant to
  // prevent it.
  const won = await claim(recipient, notices);

  // A notice is ours only if we won EVERY key it consumes. Winning the
  // rung that fired is not enough — losing a rung it burns means another
  // run is speaking about this same alert right now.
  const { ours, theirs } = partitionOwned(notices, won);

  // Give back what we won for a notice we are NOT sending. Leaving those
  // claimed would burn a rung with no email behind it — the tighter,
  // newer thing to say would be spent by a run that stayed silent, and
  // nothing would ever say it. Released, it simply fires next run.
  await releaseKeys(recipient.id, keysWonFor(theirs, won));

  // Everything in hand belongs to another run. Not an error: the person is
  // being told, just not by us.
  if (ours.length === 0)
    return { ok: true, sent: false, reason: "already-claimed" };

  const subject = digestSubject(ours);
  const body = digestBody(ours, baseUrl);

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

  await linkClaimsToMessage(recipient.id, ours, message.id);

  // THE CLAIM ON THE MESSAGE ITSELF, and the last thing written before the
  // provider is reached. The dispatch rows have always been claimed first;
  // the message row was not, and the difference was the whole of #116.
  // From here on there is no instant at which this digest can be mistaken
  // for one that never left.
  //
  // Our own clock is right for this one: it happened in this process, not
  // at a provider reporting a past event.
  const handover = await prisma.outboundMessageEvent.create({
    data: { messageId: message.id, type: "QUEUED", occurredAt: new Date() },
  });

  const result = await sendEmail({
    to: recipient.email,
    toName: recipient.name,
    subject,
    text: body,
  });

  if (!result.ok) {
    const mayHaveSent = result.mayHaveSent === true;

    // Same distinction the composer draws: a send the provider accepted
    // without returning an id DID reach it, and recording that as failed
    // invites a second copy.
    if (mayHaveSent) {
      // It got there. The handover above already says so and is the
      // correct record — it only needs the reason. A second QUEUED event
      // would report one send as two.
      await prisma.outboundMessageEvent.update({
        where: { id: handover.id },
        data: { detail: result.error },
      });
    } else {
      // It did not get there — as far as `sendEmail` can tell. The claim
      // on the message is given back, because a QUEUED event is what makes
      // this row undeletable evidence, and evidence of an email that does
      // not exist is worse than none. Delete and re-record in ONE
      // transaction: losing the claim without writing the failure is #116
      // again, pointing the other way, and would leave a sent-looking
      // message with no events at all.
      //
      // "Provably" is doing less work than it sounds like. `sendEmail`
      // treats every fetch rejection as never-reached
      // (packages/integrations/src/email.ts), and a timeout after the body
      // went out is a fetch rejection. So this branch means "nothing came
      // back that says it arrived", not "nothing arrived".
      await prisma.$transaction([
        prisma.outboundMessageEvent.delete({ where: { id: handover.id } }),
        prisma.outboundMessageEvent.create({
          data: {
            messageId: message.id,
            type: "FAILED",
            occurredAt: new Date(),
            detail: result.error,
          },
        }),
      ]);
    }

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
      // Their scoping, not the won-keys one: by here the message exists
      // and the fired rungs carry its id, and releasing only those keeps
      // the looser rungs spent — they were never going to be sent, since
      // the retry re-fires the rung it failed on with `alsoSpent` already
      // in the ledger. Pinned in both directions in the dbtest.
      await releaseClaims(recipient.id, ours, message.id);
      return { ok: false, error: result.error, claimed: 0 };
    }

    return { ok: false, error: result.error, claimed: ours.length };
  }

  try {
    await prisma.outboundMessage.update({
      where: { id: message.id },
      data: {
        providerMessageId: result.providerMessageId,
        fromAddress: result.from,
      },
    });
  } catch {
    // The digest HAS gone; only our note of the provider's id for it is
    // lost. That costs this message the join key every later webhook needs,
    // so it can never be confirmed delivered — it stays handed-over and
    // unconfirmed, goes stale after a day, and that is a person's cue to
    // look. The handover event above survives regardless, which is what
    // keeps the record of a delivered email undeletable.
    //
    // Returned, not thrown, and not swallowed either. A thrown Server
    // Action message is redacted in production, so `sendMyAlertDigest`
    // would render an opaque failure for a digest that went out and the
    // obvious next move is to click the button again. The claims stand for
    // the same reason they stand on `mayHaveSent`: the email was sent.
    return {
      ok: false,
      error:
        "The digest sent, but we couldn't finish recording it. It's in the log as handed over and unconfirmed — don't send it again.",
      claimed: ours.length,
    };
  }

  return {
    ok: true,
    sent: true,
    noticeCount: ours.length,
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
 * nothing and sends nothing.
 *
 * Returns the keys THIS call created — not how many. `createManyAndReturn`
 * hands back exactly the rows it inserted, so a partial win is legible as
 * a partial win. A count could only say "at least one", and at least one
 * is not ownership: the caller was sending a digest covering notices it
 * had lost, which is how one licence produced two emails seconds apart.
 */
async function claim(
  recipient: Recipient,
  notices: DueNotice[],
): Promise<Set<string>> {
  // Each row records the rung ITS OWN key names, not the one that fired.
  // Writing `notice.rung` across all of them put every burned rung in the
  // ledger under the wrong name — a row keyed `…@approaching` saying it was
  // a `week`. Nothing sent wrong, because `dispatchKey` is the only column
  // ever matched on; but `rung` exists so somebody can ask why a person got
  // an email without parsing keys apart, and it answered wrongly for
  // exactly the rows whose answer is not obvious from the key.
  const rows = notices.flatMap((notice) =>
    consumed(notice).map(({ dispatchKey, rung }) => ({
      companyId: recipient.companyId,
      userId: recipient.id,
      dispatchKey,
      alertKey: notice.alert.key,
      rung: String(rung),
    })),
  );

  const created = await prisma.notificationDispatch.createManyAndReturn({
    data: rows,
    skipDuplicates: true,
    select: { dispatchKey: true },
  });
  return new Set(created.map((row) => row.dispatchKey));
}

/** The keys this call won, among the ones these notices consume.
 *
 * Intersecting rather than recomputing: a key is only ever released or
 * linked by the call that actually inserted it, so a run can never touch
 * a row belonging to a run it is racing. */
function keysWonFor(notices: DueNotice[], won: ReadonlySet<string>): string[] {
  return notices.flatMap(keysConsumed).filter((key) => won.has(key));
}

/**
 * Points the claims at the message they went out as.
 *
 * Only the rung that FIRED gets the link, not the looser rungs a
 * late-added record burned on the way past — those were spent, never sent,
 * and saying they were in this email would be a small lie in the one place
 * somebody looks to find out what happened.
 *
 * `messageId` is deliberately NOT unique — a digest is one email covering
 * many notices, so this writes one id across every rung that fired in it.
 * Making it unique breaks the second notice in any digest, which is a bug
 * this feature already shipped once and caught before merge.
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
 * Gives back the milestones of a send that provably never left the machine,
 * so the next run says the same thing again.
 *
 * ONLY ROWS CARRYING THIS CALL'S OWN `messageId` ARE RELEASED, and that
 * exact scoping is the whole safety of it. `linkClaimsToMessage` has
 * already run by the time we get here, so this call's fired rungs carry
 * its id and nothing else does.
 *
 * It used to also match `messageId: null`, to hand back the looser rungs
 * this notice spent on the way past. That arm could delete ANOTHER run's
 * claim: only the rung that FIRED is ever linked, so every `alsoSpent`
 * row stays null for life, and two runs whose notice sets overlap could
 * each see the other's. The interleaving is narrow — B has to read before
 * A claims and still find something of its own to claim — but the cost
 * when it lands is a duplicate email carrying the LOOSER notice behind a
 * tighter one already sent, which reads backwards to whoever gets it.
 *
 * Dropping the arm costs nothing, which is why this is a fix rather than
 * a trade. The looser rungs stay spent, and they were never going to be
 * sent: the retry re-fires the same rung it failed on, with `alsoSpent`
 * empty because those are already in the ledger. Asserted directly below
 * in `notification-dispatch.dbtest.ts`.
 *
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
    where: { userId, dispatchKey: { in: keys }, messageId },
  });
}

/**
 * Gives back keys claimed for a notice this run then declined to send.
 *
 * A DIFFERENT SITUATION from `releaseClaims` above, and it cannot use that
 * scoping: this runs when we lost the race for a notice, before any
 * message exists, so there is no `messageId` to match on. What makes it
 * safe instead is the input — the caller passes only keys `claim` reported
 * as having been CREATED by this call, so a row another run inserted is
 * never in the list and cannot be deleted by ours.
 *
 * Releasing rather than leaving them claimed is the point. A rung left
 * burnt with no email behind it is the tighter, newer thing to say spent
 * by a run that stayed silent — and nothing would ever say it.
 */
async function releaseKeys(userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await prisma.notificationDispatch.deleteMany({
    where: { userId, dispatchKey: { in: keys } },
  });
}
