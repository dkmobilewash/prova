import { prisma } from "@prova/db";
import { readExpoPushConfig } from "@prova/integrations";
import { pushToUser } from "@/lib/push";
import { loadAlerts } from "@/lib/alerts-query";
import { digestSubject, rungLabel } from "@/lib/notification-digest";
import {
  consumed,
  keysConsumed,
  noticesDue,
  type DueNotice,
} from "@/lib/notification-milestones";

/**
 * The push twin of `dispatchAlertDigest`: same alert engine, same
 * milestone ledger, same claim-before-send order — a different channel,
 * with its own claim namespace.
 *
 * **THE PREFIX IS THE CHANNEL.** Email keys are unprefixed
 * (`RENEWAL:lic_1:2026-11-30@week`); push claims `push:`-prefixed twins of
 * the same keys. The ledger's `@@unique([userId, dispatchKey])` then makes
 * the channels claimable INDEPENDENTLY — a phone user still gets email, and
 * a claim on one channel never suppresses the other. A channel COLUMN
 * would have needed a migration and a backfill for a property the prefix
 * already provides.
 *
 * Two deliberate divergences from the email function, both because push
 * has no message-row semantics:
 *
 *  - **No `OutboundMessage`.** `NotificationDispatch.messageId` is nullable
 *    for exactly this shape; the ledger row (what, to whom, when) is the
 *    evidence. Rendering pushes in `/messages` is a messaging-vertical
 *    decision, deferred on purpose.
 *  - **Release scoping is the won-keys set, not a `messageId`.** Every row
 *    this function can delete is one `claim` reported as created by THIS
 *    call, which is the same guarantee the email path gets from its
 *    message id — nothing another run inserted is ever touched.
 *
 * The one lesson carried over verbatim: **config is checked BEFORE any
 * claim.** An install without EXPO_ACCESS_TOKEN must not burn `push:`
 * milestones it can never send — the exact bug the email function shipped
 * once, with every company's licence warnings spent for good.
 */

export type PushRecipient = {
  id: string;
  companyId: string;
  /** Passed in rather than looked up, so this reads exactly the principal
   * the caller already resolved — the same rule the email dispatcher
   * states. */
  role: string;
  jobFunction: string | null;
};

export type PushOutcome =
  | {
      ok: true;
      sent: false;
      reason: "nothing-due" | "already-claimed" | "no-devices";
    }
  | { ok: false; error: string; claimed: 0; unconfigured: true }
  | { ok: true; sent: true; noticeCount: number }
  | { ok: false; error: string; claimed: number };

/** The channel prefix that keeps push and email claimable independently. */
export function pushKey(dispatchKey: string): string {
  return `push:${dispatchKey}`;
}

/** One notice's consumed keys, in the push namespace. */
function pushConsumed(notice: DueNotice): string[] {
  return keysConsumed(notice).map(pushKey);
}

/** Split by whether this call won every PUSH key each notice consumes —
 * the same ownership rule as `partitionOwned`, over the prefixed set. */
function pushPartitionOwned(
  notices: DueNotice[],
  won: ReadonlySet<string>,
): { ours: DueNotice[]; theirs: DueNotice[] } {
  const ours: DueNotice[] = [];
  const theirs: DueNotice[] = [];
  for (const notice of notices) {
    const mine = pushConsumed(notice).every((key) => won.has(key));
    (mine ? ours : theirs).push(notice);
  }
  return { ours, theirs };
}

/**
 * The push body: the same facts as the email digest, sized for a banner.
 *
 * One notice names itself; several count themselves and the overdue ones,
 * because "3 things need your attention, 2 overdue" is what a person
 * decides whether to open the app on.
 */
export function pushBody(notices: DueNotice[]): string {
  if (notices.length === 0) return "";
  if (notices.length === 1) {
    const [notice] = notices;
    return `${rungLabel(notice.rung)}: ${notice.alert.title}. ${notice.alert.detail}`;
  }
  const [first] = notices;
  const overdue = notices.filter((n) => n.alert.severity === "OVERDUE").length;
  return `${notices.length} things need your attention — ${first.alert.title}${
    overdue > 0 ? `, ${overdue} overdue` : ""
  }. Open the app to see them.`;
}

