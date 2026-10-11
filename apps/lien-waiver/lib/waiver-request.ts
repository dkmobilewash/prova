import { FORM_NAMES, STATE_CONTENT } from "./content";
import { addContact, isEmail, sendEmail, type SendResult } from "./email";
import { checkFills, type FillErrors } from "./fills";
import { renderWaiverPdf } from "./pdf";
import { DAY, HOUR, LIMITS, rateKey, underLimit, type RateStore } from "./rate-limit";
import { getForm } from "./statutes/forms";
import { FORM_KEYS, STATES, type FormKey, type StateCode } from "./statutes/types";

/**
 * POST /api/waiver, as a function of its inputs, so every branch of the
 * gate can be tested without a server.
 *
 * THE GATE (Diego, 2026-10-08): fill in and preview with no email at all;
 * an email is required to DOWNLOAD, and the PDF is emailed to it too. Once
 * a browser has given a valid email it is never asked again -- it sends
 * `returning: true` and gets the PDF straight back, with no email unless
 * it asks for a copy. That memory lives in the browser (localStorage), on
 * purpose: there is no account and no lead database to look it up in.
 *
 * "Valid" means the address passed the format check and Resend did not
 * reject it. When OUR side fails (a provider outage) the person still gets
 * their PDF; the gate is for a lead, not a punishment for our outage.
 */

export interface WaiverRequestBody {
  state?: string;
  form?: string;
  fills?: Record<string, string>;
  email?: string;
  name?: string;
  company?: string;
  marketingOptIn?: boolean;
  /** Set by a browser that has already given a valid email. */
  returning?: boolean;
  /** A returning browser asking for an emailed copy anyway. */
  emailCopy?: boolean;
  /** Honeypot: a field no person sees. */
  website?: string;
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
}

export type WaiverResponse =
  | { kind: "pdf"; pdf: Uint8Array; filename: string; emailStatus: SendResult["status"] | "not-requested" }
  | { kind: "error"; status: number; error: string; fieldErrors?: FillErrors };

const fail = (status: number, error: string, fieldErrors?: FillErrors): WaiverResponse => ({ kind: "error", status, error, fieldErrors });

export async function handleWaiverRequest(body: WaiverRequestBody, deps: WaiverDeps): Promise<WaiverResponse> {
  const send = deps.send ?? sendEmail;
  const subscribe = deps.subscribe ?? addContact;

  // A bot that fills every field fills this one. Same answer as any other
  // malformed request, so it learns nothing.
  if (body.website) return fail(400, "That request could not be read.");

  const state = STATES.find((code) => code === body.state);
  const formKey = FORM_KEYS.find((key) => key === body.form);
  if (!state || !formKey || !deps.published(state)) return fail(404, "That form is not available.");
  const form = getForm(state, formKey as FormKey);

  const { fills, errors } = checkFills(form, body.fills ?? {});
  if (Object.keys(errors).length) return fail(400, "Some of the form needs another look.", errors);

  if (!deps.rate) return fail(503, "Downloads are paused for a moment. Please try again shortly.");
  if (!(await underLimit(deps.rate.store, rateKey("ip", deps.ip, deps.rate.salt), LIMITS.pdfPerIpPerHour, HOUR))) {
    return fail(429, "That is a lot of waivers in an hour. Please try again a little later.");
  }

  const returning = body.returning === true;
  const email = (body.email ?? "").trim();
  const name = (body.name ?? "").trim();
  const wantsEmail = !returning || body.emailCopy === true;

  if (!returning) {
    if (!isEmail(email)) return fail(400, "Enter a valid email address to download.");
    if (!name) return fail(400, "Enter your name to download.");
  } else if (wantsEmail && !isEmail(email)) {
    return fail(400, "Enter a valid email address for the copy.");
  }

  const pdf = await renderWaiverPdf({ form, fills, reviewed: deps.reviewed(state) });
  const filename = `${STATE_CONTENT[state].slug}-${formKey.toLowerCase().replace(/_/g, "-")}-waiver.pdf`;

  if (!wantsEmail) return { kind: "pdf", pdf, filename, emailStatus: "not-requested" };

  if (!(await underLimit(deps.rate.store, rateKey("email", email, deps.rate.salt), LIMITS.emailsPerAddressPerDay, DAY))) {
    return fail(429, "We have already sent that address several waivers today. Please try again tomorrow.");
  }

  const formName = FORM_NAMES[formKey];
  const sent = await send(
    {
      to: email,
      subject: `Your ${STATE_CONTENT[state].name} lien waiver: ${formName}`,
      text: [
        `Here is the ${formName.toLowerCase()} you filled in, as a PDF.`,
        "",
        `It uses the statutory form in ${form.citation}, copied from the official text.`,
        "Read it before you sign it. C-Stream is not a law firm, and this email is not legal advice.",
        "",
        "Next pay period, come back to the same page in the same browser and your details will be filled in.",
        "",
        // C-Stream's email rule: every email ends with why it was sent, the
        // way out, and a mailing address. The address is Diego's to supply
        // (LIEN_TOOL_MAILING_ADDRESS); until then the line is left out
        // rather than printing a placeholder to a real person.
        body.marketingOptIn
          ? "You asked for this PDF and for occasional email from C-Stream. Reply STOP and we will not email you again."
          : "You got this because you asked for this PDF. We will not email you again unless you sign up.",
        deps.env.LIEN_TOOL_MAILING_ADDRESS?.trim() ? `C-Stream, ${deps.env.LIEN_TOOL_MAILING_ADDRESS.trim()}` : null,
      ]
        .filter((line) => line !== null)
        .join("\n"),
      attachments: [{ filename, content: pdf }],
    },
    deps.env,
  );
  if (sent.status === "rejected") return fail(400, "That email address was rejected. Check it and try again.");
  if (sent.status === "not-configured" && deps.env.VERCEL_ENV === "production") {
    return fail(503, "Downloads are paused for a moment. Please try again shortly.");
  }

  if (!returning) {
    // The lead. Only who asked and what kind of form -- never the amounts,
    // the owner or the GC typed into it.
    const notifyTo = deps.env.LEAD_NOTIFY_EMAIL?.trim() || "diego@cstream.ai";
    await send(
      {
        to: notifyTo,
        subject: `Lien waiver lead: ${name}${body.company ? `, ${body.company}` : ""} (${state})`,
        text: [
          `Name: ${name}`,
          `Email: ${email}`,
          `Company: ${(body.company ?? "").trim() || "(not given)"}`,
          `State: ${STATE_CONTENT[state].name}`,
          `Form: ${formName}`,
          `Marketing email: ${body.marketingOptIn ? "opted in" : "not opted in"}`,
          `Waiver emailed: ${sent.status}`,
          `At: ${(deps.now?.() ?? new Date()).toISOString()}`,
        ].join("\n"),
        replyTo: email,
      },
      deps.env,
    ).catch(() => null);
    await subscribe({ email, name, marketingOptIn: body.marketingOptIn === true }, deps.env).catch(() => null);
  }

  return { kind: "pdf", pdf, filename, emailStatus: sent.status };
}
