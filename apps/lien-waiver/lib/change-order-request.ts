import { checkChangeOrder, formatCents, type ChangeOrderDraft } from "./change-order";
import { renderChangeOrderPdf } from "./change-order-pdf";
import { addContact, isEmail, sendEmail, settle } from "./email";
import { sanitizeRef } from "./prefill";
import { HOUR, LIMITS, rateKey, underLimit } from "./rate-limit";
import { deliverPdf, fail, PAUSED, type WaiverDeps, type WaiverResponse } from "./waiver-request";

/**
 * POST /api/change-order, as a function of its inputs -- the waiver's gate
 * (lib/waiver-request.ts) with a change order request in it: honeypot,
 * every field re-checked here rather than trusted from the page, the same
 * per-IP and per-address limits, and the PDF goes to the inbox and nowhere
 * else. The response never carries the PDF.
 *
 * The limits share the waiver's counters on purpose: they are a ceiling on
 * what one connection or one address can make this app send, whichever
 * tool sent it.
 */

export interface ChangeOrderRequestBody {
  order?: Partial<Record<keyof ChangeOrderDraft, unknown>>;
  email?: string;
  name?: string;
  company?: string;
  marketingOptIn?: boolean;
  returning?: boolean;
  /** Honeypot. */
  website?: string;
  ref?: string;
}

export type ChangeOrderDeps = Pick<WaiverDeps, "env" | "rate" | "ip" | "send" | "subscribe" | "now" | "log">;

export async function handleChangeOrderRequest(body: ChangeOrderRequestBody, deps: ChangeOrderDeps): Promise<WaiverResponse> {
  const send: typeof sendEmail = (message, env) => settle((deps.send ?? sendEmail)(message, env));
  const subscribe: typeof addContact = (contact, env) => settle((deps.subscribe ?? addContact)(contact, env));

  if (body.website) return fail(400, "That request could not be read.");
  if (!body.order || typeof body.order !== "object") return fail(400, "That request could not be read.");

  const { order, errors } = checkChangeOrder(body.order);
  if (!order) return fail(400, "Some of the change order needs another look.", errors);

  if (!deps.rate) return fail(503, PAUSED);
  if (!(await underLimit(deps.rate.store, rateKey("ip", deps.ip, deps.rate.salt), LIMITS.pdfPerIpPerHour, HOUR))) {
    return fail(429, "That is a lot of PDFs in an hour. Please try again a little later.");
  }

  const ref = sanitizeRef(body.ref);
  const email = (body.email ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!name || name.length > 120) return fail(400, "Enter your name so we know who the PDF is for.");
  if (!isEmail(email)) return fail(400, "Enter a valid email address. The PDF is sent there.");

  const pdf = await renderChangeOrderPdf(order, name);
  const number = order.pcoNumber ? ` ${order.pcoNumber}` : "";
  const slug = `${order.pcoNumber || order.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "request";
  return deliverPdf(
    {
      email,
      name,
      company: (body.company ?? "").trim(),
      marketingOptIn: body.marketingOptIn === true,
      returning: body.returning === true,
      ref,
      what: "change order request",
      tooMany: "We have already sent that address several PDFs today. Please try again tomorrow.",
      subject: `Your change order request${number}: ${order.title}`,
      text: [
        `Here is your change order request${number} for ${order.project}, as a PDF.`,
        `Total requested: $${formatCents(order.totalCents)}. Schedule impact: ${order.scheduleDays} ${order.scheduleDays === 1 ? "day" : "days"}.`,
        "",
        "Read it over, then send it to the GC with your backup. The GC's signature block is blank for a pen or a PDF signature.",
        "C-Stream is not a law firm, and this email is not legal advice.",
      ],
      attachment: { filename: `change-order-request-${slug}.pdf`, content: pdf },
      leadSubject: `Change order request lead: ${name}${body.company ? `, ${body.company}` : ""}${ref ? ` [${ref}]` : ""}`,
      // What kind of document, never what is in it: no amounts, no GC.
      leadDetails: ["Tool: change order request"],
    },
    { env: deps.env, now: deps.now, log: deps.log, rate: deps.rate, send, subscribe },
  );
}
