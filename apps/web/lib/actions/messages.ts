"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyContext } from "@/lib/auth";
import { prisma } from "@prova/db";
import { emailSetupProblem, looksLikeEmail, readEmailConfig, sendEmail } from "@prova/integrations";
import { deleteDocument } from "@/lib/blob";
import {
  documentUrlProblem,
  formatDocumentSize,
  isAllowedDocumentType,
  uploadMaxBytesFor,
} from "@/lib/document-uploads";
import { recipientFor, submissionBody, submissionSubject } from "@/lib/estimating/bid-submission";
import { RFQ_SOURCE_PURPOSE, attachmentsFit, rfqRecipient, type RfqSourceKind } from "@/lib/estimating/rfq";
import { can } from "@/lib/permissions";
import { readSupportAddress } from "@/lib/help-config";
import { outboundEmailAllowance } from "@/lib/outbound-email-limit";
import { paperWhere } from "@/lib/estimating/bid-papers";
import {
  InputError,
  actionFail as fail,
  actionOk as ok,
  assertOwner,
  runAction,
  type ActionResult,
} from "./shared";
import { failureEventType, reachedProvider } from "@/components/messageLabels";
import { runAgentAfterResponse } from "@/lib/agents/onEvent";
import { isReservedRelatedType } from "@/lib/outbound-related";
import { viewerTimeZone } from "@/lib/viewerToday";
import { parseProposalMode } from "@/lib/estimating/proposal-presentation";
import { loadProposalSend } from "@/lib/estimating/proposal-send-query";
import {
  BID_INVITATION_RELATED_TYPE,
  DOCUMENT_CHANGED,
  FOLLOW_UP_FAILED,
  deploymentSendRefusal,
  documentStillMatches,
  priceStillMatches,
  proposalEmailBody,
  type ProposalSendResult,
} from "@/lib/estimating/proposal-send";

/** Actions here RETURN their failures. Production redacts thrown Server
 * Action messages to an opaque digest, and "your email didn't send" is
 * exactly the message a user must be able to read. */

