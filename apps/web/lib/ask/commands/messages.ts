import { prisma } from "@prova/db";
import { emailSetupProblem } from "@prova/integrations";
import { resolveContact } from "../resolve";
import { findJob } from "./findJob";
import { subjectFromQuestion } from "./rfis";
import type {
  CommandContext,
  CommandDefinition,
  CommandInput,
  Exclusion,
  HandoffCommandDefinition,
  PreviewLine,
  Resolution,
} from "../commands";

/**
 * Outward email, phase 4a: the first T4 command, and HANDOFF by design
 * rather than by accident.
 *
 * `sendOutboundEmail` returns ActionResult, so nothing about the redaction
 * rule stops it being DIRECT — and it must not be. A tap that sends mail
 * to a real person at a GC is the one write in this app that cannot be
 * undone by anyone, and commands.ts's tier comment names "outward send
 * without a composer" as T5, which has no member. So the card's primary is
 * a link: /messages?draft=<card>. The page loads the server-held payload
 * (lib/ask/drafts.ts), the composer opens with the recipient, job, subject
 * and message filled in, and the person presses Send there — the same
 * button, the same action, the same sentence on failure as typing it by
 * hand. Nothing this command does sends anything.
 *
 * Two things the model never supplies. The ADDRESS: the person names a
 * contact ("Turner") or a job ("the GC on Riverside"), and the address is
 * read off the Contact row the app resolves — no email field exists in the
 * schema below, so one the model invents is dropped by `schemaInput`
 * before `resolve` sees it. And any FIGURE or DATE: the body is the
 * person's own words for the message, passed through; the composer is
 * where they edit it.
 *
 * A name matching no contact is a refusal that says where to add them,
 * and a contact with no email on file is a refusal that links to their
 * page — never a guess at either. Several matches are chips, the same
 * `contactId` continuation `create_estimate_job` uses.
 */

/** The subject rule is the RFI's, imported rather than copied: cut at a
 * word boundary under 80 characters, and the card says it was derived. */
const subjectFromBody = subjectFromQuestion;

type Recipient = { id: string; name: string; email: string | null };

async function resolveSendEmail(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  // Cheap and synchronous, and before any read: a card that opens a page
  // whose composer refuses to render is a dead end the person taps into.
  const problem = emailSetupProblem();
  if (problem) return { kind: "refuse", reason: problem, href: "/messages" };

  const body = input.body ?? "";
  if (!body) return { kind: "need", missing: "what the email should say, in their own words" };

  // The job first, if one was named: it is also how the recipient may
  // have been named ("the GC on Riverside"), so it has to resolve before
  // the recipient does.
  let job: { id: string; name: string } | null = null;
  if (input.jobId || input.jobName) {
    const located = await findJob(ctx, input);
    if (located.kind !== "job") return located;
    job = located.job;
  }

  const warnings: string[] = [];
  let recipient: Recipient;
  if (input.contactId) {
    // From a chip only (a continuation key, never a schema property), and
    // re-asserted in-company regardless.
    const row = await prisma.contact.findFirst({
      where: { id: input.contactId, companyId: ctx.companyId },
      select: { id: true, name: true, email: true },
    });
    if (!row) return { kind: "refuse", reason: "That contact isn't on your account." };
    recipient = row;
  } else if (input.recipientName) {
    const found = await resolveContact(ctx.companyId, input.recipientName);
    if (found.kind === "none") {
      return {
        kind: "refuse",
        reason: `No contact matches "${input.recipientName}". Add them, with an email address, first.`,
        href: "/contacts",
      };
    }
    if (found.kind === "many") {
      return {
        kind: "clarify",
        field: "contactId",
        question: `Which ${input.recipientName}?`,
        options: found.options,
      };
    }
    recipient = { id: found.match.id, name: found.match.name, email: found.match.email };
    if (found.warning) warnings.push(found.warning);
  } else if (job) {
    // Named by the job alone: the email goes to that job's GC.
    const row = await prisma.job.findFirst({
      where: { id: job.id, companyId: ctx.companyId },
      select: { contact: { select: { id: true, name: true, email: true } } },
    });
    if (!row) return { kind: "refuse", reason: "That job isn't on your account." };
    recipient = row.contact;
  } else {
    return { kind: "need", missing: "who the email is to — a contact's name, or the job whose GC it should go to" };
  }

  if (!recipient.email) {
    return {
      kind: "refuse",
      reason: `${recipient.name} has no email address on file. Add one on their contact page first.`,
      href: `/contacts/${recipient.id}`,
    };
  }

  let subject = input.subject ?? "";
  if (!subject) {
    subject = subjectFromBody(body);
    warnings.push("Subject taken from the message. Change it on the composer if it should read differently.");
  }

  const preview: PreviewLine[] = [{ label: "To", value: `${recipient.name} · ${recipient.email}` }];
  if (job) preview.push({ label: "Job", value: job.name });
  preview.push({ label: "Subject", value: subject });
  preview.push({ label: "Message", value: body });
  preview.push({ label: "Goes out", value: "when you press Send on the composer — not before, and not from this card" });

  return {
    kind: "ready",
    resolved: {
      contactId: recipient.id,
      toName: recipient.name,
      toAddress: recipient.email,
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      subject,
      body,
    },
    preview,
    warnings,
  };
}

export const sendEmailCommand: HandoffCommandDefinition = {
  name: "send_email",
  description:
    "Prepares an email to one of this company's own contacts — a GC, developer, vendor or sub on the contacts list — and opens the composer on the Messages page with the recipient, job, subject and message filled in. The person reads it there and presses Send; the card itself sends nothing. Needs the message in the person's own words and who it is to: a contact's name, or the job it is about (it then goes to that job's GC). A subject only if they gave one. The address comes from the contact record, never from the person or from you: never supply, guess or ask for an email address. Does not send anything, does not attach a file or a record, does not add a greeting, a sign-off, a figure, a date or a promise the person did not say, and does not write to anyone who is not on the contacts list.",
  capability: "MANAGE_JOBS",
  tier: "T4_OUTWARD",
  mode: "HANDOFF",
  action: "sendOutboundEmail",
  handoffHref: (proposalId) => `/messages?draft=${proposalId}`,
  title: "Send an email",
  verb: "Preparing the email",
  button: "Open the composer",
  input_schema: {
    type: "object",
    properties: {
      recipientName: {
        type: "string",
        description:
          "Who the email is to, as the person named them — a contact on this company's own list (a GC, developer, vendor or sub). A name, never an address. Omit if they named only the job.",
      },
      jobName: {
        type: "string",
        description:
          "The job the email is about, if the person named one. When no recipient is named, the email goes to this job's GC.",
      },
      subject: {
        type: "string",
        description: "A subject line, in the person's words, only if they gave one separately from the message.",
      },
      body: {
        type: "string",
        description:
          "The message itself, in the person's own words, as it should read to the recipient. Nothing added: no greeting, no sign-off, no figure or date they did not say.",
      },
    },
  },
  continuationKeys: ["contactId", "jobId"],
  resolve: resolveSendEmail,
};

export const messageCommands: CommandDefinition[] = [sendEmailCommand];

/** The rest of lib/actions/messages.ts, with its reason. */
export const messageExclusions: Exclusion[] = [
  {
    action: "deleteOutboundMessage",
    reason:
      "T5: deletes are never commands, and a message that reached the provider cannot be deleted at all — owner only, from the row on the log.",
  },
];
