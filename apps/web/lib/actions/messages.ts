"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { looksLikeEmail, readEmailConfig, sendEmail } from "@prova/integrations";
import { can } from "@/lib/permissions";
import { readSupportAddress } from "@/lib/help-config";
import { outboundEmailAllowance } from "@/lib/outbound-email-limit";
import { actionFail as fail, actionOk as ok, assertOwner, type ActionResult } from "./shared";
import { failureEventType, reachedProvider } from "@/components/messageLabels";

/** Actions here RETURN their failures. Production redacts thrown Server
 * Action messages to an opaque digest, and "your email didn't send" is
 * exactly the message a user must be able to read. */

class InputError extends Error {}

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
}

async function runAction(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InputError) return fail(err.message);
    throw err;
  }
}

/* `emailSendingStatus` used to live here and was deleted rather than wired
 * up. It duplicated what `/messages` already does by calling
 * `emailSetupProblem()` directly in its server component, so there was
 * never a caller for it and never going to be one. The reachability guard
 * in lib/actions/reachable.test.ts flags exactly this, and "delete it" is
 * half of what that failure means — the other half being "the feature has
 * no entry point", which was true of sendOutboundEmail. */

/** Sends one email and records it, whatever happens.
 *
 * The message row AND its handover event are written BEFORE the provider
 * is called, and a failure is recorded rather than thrown away. A send
 * that vanishes because it failed is precisely the behaviour this feature
 * exists to make impossible — the competitor complaint is mail that shows
 * "sending" forever with no record of what went wrong.
 *
 * **THE ORDER IS THE DESIGN**, the same way it is in
 * `notification-dispatch.ts`, and for a while this function only got half
 * of it right. The row went first, but the QUEUED event and the
 * `providerMessageId` were written afterwards, in a separate transaction.
 * Everything between the provider call and that transaction was a window
 * where the email HAD GONE to a real person and the database said
 * otherwise: no provider id, no events at all. `/messages` read "No word
 * back yet", and — the part that made this DATA-LOST rather than merely
 * wrong — `reachedProvider` saw nothing to protect, so the owner-only
 * delete guard permitted destroying the record of an email a GC had
 * already received. The guard's own comment says that is exactly what it
 * exists to prevent; it was being handed a row that lied to it.
 *
 * So the handover is claimed first and given back only when the provider
 * PROVABLY never took it. The cost is the opposite error: a crash between
 * that event and the send leaves a message reading "handed over,
 * unconfirmed" that never went. That is the right way round. An
 * overstated send surfaces as stale after a day and a person checks it; an
 * understated one is evidence that no longer exists.
 *
 * THIS ORDERING IS UNCHANGED by the capability/rate-cap split below — it
 * is factored out of the old single `sendOutboundEmail`, not rewritten.
 * `messages.test.ts`'s #111 ordering tests exercise it exactly as before,
 * through the new entry point.
 *
 * UNEXPORTED ON PURPOSE. There are exactly two ways into this function —
 * `sendOutboundEmail`, gated on a capability and a rate cap, and
 * `sendHelpRequestEmail`, which accepts no recipient argument at all — and
 * that is deliberately the complete set. A third caller could hand this
 * an arbitrary recipient with neither check, which is the exact hole this
 * split exists to close.
 */
