import { prisma } from "@prova/db";
import { emailSetupProblem } from "@prova/integrations";
import { can } from "@/lib/permissions";
import { rankByName, resolveContact } from "../resolve";
import { dayLabel, parsePastDay } from "../dates";
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

/**
 * ask_who_would_know: the offer that follows "I don't know".
 *
 * Cyrus, 2026-09-27, on the launch video's third beat — "who actually showed
 * up on Riverside last Tuesday?" is refused, because nothing records
 * attendance, and the refusal is the point of the beat. What he asked for
 * is the sentence after it: "Would you like me to draft a message to
 * <whoever would know> to ask?" — then the draft, then a confirm, then it
 * goes. This command is the draft-and-confirm half. `who_would_know`
 * (tools.ts) is the half that says who, from rows.
 *
 * WHO IT CAN REACH, AND WHO IT REFUSES. The people the rows name are of
 * three kinds, and only two have an address here:
 *
 *   - a TEAMMATE, a User on this company — always has an email (the column
 *     is required);
 *   - one of the GC's PEOPLE on the job, a ContactPerson — the
 *     superintendent who walks the site. Has an email when somebody typed
 *     one; a person with none is refused with a link to add it. Read only
 *     for an asker who could open the contact page's People section
 *     (MANAGE_ESTIMATING), exactly as contact_lookup gates it;
 *   - a CREW MEMBER, a worker with no login (crew.prisma) — NO EMAIL COLUMN
 *     EXISTS for them, and SMS is modelled but not wired. On the demo
 *     dataset the foreman, the man who would actually know, is one of
 *     these. So a name that matches only a crew member is REFUSED, plainly,
 *     with where their phone number is — never quietly redirected to
 *     somebody else who happens to have an address. That substitution is
 *     the exact dishonesty this beat exists to disprove.
 *
 * The asker's own account is refused too: the rows sometimes name the
 * person asking (they filed the report). A name matching nobody is a
 * refusal, never a guess. Several matches are chips on `recipient`
 * (`user:<id>` / `person:<id>`), re-asserted in-company.
 *
 * WHAT THE MODEL SUPPLIES, AND WHAT IT MAY NOT. The NAME as the person said
 * it, the job, the day in the person's own words, and optionally what they
 * want to know in their words. The address comes off the row; the day is
 * parsed by dates.ts; the subject and body are COMPOSED IN CODE from the
 * job's name, the parsed day and the person's words, never written by the
 * model. `schemaInput` drops anything else. send_email passes the person's
 * words through as the body; here the app drafts the message, because that
 * is what was asked for and every fact in it (job, day, who) is a row — and
 * the composer is where the person edits it before pressing Send.
 *
 * HANDOFF, T4, MANAGE_JOBS — exactly as send_email, and for its reasons:
 * the tap opens /messages with the composer filled in, `sendOutboundEmail`
 * is the send and demands MANAGE_JOBS, and commands.ts names "outward send
 * without a composer" as the tier that cannot be registered. Nothing this
 * command does sends anything. The person's press of Send is the send.
 */

const RECIPIENT_CANDIDATES = 20;

type Askee =
  | { kind: "user"; id: string; name: string; email: string }
  | { kind: "person"; id: string; contactId: string; name: string; email: string | null; title: string | null; at: string };

function firstName(name: string): string {
  const trimmed = name.trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "there";
}

/** The message, from rows and the person's own words only. Exported so the
 * test can pin that no model text reaches it. */
export function composeAskWhoWouldKnow(input: {
  toName: string;
  jobName: string;
  day: string;
  question: string | null;
}): { subject: string; body: string } {
  const when = dayLabel(input.day);
  const asked = input.question?.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
  const subject = `${input.jobName} — who was on site ${when}?`;
  const lead = asked
    ? `Quick one about ${input.jobName} on ${when}: ${asked}?`
    : `Quick one about ${input.jobName} on ${when}: who was actually on site that day?`;
  const body = `Hi ${firstName(input.toName)},\n\n${lead}\n\nNothing on our side records who showed up, so I'm asking you directly. A reply here is all I need.\n\nThanks`;
  return { subject, body };
}

function recipientLabel(r: Askee): string {
  return r.kind === "person" ? `${r.name}${r.title ? ` (${r.title}, ${r.at})` : ` (${r.at})`}` : r.name;
}