// `InputError` and `runAction` are imported from ./shared rather than
// declared here. Two classes with the same name are not the same class:
// `instanceof` is false between them, so a refusal thrown by a shared
// parser walked straight past a local boundary and reached production as a
// redacted digest. That is what #407 found on /welcome, and this module
// held the fifteenth copy of the class it found there.

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function required(formData: FormData, key: string, label: string) {
  const value = text(formData, key);
  if (!value) throw new InputError(`${label} is required`);
  return value;
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
 * UNEXPORTED ON PURPOSE. There are exactly FIVE ways into this function —
 * `sendOutboundEmail`, gated on a capability and a rate cap;
 * `sendHelpRequestEmail`, which accepts no recipient argument at all;
 * `submitBidPackage`, gated on a capability and the same rate cap, whose
 * recipient is READ OFF THE BID'S OWN CONTACT; `sendQuoteRequest`, the
 * same again with the recipient read off the VENDOR row the quote names;
 * and `sendBidProposal`, C Stream Bid's proposal send, on the same terms as
 * `submitBidPackage` — and that is deliberately the complete set. A caller that could hand this
 * an arbitrary recipient with neither check is the exact hole this split
 * exists to close.
 *
 * THAT SENTENCE SAID "TWO" UNTIL A BID PACKAGE NEEDED TO REACH A GC, and the
 * number is not the point — the property is. Every entry point either asserts
 * a capability AND the rate cap, or takes no recipient at all. A fourth may be
 * added on the same terms; one that takes an address from its caller without
 * both checks may not, whatever it is called.
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
  /**
   * Files to send with it.
   *
   * NOT RECORDED ON THE ROW, and that is a decision rather than an omission.
   * `OutboundMessage` stores what was sent as TEXT — recipient, subject,
   * body — and a column holding a copy of a 6 MB PDF would make the message
   * log a document store. What goes on the row instead is the filename, named
   * in the body by the caller, so the log still answers "what did we send
   * them" in the form a person reads.
   *
   * A stored copy of the bytes is a different feature with its own schema
   * decision — `DocuSignEnvelope.sentSnapshot` is the shape it would take —
   * and it is deliberately not smuggled in here.
   */
  attachments?: readonly { filename: string; content: Buffer }[];
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
    attachments: input.attachments,
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

    // A RESERVED TYPE IS A CLAIM SOMETHING ELSE READS AS A FACT — "this bid
    // was sent" for BID_INVITATION — so the generic composer may not write one.
    // Refused rather than silently dropped: a caller sending it is either a
    // bug or a forgery, and both should hear about it (`lib/outbound-related.ts`).
    const relatedType = text(formData, "relatedType") || null;
    if (isReservedRelatedType(relatedType)) {
      return fail("That kind of message can only be sent from its own screen, not from the general composer.");
    }

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
      relatedType,
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


/**
 * SUBMITTING A BID PACKAGE TO A GENERAL CONTRACTOR.
 *
 * The third and last way into `deliverEmail`, on the terms that function's
 * comment sets: a capability, the same rate cap, and a recipient this action
 * reads for itself rather than accepts.
 *
 * ── WHY IT IS IN THIS FILE AND NOT AN ESTIMATING ONE ──
 *
 * The write ordering around the provider call is the most carefully reasoned
 * sequence in this app and it was paid for once already (#111, DATA-LOST): the
 * handover is claimed BEFORE the send and given back only when the provider
 * provably never took it. A bid submission needs exactly that sequence, and a
 * second copy of it in `lib/actions/` would be two implementations of one
 * rule — the shape `CostCategory` taught this repo to look for, pointed at the
 * code that decides whether a sent email is deletable. So this calls the one
 * implementation, and the estimating-specific decisions live in
 * `lib/estimating/bid-submission.ts` where a test can reach them.
 *
 * ── THE ADDRESS IS NOT A PARAMETER ──
 *
 * The form may CHOOSE among the addresses already recorded against this bid's
 * contact; it cannot introduce one. `chosenAddress` is matched against the set
 * `recipientFor` returns and anything else is refused. A free-text recipient
 * would make "who did we send the bid to" a question about somebody's typing,
 * on the one write in this app that cannot be undone by anyone.
 *
 * ── THE PDF IS A TRANSIT BUFFER AND IS DELETED EITHER WAY ──
 *
 * The package is merged in the BROWSER (`lib/estimating/bid-package.ts` says
 * why), so the bytes reach the server through the blob store under a one-shot
 * `bid-package` token — the framework caps a Server Action body at 1 MB. This
 * attaches them and deletes the blob in a `finally`, exactly as `quoteRead.ts`
 * does and for the same reason: every early return otherwise strands a
 * public-readable file containing a company's pricing. Nothing keeps a copy;
 * the message log is the record, which is the posture Diego chose.
 */
export async function submitBidPackage(
  bidInvitationId: string,
  fileUrl: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  if (!can(context, "MANAGE_ESTIMATING")) {
    return fail("Estimating isn't part of your job function.");
  }

  return runAction(async () => {
    // REFUSED BEFORE THE BLOB IS TOUCHED when sending is not set up, so an
    // unconfigured install does not delete somebody's package to tell them so.
    const setup = emailSetupProblem();
    if (setup) return fail(setup);

    const bid = await prisma.bidInvitation.findFirst({
      where: { id: bidInvitationId, companyId: company.id },
      include: { contact: { include: { people: true } } },
    });
    // The id in the argument is a claim; this is the check.
    if (!bid) return fail("Bid not found");

    const choice = recipientFor({
      contactName: bid.contact.name,
      contactEmail: bid.contact.email,
      people: bid.contact.people.map((person) => ({ name: person.name, email: person.email })),
    });
    if (!choice.ok) return fail(choice.problem);

    // CHOSEN FROM THE SET, never supplied. An address the company has not
    // recorded cannot be reached from here whatever the form says.
    const chosen = text(formData, "toAddress");
    const allowed = [choice.recipient, ...choice.alternatives];
    const recipient = chosen
      ? allowed.find((one) => one.address.toLowerCase() === chosen.toLowerCase())
      : choice.recipient;
    if (!recipient) {
      return fail(
        "That address isn't on this GC's contact record. Pick one of the addresses listed, or add it to their contact first.",
      );
    }

    // ── THE NAMED-INTENT CONFIRM, ENFORCED HERE AND NOT ONLY EXPLAINED ──
    //
    // `PayApplications` asks the same way before a credit note, and its action
    // refuses one that arrives without the box ticked: the screen is the
    // explanation, this is the enforcement. A bid reaching a GC cannot be
    // recalled by anybody, so the press that sends it says who it is going to.
    if (text(formData, "confirmSend") !== "on") {
      return fail("Tick the box to confirm who this is going to before it sends.");
    }

    // THE PAGE COUNT IS NOT READ HERE, and `numericInputCensus` is why it is
    // worth a line. A `Number()` over a form value was in this action and was
    // never used: the count already reaches the GC inside the body the client
    // composed. The census refuses a bare `Number()` on a form because a
    // contractor's thousands comma parses to NaN and `0x10` does not — true,
    // and the better answer here was that nothing needed the figure at all.
    const fileName = required(formData, "fileName", "The package file name");

    const urlProblem = documentUrlProblem(fileUrl, "bid-package", company.id, process.env);
    if (urlProblem) return fail(urlProblem);

    // EVERY EXIT FROM HERE DELETES THE BLOB. `quoteRead.ts` carries the full
    // account: five early returns each stranded a file, and a `finally` is the
    // only shape that cannot grow a sixth.
    try {
      const allowance = await outboundEmailAllowance(company.id);
      if (!allowance.ok) return fail(allowance.error);

      let response: Response;
      try {
        response = await fetch(fileUrl);
      } catch {
        return fail("That package couldn't be read back from storage — build it again.");
      }
      if (!response.ok) {
        return fail("That package couldn't be read back from storage — build it again.");
      }

      const served = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      // Taken from the STORE's response rather than the caller's claim, the
      // same way `readStoredQuote` does it.
      if (served !== "application/pdf" || !isAllowedDocumentType(served)) {
        return fail("A bid package has to be a PDF.");
      }

      const bytes = Buffer.from(await response.arrayBuffer());
      const max = uploadMaxBytesFor("bid-package");
      if (bytes.byteLength === 0) return fail("That package is empty — build it again.");
      if (bytes.byteLength > max) {
        return fail(`That package is ${formatDocumentSize(bytes.byteLength)}, over the ${formatDocumentSize(max)} limit for one email.`);
      }

      const sent = await deliverEmail({
        companyId: company.id,
        // A bid has no job — `BidInvitation` carries no `jobId` at all, and on
        // a bid nobody has won there is none to name.
        jobId: null,
        toAddress: recipient.address,
        toName: recipient.name,
        subject: required(formData, "subject", "Subject"),
        body: required(formData, "body", "Message"),
        // The polymorphic pair, so the send is linked to the bid with no
        // migration (`messaging.prisma`).
        relatedType: "BID_INVITATION",
        relatedId: bid.id,
        sentByUserId: user.id,
        attachments: [{ filename: fileName, content: bytes }],
      });

      // ── THE STATUS MOVES ONLY ON A SEND THAT WENT ──
      //
      // Marking it SUBMITTED after a failed send is the lie this whole feature
      // exists to stop: the estimator would read "submitted" on a bid the GC
      // never received, on bid day. A failure returns the sentence and leaves
      // the status alone.
      if (!sent.ok) return sent;

      if (bid.status !== "SUBMITTED") {
        await prisma.bidInvitation.update({
          where: { id: bid.id },
          data: { status: "SUBMITTED" },
        });
      }

      revalidatePath("/bids");
      revalidatePath(`/contacts/${bid.contactId}`);
      return ok;
    } finally {
      // SAFE BECAUSE `documentUrlProblem` ACCEPTED IT ABOVE — our own store,
      // this company's own prefix — not because the caller named it.
      await deleteDocument(fileUrl);
    }
  });
}


/**
 * SENDING A SUPPLIER THE PAGES THEY NEED TO PRICE — the RFQ.
 *
 * The fourth and last way into `deliverEmail`, on the same terms. Step 5 of the
 * estimating workflow asks for "specific schedule pages and specs packaged into
 * a request for quote"; the app recorded the conversation and sent nothing, and
 * the delete confirmations on that screen still say so: *"Nothing is sent to
 * them."*
 *
 * ── IT UPLOADS NOTHING, UNLIKE THE BID PACKAGE ──
 *
 * `submitBidPackage` has to move bytes the browser merged, so it uploads under
 * a one-shot token and deletes the blob afterwards. An RFQ carries documents
 * that are ALREADY STORED and permanent — the spec sections and addenda an
 * estimator logged — so the server reads them where they live. There is no
 * upload, and therefore nothing to clean up and no `finally`.
 *
 * ── EACH DOCUMENT IS CHECKED AGAINST ITS OWN PURPOSE ──
 *
 * `documentUrlProblem` proves a URL is in our store AND under a given purpose's
 * folder for this company. A spec section checked as an addendum would be
 * checked against the wrong folder, so the kind travels with the id and
 * `RFQ_SOURCE_PURPOSE` maps it. The ids are re-read from the database scoped to
 * this bid; the form's list is a claim about which to send, never about what
 * they are.
 */
export async function sendQuoteRequest(
  bidQuoteId: string,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  if (!can(context, "MANAGE_ESTIMATING")) {
    return fail("Estimating isn't part of your job function.");
  }

  return runAction(async () => {
    const setup = emailSetupProblem();
    if (setup) return fail(setup);

    const quote = await prisma.bidQuote.findFirst({
      where: { id: bidQuoteId, companyId: company.id },
      include: { vendor: true },
    });
    if (!quote) return fail("That quote request wasn't found");

    // THE DOCUMENTS ARE THE PROJECT'S: a spec section or addendum filed under
    // another GC's invitation on the same job is on this bid too, and a supplier
    // pricing the job needs all of them (lib/estimating/bid-papers.ts).
    const anchor = { id: quote.bidInvitationId, bidProjectId: quote.bidProjectId };
    const [specSections, addenda] = await Promise.all([
      prisma.bidSpecSection.findMany({
        where: { bidInvitation: { companyId: company.id }, ...paperWhere(anchor) },
        select: { id: true, sectionNumber: true, fileUrl: true, fileName: true },
      }),
      prisma.bidAddendum.findMany({
        where: { companyId: company.id, ...paperWhere(anchor) },
        select: { id: true, reference: true, fileUrl: true, fileName: true },
      }),
    ]);

    const to = rfqRecipient({
      quotedVendorName: quote.vendorName,
      vendor: quote.vendor
        ? { name: quote.vendor.name, contactName: quote.vendor.contactName, email: quote.vendor.email }
        : null,
    });
    if (!to.ok) return fail(to.problem);

    // ── WHAT THE FORM MAY SAY, AND WHAT IT MAY NOT ──
    //
    // It names WHICH of this bid's documents to attach. It does not say where
    // they are: every url and purpose comes from the rows just read, scoped to
    // this bid and this company.
    const wanted = new Set(formData.getAll("documentId").map((one) => String(one)));
    const onThisBid: { id: string; kind: RfqSourceKind; label: string; fileUrl: string | null; fileName: string | null }[] = [
      ...specSections.map((one) => ({
        id: one.id,
        kind: "SPEC_SECTION" as RfqSourceKind,
        label: one.sectionNumber,
        fileUrl: one.fileUrl,
        fileName: one.fileName,
      })),
      ...addenda.map((one) => ({
        id: one.id,
        kind: "ADDENDUM" as RfqSourceKind,
        label: one.reference,
        fileUrl: one.fileUrl,
        fileName: one.fileName,
      })),
    ];
    const chosen = onThisBid.filter((one) => wanted.has(one.id) && one.fileUrl);
    if (chosen.length !== wanted.size) {
      return fail("One of those documents isn't on this bid any more. Reload the page and try again.");
    }

    const attachments: { filename: string; content: Buffer }[] = [];
    for (const document of chosen) {
      const problem = documentUrlProblem(
        document.fileUrl!,
        RFQ_SOURCE_PURPOSE[document.kind],
        company.id,
        process.env,
      );
      if (problem) return fail(`${document.label}: ${problem}`);

      let response: Response;
      try {
        response = await fetch(document.fileUrl!);
      } catch {
        return fail(`${document.label} couldn't be read back from storage — try again.`);
      }
      if (!response.ok) return fail(`${document.label} couldn't be read back from storage — try again.`);

      const served = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!isAllowedDocumentType(served)) return fail(`${document.label} isn't a file we can send.`);

      attachments.push({
        filename: document.fileName ?? `${document.label}.pdf`,
        content: Buffer.from(await response.arrayBuffer()),
      });
    }

    // CHECKED ON THE TOTAL. Each of these passed its own upload ceiling, maybe
    // months apart; four legitimate files are still one impossible email.
    const fits = attachmentsFit(attachments.map((one) => one.content.byteLength));
    if (!fits.ok) return fail(fits.problem);

    const allowance = await outboundEmailAllowance(company.id);
    if (!allowance.ok) return fail(allowance.error);

    const sent = await deliverEmail({
      companyId: company.id,
      jobId: null,
      toAddress: to.address,
      toName: to.name,
      subject: required(formData, "subject", "Subject"),
      body: required(formData, "body", "Message"),
      relatedType: "BID_QUOTE",
      relatedId: quote.id,
      sentByUserId: user.id,
      attachments,
    });
    if (!sent.ok) return sent;

    // ── THE DATE IS STAMPED HERE, AND ONLY HERE ──
    //
    // Every other date on this model is ENTERED, because it records something
    // that happened elsewhere — a price given, a refusal, a deadline somebody
    // set. This one happened in THIS process, a line ago, which is the same
    // argument `deliverEmail` makes for using our own clock on the QUEUED
    // event. It is written only when it was blank: re-sending a request does
    // not rewrite when it was first made, and `requestState` reads "overdue"
    // off the original ask.
    if (quote.requestedOn === null) {
      await prisma.bidQuote.update({
        where: { id: quote.id },
        data: { requestedOn: new Date() },
      });
    }

    revalidatePath("/bids");
    return ok;
  });
}


