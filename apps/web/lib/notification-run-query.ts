import { prisma } from "@prova/db";
import { looksLikeEmail } from "@prova/integrations";
import { orderRecipients, type RunRecipient } from "@/lib/notification-run";

/**
 * Who a scheduled digest run mails, already in the order it should mail
 * them.
 *
 * Fetches and normalises only; `notification-run.ts` decides the sequence
 * and `notification-dispatch.ts` decides what each person is told. Same
 * split as `renewals.ts`/`compliance-expiry.ts` and for the same reason —
 * the deciding half has to be testable without a database.
 *
 * **EVERY USER OF EVERY COMPANY, one at a time.** There is no opt-in
 * column and this deliberately does not invent one: the digest already
 * only carries alerts this person can SEE and has not SILENCED, and
 * `/alerts` already lets anybody dismiss or snooze anything they do not
 * want to hear about again. A separate subscription flag would be a
 * second, quieter place to be unsubscribed from something, free to
 * disagree with the acknowledgements — and the failure it produces is
 * silence about an expiring licence, which is the failure this whole
 * feature exists to prevent. If a real "stop emailing me" is wanted later
 * it belongs in one place with the acknowledgements, not here.
 */
export async function loadDigestRecipients(): Promise<RunRecipient[]> {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      companyId: true,
      email: true,
      name: true,
      role: true,
      jobFunction: true,
    },
  });

  const mailable = users.filter((user) => mailbox(user.email));

  // Narrowed to the users in hand rather than reading the whole ledger:
  // the dispatch table only ever grows, and this runs every night.
  const lastByUser =
    mailable.length === 0
      ? []
      : await prisma.notificationDispatch.groupBy({
          by: ["userId"],
          where: { userId: { in: mailable.map((user) => user.id) } },
          _max: { sentAt: true },
        });

  const lastSentAt = new Map<string, Date | null>(
    lastByUser.map((row) => [row.userId, row._max.sentAt ?? null]),
  );

  return orderRecipients(
    mailable.map((user) => ({
      id: user.id,
      companyId: user.companyId,
      email: user.email,
      name: user.name,
      role: String(user.role),
      jobFunction: user.jobFunction === null ? null : String(user.jobFunction),
    })),
    lastSentAt,
  );
}

/** Whether that address is somewhere an email can actually go.
 *
 * `looksLikeEmail` is the app's one permissive shape check and is reused
 * rather than restated. The extra clause is about a value only this app
 * produces: `requireCompanyContext` writes `<clerkId>@unknown.local` when
 * Clerk hands over an account with no address at all. It passes every
 * shape test and is not a mailbox, and mailing it nightly is a bounce a
 * night against our own sending reputation for a person who cannot read
 * it either way. */
function mailbox(email: string): boolean {
  if (!looksLikeEmail(email)) return false;
  return !email.trim().toLowerCase().endsWith("@unknown.local");
}
