import { FORM_NAMES, STATE_CONTENT } from "./content";
import { addContact, isEmail, landed, reportUnlanded, sendEmail, settle, type Attachment } from "./email";
import { sanitizeRef } from "./prefill";
import { checkFills } from "./fills";
import { renderWaiverPdf } from "./pdf";
import { DAY, HOUR, LIMITS, rateKey, underLimit, type RateStore } from "./rate-limit";
import { getForm } from "./statutes/forms";
import { FORM_KEYS, STATES, type FormKey, type StateCode } from "./statutes/types";

/**
 * POST /api/waiver, as a function of its inputs, so every branch of the
 * gate can be tested without a server.
 *
 * THE GATE (Diego, 2026-10-13, replacing the 2026-10-08 rule): fill in and
 * read the whole form with no email at all, but the PDF is NEVER handed to
 * the browser. It goes to the email address given, and only there, so every
 * PDF this tool makes reaches a real inbox and leaves an address behind.
 * That is why this returns no bytes -- a response carrying the PDF would be
 * a download button for anyone who opened the network tab.
 *
 * Every request needs a name and an email, including from a browser that
 * has given them before (it sends them again, prefilled, with
 * `returning: true`, which only means "do not send Diego a second lead note
 * or add the contact twice").
 *
 * The waiver email has to GO: Resend rejecting the address is the person's
 * typo (400), and our own failure is a 503 asking them to try again, because
 * there is no other way for them to get the PDF. A preview with no Resend
 * key still answers "sent-nowhere" so the steps can be clicked through.
 * Every send that fails is logged without the address (issue #747).
 */

export interface WaiverRequestBody {
  state?: string;
  form?: string;
  fills?: Record<string, string>;
  email?: string;
  name?: string;
  company?: string;
  marketingOptIn?: boolean;
  /** Set by a browser whose email was accepted before: no second lead. */
  returning?: boolean;
  /** Honeypot: a field no person sees. */
  website?: string;
  /** A pre-fill link's tracking code (lib/prefill.ts). Goes on the lead
   * only -- never into the PDF or the person's own email. */
  ref?: string;
}

export interface WaiverDeps {
  env: Record<string, string | undefined>;
  rate: { store: RateStore; salt: string } | null;
  ip: string;
  published: (state: StateCode) => boolean;
  reviewed: (state: StateCode) => boolean;
  send?: typeof sendEmail;
  subscribe?: typeof addContact;
  now?: () => Date;
  /** Where a send that did not land is reported. Defaults to console.error,
   * which is Vercel's runtime log. */
  log?: (line: string) => void;
}

export type WaiverResponse =
  /** `notConfigured` only happens outside production: nothing was sent. */
  | { kind: "sent"; to: string; notConfigured: boolean }
  | { kind: "error"; status: number; error: string; fieldErrors?: Partial<Record<string, string>> };

export const PAUSED = "Sending is paused for a moment. Please try again shortly.";
export const fail = (status: number, error: string, fieldErrors?: Partial<Record<string, string>>): WaiverResponse => ({ kind: "error", status, error, fieldErrors });

export async function handleWaiverRequest(body: WaiverRequestBody, deps: WaiverDeps): Promise<WaiverResponse> {
  // Settled, so a send that throws comes back as "failed" instead of being
  // swallowed by a `.catch(() => null)` with no trace (issue #747).
  const send: typeof sendEmail = (message, env) => settle((deps.send ?? sendEmail)(message, env));
  const subscribe: typeof addContact = (contact, env) => settle((deps.subscribe ?? addContact)(contact, env));

  // A bot that fills every field fills this one. Same answer as any other
  // malformed request, so it learns nothing.
  if (body.website) return fail(400, "That request could not be read.");

  const state = STATES.find((code) => code === body.state);
  const formKey = FORM_KEYS.find((key) => key === body.form);
  if (!state || !formKey || !deps.published(state)) return fail(404, "That form is not available.");
  const form = getForm(state, formKey as FormKey);

  const { fills, errors } = checkFills(form, body.fills ?? {});
  if (Object.keys(errors).length) return fail(400, "Some of the form needs another look.", errors);

  if (!deps.rate) return fail(503, PAUSED);
  if (!(await underLimit(deps.rate.store, rateKey("ip", deps.ip, deps.rate.salt), LIMITS.pdfPerIpPerHour, HOUR))) {
    return fail(429, "That is a lot of waivers in an hour. Please try again a little later.");
  }

  const returning = body.returning === true;
  // Re-checked here, not trusted from the page: anything that is not a
  // plain code is dropped rather than written into a lead email.
  const ref = sanitizeRef(body.ref);
  const email = (body.email ?? "").trim();
  const name = (body.name ?? "").trim();
  if (!name) return fail(400, "Enter your name so we know who the PDF is for.");
  if (!isEmail(email)) return fail(400, "Enter a valid email address. The PDF is sent there.");

  const pdf = await renderWaiverPdf({ form, fills, reviewed: deps.reviewed(state) });
  const formName = FORM_NAMES[formKey];
  return deliverPdf(
    {
      email,
      name,
      company: (body.company ?? "").trim(),
      marketingOptIn: body.marketingOptIn === true,
      returning,
      ref,
      what: "waiver",
      tooMany: "We have already sent that address several waivers today. Please try again tomorrow.",
      subject: `Your ${STATE_CONTENT[state].name} lien waiver: ${formName}`,
      text: [
        `Here is the ${formName.toLowerCase()} you filled in, as a PDF.`,
        "",
        `It uses the statutory form in ${form.citation}, copied from the official text.`,
        "Read it before you sign it. C-Stream is not a law firm, and this email is not legal advice.",
        "",
        "Next pay period, come back to the same page in the same browser and your details will be filled in.",
      ],
      attachment: { filename: `${STATE_CONTENT[state].slug}-${formKey.toLowerCase().replace(/_/g, "-")}-waiver.pdf`, content: pdf },
      leadSubject: `Lien waiver lead: ${name}${body.company ? `, ${body.company}` : ""} (${state})${ref ? ` [${ref}]` : ""}`,
      leadDetails: [`State: ${STATE_CONTENT[state].name}`, `Form: ${formName}`],
    },
    { env: deps.env, now: deps.now, log: deps.log, rate: deps.rate, send, subscribe },
  );
}