/**
 * Pushes this person what they have not been told, and records it.
 *
 * Order is the design, exactly as in the email dispatcher:
 * devices → config → alerts → claims → send, with the release paths
 * mirroring the email function's provably-unsent branch.
 */
export async function dispatchAlertPush(
  recipient: PushRecipient,
  todayIso: string,
): Promise<PushOutcome> {
  // Cheapest check first, before any alert assembly: a person with no
  // registered device has nothing to push to, and a company two years in
  // must not pay an alert assembly per phone-less user every day.
  const tokens = await prisma.deviceToken.findMany({
    where: { userId: recipient.id },
    select: { expoToken: true },
  });
  if (tokens.length === 0) {
    return { ok: true, sent: false, reason: "no-devices" };
  }

  // BEFORE claiming anything. Sending that was never set up is not a
  // failed send — it is a send that was never attempted, and a claim
  // burned here could never fire later once the token was configured.
  const config = readExpoPushConfig();
  if (!config) {
    return {
      ok: false,
      error: "EXPO_ACCESS_TOKEN is not set",
      claimed: 0,
      unconfigured: true,
    };
  }

  // Same per-principal filtering and money-stripping the email half gets,
  // from the same function — never the OWNER default.
  const { visible } = await loadAlerts(recipient.companyId, recipient.id, todayIso, {
    role: recipient.role,
    jobFunction: recipient.jobFunction,
  });

  const sentKeys = await pushSentKeysFor(
    recipient.id,
    visible.map((alert) => alert.key),
  );
  const notices = noticesDue(
    visible,
    // `noticesDue` matches unprefixed keys; the ledger stores the prefixed
    // ones. Strip here so the milestone logic stays untouched.
    new Set([...sentKeys].map((key) => key.slice(pushKey("").length))),
  );
  if (notices.length === 0) return { ok: true, sent: false, reason: "nothing-due" };

  // WHICH keys this call won, not how many — the same partial-win
  // distinction the email dispatcher documents at length.
  const won = await pushClaim(recipient, notices);

  const { ours, theirs } = pushPartitionOwned(notices, won);

  // Give back what we won for a notice we are NOT sending.
  await releasePushKeys(
    recipient.id,
    theirs.flatMap(pushConsumed).filter((key) => won.has(key)),
  );

  if (ours.length === 0) return { ok: true, sent: false, reason: "already-claimed" };

  const result = await pushToUser(
    recipient.id,
    digestSubject(ours),
    pushBody(ours),
    { target: "alerts" },
  );

  if (result !== "sent") {
    // `pushToUser` answers "no-devices"/"unconfigured" only when the
    // checks above were raced past; both mean nothing was sent. Release
    // everything this call claimed so the milestone fires again. The
    // delete can only touch rows this call inserted — `claim` returns
    // exactly those.
    await releasePushKeys(recipient.id, [...won]);
    if (result === "unconfigured") {
      return {
        ok: false,
        error: "EXPO_ACCESS_TOKEN is not set",
        claimed: 0,
        unconfigured: true,
      };
    }
    return { ok: false, error: result, claimed: 0 };
  }

  return { ok: true, sent: true, noticeCount: ours.length };
}

/** Which of this person's PUSH dispatch keys are already spent. */
async function pushSentKeysFor(
  userId: string,
  alertKeys: string[],
): Promise<Set<string>> {
  if (alertKeys.length === 0) return new Set();
  const rows = await prisma.notificationDispatch.findMany({
    where: { userId, alertKey: { in: alertKeys } },
    select: { dispatchKey: true },
  });
  return new Set(
    rows.map((row) => row.dispatchKey).filter((key) => key.startsWith("push:")),
  );
}

/**
 * Claims every rung these notices consume, in the push namespace, before
 * anything is sent. Returns the PUSH keys this call created.
 */
async function pushClaim(
  recipient: PushRecipient,
  notices: DueNotice[],
): Promise<Set<string>> {
  const rows = notices.flatMap((notice) =>
    consumed(notice).map(({ dispatchKey, rung }) => ({
      companyId: recipient.companyId,
      userId: recipient.id,
      dispatchKey: pushKey(dispatchKey),
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

/** Gives back push keys this call won but is not sending. The caller
 * passes only keys `pushClaim` reported as created by THIS call. */
async function releasePushKeys(userId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await prisma.notificationDispatch.deleteMany({
    where: { userId, dispatchKey: { in: keys } },
  });
}