/**
 * SENDING THE PROPOSAL TO ONE GC, FROM C STREAM BID.
 *
 * The fifth way into `deliverEmail`, on the terms that function's comment sets:
 * a capability, the same rate cap, and a recipient this action reads for itself
 * — chosen from the addresses already on the GC's contact, exactly as
 * `submitBidPackage` does, never typed.
 *
 * ── WHAT GOES OUT ──
 *
 * The person's cover note, then the proposal itself as text, BUILT HERE from
 * the rows by `loadProposalSend` — the form cannot supply or alter the
 * document, only the note above it. No PDF and no link: this app has neither a
 * server-side PDF nor a public proposal link (`lib/estimating/proposal-send.ts`
 * says why). The whole body is what `OutboundMessage.body` records, so the
 * record is the copy the GC received.
 *
 * ── REFUSED BEFORE ANYTHING IS WRITTEN ──
 *
 *   - not MANAGE_ESTIMATING — before any read;
 *   - not the production deployment (`deploymentSendRefusal`) — a preview must
 *     never email a real GC, and the email pipeline itself has no such guard;
 *   - sending not set up; the bid closed; no price; no address on file;
 *   - the price moved since the page was drawn (`priceStillMatches`), or ANY
 *     of the document did (`documentStillMatches`: the fingerprint of the text
 *     the composer showed against the text rebuilt here) — an alternate, a
 *     line or a clause can change with the total untouched;
 *   - the two-step confirm not pressed (`confirmSend=yes`);
 *   - the company's outbound cap reached.
 *
 * ── ON A SEND THAT WENT ──
 *
 * The invitation moves INVITED → SUBMITTED — CONDITIONALLY, an `updateMany`
 * on `status: "INVITED"`, so a WON or DECLINED set by somebody else in the
 * meantime is never overwritten, and a SUBMITTED one stays as it is (a re-send
 * changes nothing but the log). `bidAmount` is filled with the price
 * sent when nobody had entered one, and the estimate check runs as it does when
 * the status is changed by hand (`updateBidInvitationStatus`). THE DATE IS NOT
 * A COLUMN: there is none on `BidInvitation`, and the message's own handover is
 * the date it was submitted — the guide reads it from there (`facts.ts`). A
 * failed send moves nothing.
 *
 * ── ONCE THE EMAIL HAS GONE, THE ANSWER IS "SENT" ──
 *
 * Those writes happen AFTER delivery. If one throws, the GC already has the
 * email: reporting a failure would invite a second press and a second copy in
 * their inbox. So a follow-up failure returns `{ ok: true, note }` with the
 * sentence telling the person to mark it Submitted by hand
 * (`FOLLOW_UP_FAILED`), and nothing after delivery can turn it into an error.
 *
 * NEVER DELETABLE: once it reached the provider, `deleteOutboundMessage`
 * refuses it, and C Stream Bid draws no delete for a message at all.
 */