async function deliverEmail(input: {
  companyId: string;
  jobId: string | null;
  toAddress: string;
  toName: string | null;
  subject: string;
  body: string;
  relatedType: string | null;
  relatedId: string | null;
  sentByUserId: string;
}): Promise<ActionResult> {
  const config = readEmailConfig();
  // Recorded even when unconfigured, so the from-address on the row is
  // never silently empty and the log still says who it would have been.
  const fromAddress = config?.from ?? "(not configured)";

  const message = await prisma.outboundMessage.create({
    data: {
      companyId: input.companyId,
      jobId: input.jobId,
      channel: "EMAIL",
      toAddress: input.toAddress,
      toName: input.toName,
      subject: input.subject,
      body: input.body,
      fromAddress,
      relatedType: input.relatedType,
      relatedId: input.relatedId,
      sentByUserId: input.sentByUserId,
    },
  });

  // The claim. Written before the provider is reached, so that from here
  // on there is no instant at which this message can be mistaken for one
  // that never left. Our own clock is correct for it: this happened in
  // this process, not at a provider reporting a past event.
  const handover = await prisma.outboundMessageEvent.create({
    data: { messageId: message.id, type: "QUEUED", occurredAt: new Date() },
  });

  const result = await sendEmail({
    to: input.toAddress,
    toName: input.toName,
    subject: input.subject,
    text: input.body,
  });

  if (!result.ok) {
    // FAILED means "never reached the provider at all" — see
    // messageState in components/messageLabels.ts. A send the provider
    // ACCEPTED but returned no id for did reach it, and the mail has
    // almost certainly gone out. Recording that as FAILED tells a user
    // their email didn't send, they send it again, and the GC gets two.
    // It goes down as QUEUED, which is what actually happened, and it
    // will surface as unconfirmed after a day because no webhook can
    // ever match a message with no provider id.
    const outcome = failureEventType(result.mayHaveSent === true);

    if (outcome === "QUEUED") {
      // It reached the provider. The claim above already says so and is
      // the correct record — it only needs the reason. A second QUEUED
      // event would report one handover as two.
      await prisma.outboundMessageEvent.update({
        where: { id: handover.id },
        data: {
          detail: `${result.error}. Treat it as sent — do not send it again without checking with them first.`,
        },
      });
    } else {
      // Provably never got there: no network, or an outright refusal.
      // The claim is given back, because there is no copy anywhere and a
      // row carrying a QUEUED event would be undeletable evidence of an
      // email that does not exist. Swapped for FAILED in one transaction
      // so no interleaving can leave this message with neither — losing
      // the claim without recording the failure is the same hole again,
      // pointing the other way.
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

    revalidatePath("/messages");
    return fail(
      result.mayHaveSent
        ? `${result.error}. It has most likely gone out, so check with them before sending it again — a second copy is worse than a late one.`
        : result.error,
    );
  }

  try {
    await prisma.outboundMessage.update({
      where: { id: message.id },
      data: { providerMessageId: result.providerMessageId, fromAddress: result.from },
    });
  } catch {
    // The email HAS gone; only our note of the provider's id for it is
    // lost. That costs this message the join key every later webhook
    // needs, so it can never be confirmed delivered — it stays "handed
    // over, not confirmed" and goes stale after a day, which is a
    // person's cue to check. Deliberately swallowed rather than thrown:
    // a thrown Server Action message is redacted in production, so the
    // sender would see a generic failure for an email that succeeded and
    // the obvious next move is to send it again. The QUEUED event above
    // survives regardless, which is what keeps the record undeletable.
    revalidatePath("/messages");
    return fail(
      "It sent, but we couldn't finish recording it. It's in the log as handed over and unconfirmed — don't send it again.",
    );
  }

  revalidatePath("/messages");
  return ok;
}

const JOBS_ONLY =
  "Sending email to a client or GC needs the Jobs capability, which your role doesn't have here. Ask the account owner to send it, or to add Jobs to your role on the Team page.";

/**
 * The GC-facing composer's action — `/messages`'s "Send an email" form,
 * and the destination of the Ask `send_email` command's handoff
 * (`lib/ask/commands/messages.ts`), which only ever opens this same
 * composer and never sends on its own.
 *
 * GATED ON `MANAGE_JOBS`, the capability the `send_email` Ask command
 * already declares — asserted here, not invented. `/messages` itself
 * stays open to every signed-in member on purpose: it is also where help
 * requests and the alert digest show up, so the delivery LOG cannot be
 * gated the way the SEND can (see `commands.test.ts`'s note: "the
 * delivery log is open to every signed-in person, and sending is the
 * action's problem, not the page's"). This is the one place that decides
 * who may actually put words in front of a GC from the company's shared
 * sending domain — the capability check runs before anything is read, the
 * same rule every other `ActionResult` module in this codebase follows.
 *
 * ALSO RATE-CAPPED, separately: see `lib/outbound-email-limit.ts` for the
 * number, why it only counts this path, and why it fails closed.
 *
 * Both checks happen before any row is written to `OutboundMessage`. The
 * actual send is `deliverEmail` above, unchanged from before this split —
 * see its comment for why the write ordering around the provider call is
 * the design (#111).
 */
export async function sendOutboundEmail(formData: FormData): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  if (!can(context, "MANAGE_JOBS")) return fail(JOBS_ONLY);

  return runAction(async () => {
    const toAddress = required(formData, "toAddress", "Recipient");
    if (!looksLikeEmail(toAddress)) {
      return fail(`"${toAddress}" doesn't look like an email address`);
    }
    const subject = required(formData, "subject", "Subject");
    const body = required(formData, "body", "Message");

    const jobIdRaw = text(formData, "jobId");
    let jobId: string | null = null;
    if (jobIdRaw) {
      const job = await prisma.job.findUnique({ where: { id: jobIdRaw } });
      if (!job || job.companyId !== company.id) return fail("Job not found");
      jobId = job.id;
    }

    const allowance = await outboundEmailAllowance(company.id);
    if (!allowance.ok) return fail(allowance.error);

    return deliverEmail({
      companyId: company.id,
      jobId,
      toAddress,
      toName: text(formData, "toName") || null,
      subject,
      body,
      relatedType: text(formData, "relatedType") || null,
      relatedId: text(formData, "relatedId") || null,
      sentByUserId: user.id,
    });
  });
}

