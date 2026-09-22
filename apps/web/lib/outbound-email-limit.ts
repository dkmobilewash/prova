import { prisma } from "@prova/db";

/**
 * How many outward emails one company may send in a rolling day, and the
 * backstop that enforces it.
 *
 * C Stream sends every company's outward correspondence from ONE shared
 * domain (cstream.ai) until each contractor verifies their own —
 * `packages/integrations/src/email.ts`. One abusive or careless account
 * on a shared domain degrades deliverability for every OTHER company
 * sending through it, and sender reputation recovers slowly, if at all.
 * This is the backstop against that specific harm.
 *
 * It bounds `sendOutboundEmail` only — the GC-facing composer on
 * `/messages` and the Ask `send_email` command that opens it, both gated
 * on `MANAGE_JOBS` (see `lib/actions/messages.ts`). It does NOT bound
 * `sendHelpRequestEmail`, which always goes to one address (support)
 * however often it is called, so it is not the kind of send this cap
 * exists to bound — and a support channel that stops answering because a
 * company hit its OWN correspondence cap would be a worse failure than
 * this cap doing nothing. It also does not bound the alert digest
 * (`lib/notification-dispatch.ts`), which writes its own `OutboundMessage`
 * rows with no `sentByUserId` and is already bounded by what is actually
 * due.
 *
 * THE NUMBER. 100 emails per company per rolling 24 hours. A subcontractor
 * corresponding about several live jobs at once — RFI follow-ups,
 * schedule notes, a pay-application cover email — realistically sends low
 * tens of emails on a busy day. 100 is generous headroom above that
 * (several PMs working at once, an unusually busy week) while still
 * turning a runaway loop or a bulk blast into a bounded, noticeable
 * number instead of an unbounded one. One constant, easy to retune — the
 * same shape as `ASK_LIMITS` in `lib/ask/usage.ts`.
 *
 * FAILS CLOSED, the opposite of that file's `askAllowance` — said
 * explicitly because that is the house pattern for a usage ceiling in
 * this codebase, and this one deliberately breaks from it rather than
 * silently disagreeing. `askAllowance` fails open because the alternative
 * is an internal accounting table taking down the whole assistant over a
 * database hiccup (#257) — the worst case of answering unbounded there is
 * a bigger model bill, paid by us. Here the worst case of answering
 * unbounded is unmetered mail going out to real GCs from a domain every
 * other C Stream customer also sends from, at the exact moment the
 * counter meant to stop that cannot be read — categorically worse than a
 * contractor's send button not working for a few minutes until the
 * database recovers. So this one refuses instead of guessing, and the
 * refusal says that plainly rather than posing as an ordinary validation
 * failure.
 */
export const OUTBOUND_EMAIL_LIMITS = {
  /** Emails one company may send through `sendOutboundEmail` in a rolling
   * 24 hours. */
  perCompanyPerDay: 100,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export type OutboundEmailAllowance = { ok: true } | { ok: false; error: string };

/**
 * Counts only messages sent through the gated composer/Ask path: a real
 * person (`sentByUserId` set) sending something other than a help
 * request. Excludes the alert digest, which writes `OutboundMessage` rows
 * with no `sentByUserId` at all, and help requests
 * (`relatedType: "HELP_REQUEST"`), which must never compete with a
 * company's own correspondence for this ceiling.
 */
export async function outboundEmailAllowance(
  companyId: string,
  now: Date = new Date(),
): Promise<OutboundEmailAllowance> {
  let sentToday: number;
  try {
    sentToday = await prisma.outboundMessage.count({
      where: {
        companyId,
        channel: "EMAIL",
        sentByUserId: { not: null },
        relatedType: { not: "HELP_REQUEST" },
        createdAt: { gte: new Date(now.getTime() - DAY_MS) },
      },
    });
  } catch (err) {
    // FAILS CLOSED — see the file header for why this deliberately
    // diverges from askAllowance's fail-open. Logged loudly rather than
    // guessed at, the same reason usage.ts's own read failure is logged
    // rather than silent.
    console.error(
      "[messages] outbound email rate limit could not be read; refusing rather than sending unmetered",
      err,
    );
    return {
      ok: false,
      error:
        "We couldn't verify your company's daily sending limit just now, so this wasn't sent. Try again in a few minutes.",
    };
  }
  if (sentToday >= OUTBOUND_EMAIL_LIMITS.perCompanyPerDay) {
    return {
      ok: false,
      error:
        `Your company has sent ${OUTBOUND_EMAIL_LIMITS.perCompanyPerDay} emails in the last day, which is today's limit — ` +
        `it protects the shared sending domain every C Stream company sends from. It frees up as the day rolls on; ` +
        `contact us if a real job needs it raised.`,
    };
  }
  return { ok: true };
}
