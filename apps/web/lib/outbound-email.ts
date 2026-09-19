import { prisma } from "@prova/db";

/**
 * How much mail one company may send, and how fast.
 *
 * WHY THIS EXISTS, stated plainly because the reason changed the risk
 * rather than the code: `sendOutboundEmail` had no capability gate and no
 * ceiling of any kind, so any signed-in member of any company could send
 * unlimited arbitrary email from our SHARED sending domain. That was a
 * theoretical abuse surface for as long as the only accounts were the two
 * people building this. `/pilot` (#349) is a public signup link, so it is
 * not theoretical any more: one spammy tester earns the domain a spam
 * reputation that every other contractor's mail then inherits, and
 * sending reputation is slow and miserable to win back.
 *
 * THE CEILING IS THE CONTROL HERE, NOT THE CAPABILITY GATE, and it is
 * worth being honest about why. A person who signs up through `/pilot`
 * gets a brand new company with `role: "OWNER"` (lib/auth.ts), and rule 1
 * of `capabilitiesFor` is that an OWNER holds every capability, always.
 * So no capability check can touch the pilot case — the gate in
 * `sendOutboundEmail` is defence in depth for members INSIDE an existing
 * company, and this file is what actually bounds a stranger.
 *
 * DERIVED, NOT STORED. The count comes from the `OutboundMessage` rows
 * themselves, which the send path already writes before it calls the
 * provider. No new table, no migration, and no second number that can
 * disagree with the log — the same reason `askAllowance` counts
 * `AskUsage` rows and this repo refuses to store `overdue`.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Deliberately generous against real use and tight against abuse. A
 * contractor writing to GCs sends a handful of emails a day; these are
 * roughly an order of magnitude above that, so the first person to notice
 * them should be someone doing something the domain cannot afford.
 *
 * Both ceilings are needed and neither is redundant. The daily company
 * figure is what protects the domain. The hourly per-person one is what
 * stops a script burning the whole company's day in a minute, which is
 * the shape an abused signup actually takes.
 */
export const EMAIL_LIMITS = { perPersonPerHour: 20, perCompanyPerDay: 100 } as const;

/** Help requests are exempt from the ceilings above and carry this
 * `relatedType`, so they are also excluded from the counts — see
 * `sendSupportEmail`. A person who has run out of ordinary sends must
 * still be able to tell us that.
 *
 * The value is load-bearing on screen as well as here: `/messages` renders
 * it as "· about a help request" through `relatedLabel`'s SCREAMING_SNAKE
 * fallback, which already produces exactly that sentence. Renaming it
 * changes both the exemption and the label. */
export const HELP_RELATED_TYPE = "HELP_REQUEST";

export type EmailAllowance = { ok: true } | { ok: false; error: string };

/**
 * Whether this person may send one more email right now.
 *
 * FAILS CLOSED, and that is a deliberate divergence from `askAllowance`,
 * which fails open a few files away. The divergence is not an oversight,
 * so here is the argument:
 *
 *   - Ask fails open because its accounting table is incidental to
 *     answering a question, and a database one migration behind took the
 *     whole assistant down behind a sentence that named nothing (#257).
 *     Answering unbounded was the lesser fault.
 *   - Sending fails closed because the thing being bounded IS the harm.
 *     An unbounded Ask costs us model spend; unbounded mail from a shared
 *     domain costs every customer their deliverability, and unlike spend
 *     it cannot be refunded.
 *   - And the cost of failing closed here is near zero: this counts
 *     `OutboundMessage`, the very table the send path writes to three
 *     lines later. A database that cannot count those rows cannot record
 *     the send either, so refusing loses nothing that was going to work.
 *
 * The refusal names the number and says when it frees up, because the
 * person reading it is almost always doing nothing wrong.
 */
export async function emailAllowance(
  companyId: string,
  userId: string | null,
  now: Date = new Date(),
): Promise<EmailAllowance> {
  const window = { companyId, channel: "EMAIL" as const, relatedType: { not: HELP_RELATED_TYPE } };

  let person: number;
  let company: number;
  try {
    [person, company] = await Promise.all([
      // A null `sentByUserId` is a message the notifier sent rather than a
      // person, and it is not anybody's hourly allowance to spend. Counted
      // against the company below like any other mail, because the domain
      // does not care who pressed the button.
      userId
        ? prisma.outboundMessage.count({
            where: { ...window, sentByUserId: userId, createdAt: { gte: new Date(now.getTime() - HOUR) } },
          })
        : Promise.resolve(0),
      prisma.outboundMessage.count({
        where: { ...window, createdAt: { gte: new Date(now.getTime() - DAY) } },
      }),
    ]);
  } catch (err) {
    console.error("[messages] the send ceiling could not be read, so this send was refused", err);
    return {
      ok: false,
      error:
        "We couldn't check your sending limit just now, so this wasn't sent. Nothing was recorded — try again in a moment.",
    };
  }

  if (person >= EMAIL_LIMITS.perPersonPerHour) {
    return {
      ok: false,
      error: `You've sent ${EMAIL_LIMITS.perPersonPerHour} emails in the last hour, which is the limit. It frees up as the hour rolls on.`,
    };
  }
  if (company >= EMAIL_LIMITS.perCompanyPerDay) {
    return {
      ok: false,
      error: `Your company has sent ${EMAIL_LIMITS.perCompanyPerDay} emails in the last day, which is the limit. It frees up as the day rolls on.`,
    };
  }
  return { ok: true };
}