async function resolveAskWhoWouldKnow(ctx: CommandContext, input: CommandInput): Promise<Resolution> {
  const problem = emailSetupProblem();
  if (problem) return { kind: "refuse", reason: problem, href: "/messages" };

  if (!(input.recipient || input.personName)) {
    return { kind: "need", missing: "who to ask — the name, as who_would_know returned it" };
  }
  if (!(input.jobId || input.jobName)) return { kind: "need", missing: "which job the question is about" };

  const dayWords = input.day?.trim();
  if (!dayWords) return { kind: "need", missing: "which day they mean" };
  const day = parsePastDay(dayWords, ctx.today);
  if (!day) {
    return {
      kind: "need",
      missing: `the day as a date — I can't read "${dayWords}"; 'last Tuesday', 'September 22' or '9/22' all work`,
    };
  }

  const located = await findJob(ctx, input);
  if (located.kind !== "job") return located;
  const job = located.job;

  // The GC's people render inside /contacts/[id]'s MANAGE_ESTIMATING
  // branch; an asker who could not open that section is not shown them
  // here either — contact_lookup's rule.
  const seesPeople = can(ctx.principal, "MANAGE_ESTIMATING");

  let recipient: Askee;
  if (input.recipient) {
    // From a chip only, and re-asserted in-company regardless.
    const [kind, id] = input.recipient.split(":");
    if (kind === "user") {
      const row = await prisma.user.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { id: true, name: true, email: true },
      });
      if (!row) return { kind: "refuse", reason: "That person isn't on your team." };
      recipient = { kind: "user", id: row.id, name: row.name?.trim() || row.email, email: row.email };
    } else if (kind === "person" && seesPeople) {
      const row = await prisma.contactPerson.findFirst({
        where: { id, companyId: ctx.companyId },
        select: { id: true, contactId: true, name: true, email: true, title: true, contact: { select: { name: true } } },
      });
      if (!row) return { kind: "refuse", reason: "That person isn't on your contacts." };
      recipient = { kind: "person", id: row.id, contactId: row.contactId, name: row.name, email: row.email, title: row.title, at: row.contact.name };
    } else {
      return { kind: "refuse", reason: "That person isn't on your account." };
    }
  } else {
    const wanted = input.personName!.trim();
    const contains = { contains: wanted, mode: "insensitive" as const };
    const [users, people] = await Promise.all([
      prisma.user.findMany({
        where: { companyId: ctx.companyId, name: contains },
        select: { id: true, name: true, email: true },
        orderBy: { name: "asc" },
        take: RECIPIENT_CANDIDATES,
      }),
      seesPeople
        ? prisma.contactPerson.findMany({
            where: { companyId: ctx.companyId, name: contains },
            select: { id: true, contactId: true, name: true, email: true, title: true, contact: { select: { name: true } } },
            orderBy: { name: "asc" },
            take: RECIPIENT_CANDIDATES,
          })
        : [],
    ]);
    const candidates: Askee[] = rankByName(
      [
        ...users.map((row) => ({ kind: "user" as const, id: row.id, name: row.name?.trim() || row.email, email: row.email })),
        ...people.map((row) => ({
          kind: "person" as const,
          id: row.id,
          contactId: row.contactId,
          name: row.name,
          email: row.email,
          title: row.title,
          at: row.contact.name,
        })),
      ],
      wanted,
    );
    if (candidates.length === 0) {
      // Not a teammate and not one of the GC's people. A crew member — no
      // login, no email column — is the likely reason, and the refusal says
      // so rather than "nobody by that name".
      const crew = await prisma.crewMember.findFirst({
        where: {
          companyId: ctx.companyId,
          archivedAt: null,
          OR: [{ legalFirstName: contains }, { legalLastName: contains }],
        },
        select: { legalFirstName: true, legalLastName: true, phone: true },
      });
      if (crew) {
        const who = `${crew.legalFirstName} ${crew.legalLastName}`.trim();
        return {
          kind: "refuse",
          reason: crew.phone
            ? `${who} is on the crew list without a login, so there is no email here to send to — and nothing here sends a text. Their phone number is on the Team page, under Crew.`
            : `${who} is on the crew list without a login or a phone number on file, so there is no way to reach them from here.`,
          // The crew roster (no-login workers) renders on /team, under the
          // account holders — components/CrewRoster.tsx.
          href: "/team",
        };
      }
      return {
        kind: "refuse",
        reason: seesPeople
          ? `Nobody on your team or at your contacts is named "${wanted}". Only people the records name can be asked — check who_would_know's list.`
          : `Nobody on your team is named "${wanted}". The GC's own people need estimating access to reach from here.`,
        href: "/team",
      };
    }
    if (candidates.length > 1) {
      return {
        kind: "clarify",
        field: "recipient",
        question: `Which ${wanted}?`,
        options: candidates.map((r) => ({
          value: `${r.kind}:${r.id}`,
          label: recipientLabel(r),
          detail: r.email ?? "no email on file",
        })),
      };
    }
    recipient = candidates[0];
  }

  if (recipient.kind === "user" && recipient.id === ctx.userId) {
    return {
      kind: "refuse",
      reason: "That's your own account — the records name you for that day, so there is nobody else on the data to ask.",
    };
  }
  if (recipient.kind === "person" && !recipient.email) {
    return {
      kind: "refuse",
      reason: `${recipientLabel(recipient)} has no email address on file. Add one on their contact page first.`,
      href: `/contacts/${recipient.contactId}`,
    };
  }

  // A User's email is a required column; a person's was checked just above.
  const toAddress = recipient.email!;
  const { subject, body } = composeAskWhoWouldKnow({
    toName: recipient.name,
    jobName: job.name,
    day,
    question: input.question ?? null,
  });

  const preview: PreviewLine[] = [
    { label: "To", value: `${recipientLabel(recipient)} · ${toAddress}` },
    { label: "Job", value: job.name },
    { label: "Day", value: dayLabel(day) },
    { label: "Subject", value: subject },
    { label: "Message", value: body },
    { label: "Goes out", value: "when you press Send on the composer — not before, and not from this card" },
  ];

  return {
    kind: "ready",
    resolved: {
      recipient: `${recipient.kind}:${recipient.id}`,
      toName: recipient.name,
      toAddress,
      jobId: job.id,
      jobName: job.name,
      day,
      subject,
      body,
    },
    preview,
    warnings: ["Drafted from the job, the day and your words. Change anything on the composer before you send it."],
  };
}