export async function sendBidProposal(
  jobId: string,
  bidInvitationId: string,
  formData: FormData,
): Promise<ProposalSendResult> {
  const context = await requireCompanyContext();
  const { company, ...user } = context;
  if (!can(context, "MANAGE_ESTIMATING")) {
    return fail("Estimating isn't part of your job function.");
  }

  // Set only once `deliverEmail` reports the email went. Everything after that
  // point runs OUTSIDE `runAction`, so no later failure can masquerade as a
  // failed send.
  // A holder rather than a `let`: TypeScript does not see an assignment made
  // inside the callback, and would narrow a bare `let` to `null` for good.
  const outcome: {
    delivered: { invitationId: string; jobId: string; contactId: string; bidAmountIsBlank: boolean; totalCents: number } | null;
  } = { delivered: null };

  const result = await runAction(async () => {
    // FIRST, before a single row is read: a test copy of the app sends nothing.
    const deployment = deploymentSendRefusal(process.env);
    if (deployment) return fail(deployment);

    const loaded = await loadProposalSend({
      companyId: company.id,
      companyName: company.name,
      jobId,
      invitationId: bidInvitationId,
      mode: parseProposalMode(text(formData, "mode") || undefined),
      timeZone: await viewerTimeZone(),
    });
    if (!loaded.ok) return fail(loaded.problem);
    const view = loaded.view;
    if (view.blocker) return fail(view.blocker);

    if (!priceStillMatches(text(formData, "priceCents"), view.totalCents)) {
      return fail(
        "The price on this proposal changed since the page was opened. Reload it and read the new figure before sending.",
      );
    }
    // The whole document, not only its total.
    if (!documentStillMatches(text(formData, "documentFingerprint"), view.documentText)) {
      return fail(DOCUMENT_CHANGED);
    }

    // CHOSEN FROM THE SET, never supplied.
    const chosen = text(formData, "toAddress");
    const recipient = chosen
      ? view.recipients.find((one) => one.address.toLowerCase() === chosen.toLowerCase())
      : view.recipients[0];
    if (!recipient) {
      return fail(
        "That address isn't on this GC's contact record. Pick one of the addresses listed, or add it to their contact first.",
      );
    }

    // THE SECOND STEP, enforced here and not only drawn.
    if (text(formData, "confirmSend") !== "yes") {
      return fail(`Press "Yes, send it" to confirm it is going to ${view.gcName}.`);
    }

    const subject = required(formData, "subject", "Subject");
    const note = required(formData, "body", "Message");

    const allowance = await outboundEmailAllowance(company.id);
    if (!allowance.ok) return fail(allowance.error);

    const sent = await deliverEmail({
      companyId: company.id,
      jobId: view.jobId,
      toAddress: recipient.address,
      toName: recipient.name,
      subject,
      body: proposalEmailBody(note, view.documentText),
      relatedType: BID_INVITATION_RELATED_TYPE,
      relatedId: view.invitationId,
      sentByUserId: user.id,
    });
    // A failure moves nothing: "submitted" on a bid the GC never got is the lie.
    if (!sent.ok) return sent;

    outcome.delivered = {
      invitationId: view.invitationId,
      jobId: view.jobId,
      contactId: view.contactId,
      bidAmountIsBlank: view.bidAmountIsBlank,
      totalCents: view.totalCents,
    };
    return ok;
  });
  const sentFor = outcome.delivered;
  if (!result.ok || sentFor === null) return result;

  // ── AFTER DELIVERY: the GC has it, so nothing below may report a failure ──
  let note: string | undefined;
  try {
    // CONDITIONAL: only an INVITED bid becomes SUBMITTED. A WON, LOST or
    // DECLINED set in between is somebody's later decision and stays.
    const moved = await prisma.bidInvitation.updateMany({
      where: { id: sentFor.invitationId, companyId: company.id, status: "INVITED" },
      data: { status: "SUBMITTED" },
    });
    if (sentFor.bidAmountIsBlank) {
      // Conditional too: an amount somebody typed in the meantime stays.
      await prisma.bidInvitation.updateMany({
        where: { id: sentFor.invitationId, companyId: company.id, bidAmount: null },
        data: { bidAmount: (sentFor.totalCents / 100).toFixed(2) },
      });
    }
    if (moved.count > 0) {
      runAgentAfterResponse({ companyId: company.id, agent: "ESTIMATE_CHECK", bidInvitationId: sentFor.invitationId });
    }
  } catch {
    note = FOLLOW_UP_FAILED;
  }

  try {
    revalidatePath(`/bid/estimates/${sentFor.jobId}`, "layout");
    revalidatePath("/bid/home");
    revalidatePath("/bid/bids");
    revalidatePath("/bids");
    revalidatePath(`/contacts/${sentFor.contactId}`);
  } catch {
    // A stale screen is not a failed send.
  }
  return note ? { ok: true, note } : ok;
}
