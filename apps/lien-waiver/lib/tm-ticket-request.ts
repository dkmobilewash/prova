import { addContact, isEmail, sendEmail, settle } from "./email";
import { sanitizeRef } from "./prefill";
import { HOUR, LIMITS, rateKey, underLimit } from "./rate-limit";
import { checkTicket, type TicketDraft } from "./tm-ticket";
import { renderTicketPdf } from "./tm-ticket-pdf";
import { deliverPdf, fail, PAUSED, type WaiverDeps, type WaiverResponse } from "./waiver-request";

/**
 * POST /api/tm-ticket, as a function of its inputs -- the change order
 * request's gate (lib/change-order-request.ts) with a T&M ticket in it:
 * honeypot, every field re-checked here, the same per-IP and per-address
 * limits (shared counters), and the PDF goes to inboxes and nowhere else.
 *
 * The one difference: the same email goes to the foreman AND the GC
 * superintendent at once (`cc` in deliverPdf). Each address is held to the
 * day's cap. Only the foreman is a lead; the super asked us for nothing, so
 * they are never noted to Diego and never added to the audience.
 */

export interface TicketRequestBody {
  ticket?: Partial<Record<keyof TicketDraft, unknown>>;
  email?: string;
  name?: string;
  company?: string;
  marketingOptIn?: boolean;
  returning?: boolean;
  /** Honeypot. */
  website?: string;
  ref?: string;
}

export type TicketDeps = Pick<WaiverDeps, "env" | "rate" | "ip" | "send" | "subscribe" | "now" | "log">;

export async function handleTicketRequest(body: TicketRequestBody, deps: TicketDeps): Promise<WaiverResponse> {
  const send: typeof sendEmail = (message, env) => settle((deps.send ?? sendEmail)(message, env));
  const subscribe: typeof addContact = (contact, env) => settle((deps.subscribe ?? addContact)(contact, env));

  if (body.website) return fail(400, "That request could not be read.");
  if (!body.ticket || typeof body.ticket !== "object") return fail(400, "That request could not be read.");

  const { ticket, errors } = checkTicket(body.ticket);
  if (!ticket) return fail(400, "Some of the ticket needs another look.", errors);

  if (!deps.rate) return fail(503, PAUSED);
  if (!(await underLimit(deps.rate.store, rateKey("ip", deps.ip, deps.rate.salt), LIMITS.pdfPerIpPerHour, HOUR))) {
    return fail(429, "That is a lot of PDFs in an hour. Please try again a little later.");
  }

  const ref = sanitizeRef(body.ref);
  const email = (body.email ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!name || name.length > 120) return fail(400, "Enter your name so we know who the PDF is for.");
  if (!isEmail(email)) return fail(400, "Enter a valid email address. The PDF is sent there.");

  const pdf = await renderTicketPdf(ticket, name);
  return deliverPdf(
    {
      email,
      cc: ticket.superEmail,
      name,
      company: (body.company ?? "").trim(),
      marketingOptIn: body.marketingOptIn === true,
      returning: body.returning === true,
      ref,
      what: "T&M ticket",
      tooMany: "We have already sent one of those addresses several PDFs today. Please try again tomorrow.",
      subject: `T&M ticket ${ticket.number}: ${ticket.summary} (${ticket.project}, ${ticket.date})`,
      text: [
        `Here is T&M ticket ${ticket.number} for ${ticket.project}, as a PDF.`,
        `${name} filled it in and ${ticket.superName} signed it on site on ${ticket.date}. This email went to both of you.`,
        `Crew hours: ${ticket.totalHours}.`,
        "",
        "C-Stream is not a law firm, and this email is not legal advice.",
      ],
      attachment: { filename: `tm-ticket-${ticket.number.toLowerCase()}.pdf`, content: pdf },
      leadSubject: `T&M ticket lead: ${name}${body.company ? `, ${body.company}` : ""}${ref ? ` [${ref}]` : ""}`,
      // What kind of document, never what is in it: no hours, no GC, no super.
      leadDetails: ["Tool: T&M ticket"],
    },
    { env: deps.env, now: deps.now, log: deps.log, rate: deps.rate, send, subscribe },
  );
}