export const askWhoWouldKnowCommand: HandoffCommandDefinition = {
  name: "ask_who_would_know",
  description:
    "After refusing a question nobody here recorded the answer to — who actually showed up on a job on a day — drafts an email to one of the people who_would_know named, asking them, and opens the composer on the Messages page with it filled in. The person reads it there and presses Send; the card itself sends nothing. Call it only after who_would_know has named the person as emailable and the asker has said yes. Needs the name as who_would_know returned it (a teammate, or one of the GC's people on the job), the job, and the day in the person's own words; optionally what they want to know, in their words. The address comes from the row, never from you: never supply, guess or ask for an email address. It cannot message a crew member with no login (no email exists here, and nothing sends a text) and refuses such a name in words rather than picking somebody else; does not send anything; does not report what anyone said; and does not write the message from anything but the job, the day and the person's words.",
  capability: "MANAGE_JOBS",
  tier: "T4_OUTWARD",
  mode: "HANDOFF",
  action: "sendOutboundEmail",
  handoffHref: (proposalId) => `/messages?draft=${proposalId}`,
  title: "Ask who would know",
  verb: "Drafting the message",
  button: "Open the composer",
  input_schema: {
    type: "object",
    properties: {
      personName: {
        type: "string",
        description:
          "Who to ask, by name, exactly as who_would_know returned it — a teammate with an account, or one of the GC's people on the job. A name, never an email address.",
      },
      jobName: {
        type: "string",
        description: "The job the question is about, as the person named it.",
      },
      day: {
        type: "string",
        description:
          "The day they are asking about, in their own words — 'last Tuesday', 'yesterday', 'September 22'. Passed through as said; the app works out the date.",
      },
      question: {
        type: "string",
        description:
          "Optional. What they want to know, in their own words, if they said more than 'who showed up' — e.g. 'who was there after lunch'. Nothing added.",
      },
    },
  },
  continuationKeys: ["recipient", "jobId"],
  resolve: resolveAskWhoWouldKnow,
};

export const messageCommands: CommandDefinition[] = [sendEmailCommand, askWhoWouldKnowCommand];

/** The rest of lib/actions/messages.ts, with its reason. */
export const messageExclusions: Exclusion[] = [
  {
    action: "deleteOutboundMessage",
    reason:
      "T5: deletes are never commands, and a message that reached the provider cannot be deleted at all — owner only, from the row on the log.",
  },
  {
    action: "sendHelpRequestEmail",
    reason:
      "#352: the internal sender behind help.ts's requestHelp, the 'Ask us for help' panel. Takes no recipient argument and always addresses the configured support inbox — not a command, and not something a model prompt should be able to trigger toward an arbitrary address even if send_email's own address resolution stays honest.",
  },
];