/**
 * The half every free tool shares once its PDF exists: the per-address cap,
 * the email to the person (which has to GO -- it is the only way they get
 * the PDF), then the lead note to Diego and the audience sign-up, which are
 * logged rather than refused when they fail. Used by the waiver and the
 * change order request (lib/change-order-request.ts), so the two cannot
 * drift on what a lead is or when a send counts.
 *
 * `send` and `subscribe` must already be settled (see handleWaiverRequest).
 */
export async function deliverPdf(
  input: {
    email: string;
    name: string;
    company: string;
    marketingOptIn: boolean;
    returning: boolean;
    ref: string | null;
    /** "waiver", "change order request": names the email in the log and the lead note. */
    what: string;
    /** The 429 when this address has had its day's PDFs. */
    tooMany: string;
    subject: string;
    /** The person's email, above the why-you-got-this footer added here. */
    text: string[];
    attachment: Attachment;
    leadSubject: string;
    /** Tool-specific lines for the lead note, after Company. Never what was
     * typed into the document -- only what kind of document it was. */
    leadDetails: string[];
  },
  deps: Pick<WaiverDeps, "env" | "now" | "log"> & {
    rate: { store: RateStore; salt: string };
    send: typeof sendEmail;
    subscribe: typeof addContact;
  },
): Promise<WaiverResponse> {
  const { email, name, returning, ref } = input;
  const { send, subscribe } = deps;
  if (!(await underLimit(deps.rate.store, rateKey("email", email, deps.rate.salt), LIMITS.emailsPerAddressPerDay, DAY))) {
    return fail(429, input.tooMany);
  }

  const sent = await send(
    {
      to: email,
      subject: input.subject,
      text: [
        ...input.text,
        "",
        // C-Stream's email rule: every email ends with why it was sent, the
        // way out, and a mailing address. The address is Diego's to supply
        // (LIEN_TOOL_MAILING_ADDRESS); until then the line is left out
        // rather than printing a placeholder to a real person.
        input.marketingOptIn
          ? "You asked for this PDF and for occasional email from C-Stream. Reply STOP and we will not email you again."
          : "You got this because you asked for this PDF. We will not email you again unless you sign up.",
        deps.env.LIEN_TOOL_MAILING_ADDRESS?.trim() ? `C-Stream, ${deps.env.LIEN_TOOL_MAILING_ADDRESS.trim()}` : null,
      ]
        .filter((line) => line !== null)
        .join("\n"),
      attachments: [input.attachment],
    },
    deps.env,
  );
  if (sent.status === "rejected") return fail(400, "That email address was rejected. Check it and try again.");
  reportUnlanded(`the ${input.what} email to the person`, sent, deps.env, deps.log);
  // The email is the only way the person gets the PDF, so if it did not go
  // there is nothing to hand over: tell them to try again. Outside
  // production a missing key counts as landed so a preview can be clicked.
  if (!landed(sent, deps.env)) return fail(503, "We could not send your PDF just now. Please try again in a minute.");

  // A returning browser is not a new lead -- UNLESS it came from an outreach
  // link, when the note is how Diego learns which link worked.
  if (!returning || ref) {
    // The lead. Only who asked and what kind of document -- never the
    // amounts, the owner or the GC typed into it.
    const notifyTo = deps.env.LEAD_NOTIFY_EMAIL?.trim() || "diego@cstream.ai";
    const note = await send(
      {
        to: notifyTo,
        subject: input.leadSubject,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `Company: ${input.company || "(not given)"}`,
          ...input.leadDetails,
          `Marketing email: ${input.marketingOptIn ? "opted in" : returning ? "(returning visitor, not asked)" : "not opted in"}`,
          `Ref: ${ref ?? "(none -- not from a pre-fill link)"}`,
          ...(returning ? ["Returning: yes -- already a contact, not added again"] : []),
          `${input.what[0].toUpperCase()}${input.what.slice(1)} emailed: ${sent.status}`,
          `At: ${(deps.now?.() ?? new Date()).toISOString()}`,
        ].join("\n"),
        replyTo: email,
      },
      deps.env,
    );
    const contact = returning
      ? ({ status: "sent", id: "" } as const)
      : await subscribe({ email, name, marketingOptIn: input.marketingOptIn, ref }, deps.env);
    if ("refDropped" in contact && contact.refDropped) {
      (deps.log ?? console.error)(`[lien-waiver] the contact was saved without its ref property: ${contact.refDropped}`);
    }
    // The lead has already landed: the email above went, and it sits
    // in Resend's log with the address on it (issue #747's rule, now always
    // met). These two failing costs a convenience, so it is logged, not
    // refused.
    reportUnlanded("the lead note", note, deps.env, deps.log);
    reportUnlanded("the audience sign-up", contact, deps.env, deps.log);
  }

  return { kind: "sent", to: email, notConfigured: sent.status === "not-configured" };
}
