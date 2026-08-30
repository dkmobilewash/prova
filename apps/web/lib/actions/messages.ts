"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { emailSetupProblem, looksLikeEmail, readEmailConfig, sendEmail } from "@prova/integrations";
import { actionFail as fail, actionOk as ok, assertOwner, type ActionResult } from "./shared";

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

/** Is sending set up? Read by the page so it can say so plainly instead of
 * offering a button that always fails. */
export async function emailSendingStatus(): Promise<{ ready: boolean; problem: string | null }> {
  await requireCompanyContext();
  const problem = emailSetupProblem();
  return { ready: problem === null, problem };
}

/** Sends one email and records it, whatever happens.
 *
 * The message row is written BEFORE the provider is called, and a failure
 * is recorded as a FAILED event rather than thrown away. A send that
 * vanishes because it failed is precisely the behaviour this feature
 * exists to make impossible — the competitor complaint is mail that shows
 * "sending" forever with no record of what went wrong.
 */
export async function sendOutboundEmail(formData: FormData): Promise<ActionResult> {
  const { company, ...user } = await requireCompanyContext();
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

    const config = readEmailConfig();
    // Recorded even when unconfigured, so the from-address on the row is
    // never silently empty and the log still says who it would have been.
    const fromAddress = config?.from ?? "(not configured)";

    const message = await prisma.outboundMessage.create({
      data: {
        companyId: company.id,
        jobId,
        channel: "EMAIL",
        toAddress,
        toName: text(formData, "toName") || null,
        subject,
        body,
        fromAddress,
        relatedType: text(formData, "relatedType") || null,
        relatedId: text(formData, "relatedId") || null,
        sentByUserId: user.id,
      },
    });

    const result = await sendEmail({
      to: toAddress,
      toName: text(formData, "toName") || null,
      subject,
      text: body,
    });

    if (!result.ok) {
      await prisma.outboundMessageEvent.create({
        data: {
          messageId: message.id,
          type: "FAILED",
          // Our own clock is correct here: this failure happened in this
          // process, not at a provider reporting a past event.
          occurredAt: new Date(),
          detail: result.error,
        },
      });
      revalidatePath("/messages");
      return fail(result.error);
    }

    await prisma.$transaction([
      prisma.outboundMessage.update({
        where: { id: message.id },
        data: { providerMessageId: result.providerMessageId, fromAddress: result.from },
      }),
      prisma.outboundMessageEvent.create({
        data: { messageId: message.id, type: "QUEUED", occurredAt: new Date() },
      }),
    ]);

    revalidatePath("/messages");
    return ok;
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

    if (message.providerMessageId) {
      return fail(
        "This one actually went out, so its record stays. Only a message that never reached the provider can be removed.",
      );
    }

    await prisma.outboundMessage.delete({ where: { id: message.id } });
    revalidatePath("/messages");
    return ok;
  });
}