/**
 * The "Ask us for help" panel's send — `help.ts`'s only way to reach a
 * human. Deliberately NOT `sendOutboundEmail`: that action now demands
 * `MANAGE_JOBS`, and routing help through it would silently close the
 * support channel for ACCOUNTING and PAYROLL_COMPLIANCE members, which is
 * exactly the regression this split exists to avoid (see #352 / the
 * capability-guards pass's own note on why the obvious gate can't just be
 * applied to the shared action).
 *
 * NO CAPABILITY CHECK — every signed-in member may ask for help — and NO
 * RATE CAP: `lib/outbound-email-limit.ts` excludes this path deliberately,
 * because a support channel that stops answering when a company hits its
 * OWN correspondence ceiling is a worse failure than the ceiling doing
 * nothing.
 *
 * WHAT MAKES LEAVING THIS OPEN SAFE: the recipient is not a parameter.
 * There is no `toAddress` (or any address-shaped argument) anywhere in
 * this function's signature for a caller to supply — the address is read
 * here, from `readSupportAddress`, every time this runs. Even a future
 * caller of this exact function cannot make it send anywhere else without
 * editing this function; the only way to change the destination is to
 * change `SUPPORT_EMAIL`. Enforced in code, not by help.ts's own care
 * about what it builds into the FormData it used to construct.
 */
export async function sendHelpRequestEmail(params: {
  companyId: string;
  jobId: string | null;
  subject: string;
  body: string;
  sentByUserId: string;
}): Promise<ActionResult> {
  const toAddress = readSupportAddress(process.env);
  if (!toAddress) {
    // help.ts already checks helpChannelFromEnv() and refuses before
    // calling this when there is no support address — this is the second,
    // independent check the comment above promises, not the only one.
    return fail("This install has no support address configured, so there's nowhere for this to go.");
  }
  return deliverEmail({
    companyId: params.companyId,
    jobId: params.jobId,
    toAddress,
    toName: null,
    subject: params.subject,
    body: params.body,
    relatedType: "HELP_REQUEST",
    relatedId: null,
    sentByUserId: params.sentByUserId,
  });
}

/** Removes a message and its events. Owner only.
 *
 * Deliberately narrow: only a message that never reached the provider can
 * go. Once something has actually been sent to a person, the record that
 * we sent it is evidence — the same rule as sent submittals and RFIs. */
export async function deleteOutboundMessage(messageId: string): Promise<ActionResult> {
  const context = await requireCompanyContext();
  return runAction(async () => {
    try {
      assertOwner(context, "Only the account owner can delete a message record");
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Only the account owner can do that");
    }

    const message = await prisma.outboundMessage.findUnique({
      where: { id: messageId },
      include: { events: true },
    });
    if (!message || message.companyId !== context.company.id) return fail("Message not found");

    // Not just providerMessageId: a send the provider accepted without
    // returning an id has none, and deleting that would destroy the record
    // of an email a real person received. Any event other than FAILED means
    // it reached the provider.
    if (reachedProvider(message.providerMessageId, message.events)) {
      return fail(
        "This one reached the provider, so its record stays. Only a message that never got that far can be removed.",
      );
    }

    await prisma.outboundMessage.delete({ where: { id: message.id } });
    revalidatePath("/messages");
    return ok;
  });
}
