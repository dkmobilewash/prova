// Outbound email.
//
// Provider-agnostic on purpose. The research report's finding is that every
// competitor's mail problems are provider problems surfaced badly — quotes
// sent from the vendor's own domain landing in spam, mail that shows
// "sending" and never arrives. Being able to change provider without
// touching the app is part of not repeating that.
//
// Nothing here throws for a missing key. An unconfigured install must be a
// clearly reported state, not a crash: CI has no key, local dev has no key,
// and a contractor who hasn't set up sending yet still needs the rest of
// the app to work.

/** One file travelling with a message.
 *
 * A BUFFER AND A NAME, nothing else. No content type: the provider infers it
 * from the filename, and a second place to state it is a second place for it
 * to be wrong about the same bytes.
 *
 * The caller owns the size budget. Base64 inflates by a third and the provider
 * caps the whole message, so a ceiling enforced here — on bytes that have
 * already been read into memory — would be the wrong place and too late. The
 * sender refuses first, with the real figure. */
export type EmailAttachment = {
  filename: string;
  content: Buffer;
};

export type EmailSendRequest = {
  to: string;
  toName?: string | null;
  subject: string;
  /** Plain text. Deliberately not HTML: a construction RFI is text, and
   * HTML mail is measurably more likely to be filtered. */
  text: string;
  /** Overrides the configured default. Recorded per message by the caller. */
  from?: string;
  /**
   * Files to send with it. Absent on every message this app sent before a bid
   * package needed to reach a GC, and absent is not the same as empty — an
   * empty array still serialises an `attachments` key, so it is normalised to
   * undefined below rather than passed through.
   *
   * ATTACHMENTS DO NOT MAKE THIS HTML. The plain-text decision above is about
   * filtering and it is unchanged: a bid goes out as a sentence with a PDF
   * beside it, which is what an estimator sends by hand today.
   */
  attachments?: readonly EmailAttachment[];
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string; from: string }
  | { ok: false; error: string; configured: boolean; mayHaveSent?: boolean };

export type EmailConfig = {
  provider: "resend";
  apiKey: string;
  /** The contractor's own domain, e.g. "office@cyrusdrywall.com".
   *
   * The single most-repeated deliverability complaint in the research is
   * quotes sent from the VENDOR's domain — jobbermail.com — going 60%
   * unopened. Sending as the contractor is the whole point, so there is no
   * fallback shared sender here on purpose. No verified domain, no sending. */
  from: string;
  /** Verifies inbound delivery webhooks. Without it we accept no events. */
  webhookSecret: string | null;
};

/** Reads config from the environment. Returns null rather than throwing when
 * sending isn't set up — the caller reports that as a state. */
export function readEmailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.OUTBOUND_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  return {
    provider: "resend",
    apiKey,
    from,
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET?.trim() || null,
  };
}

/** Why sending isn't available, in words a contractor can act on. */
export function emailSetupProblem(): string | null {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.OUTBOUND_EMAIL_FROM?.trim();
  if (!apiKey && !from) {
    return "Email sending isn't set up yet. It needs an API key and a verified sending address on your own domain.";
  }
  if (!apiKey) return "Email sending is missing its API key.";
  if (!from) {
    return "Email sending has no address to send from. It has to be an address on your own domain, verified with the provider.";
  }
  return null;
}

/** A very small sanity check, not RFC validation.
 *
 * Deliberately permissive: real addresses are stranger than most regexes
 * allow, and rejecting a valid address is worse than letting the provider
 * reject an invalid one — the provider's rejection becomes a BOUNCED event
 * with a reason, which is exactly the record we want. */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 320) return false;
  if (/\s/.test(trimmed)) return false;
  const at = trimmed.indexOf("@");
  if (at < 1 || at !== trimmed.lastIndexOf("@")) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

type ResendResponse = { id?: string; message?: string; name?: string };

/** Sends one email. Never throws — every failure comes back as a result the
 * caller can record as a FAILED event with a reason. A thrown error here
 * would be redacted in production and the log would say nothing.
 *
 * ── `fetcher` IS A TEST SEAM AND IT IS WHY THIS FILE HAS TESTS AT ALL ──
 *
 * This module had none. Not a thin set — none: `find packages/integrations
 * -name "*test*"` was empty, so the provider call, the non-OK branch, the
 * missing-id branch and the attachment encoding were only ever reached by
 * suites that MOCK this whole module away, which proves the callers and says
 * nothing about what is actually sent. The twin in `apps/lien-waiver/lib/
 * email.ts` takes the same parameter and is tested, so the shape is this
 * repo's own rather than an import.
 *
 * It defaults to the real `fetch`, so no caller changes and nothing in
 * production goes through a different path than the one under test. */
export async function sendEmail(
  request: EmailSendRequest,
  fetcher: typeof fetch = fetch,
): Promise<EmailSendResult> {
  const config = readEmailConfig();
  if (!config) {
    return {
      ok: false,
      error: emailSetupProblem() ?? "Email sending isn't set up yet.",
      configured: false,
    };
  }

  if (!looksLikeEmail(request.to)) {
    return { ok: false, error: `"${request.to}" doesn't look like an email address`, configured: true };
  }

  const from = request.from?.trim() || config.from;
  const to = request.toName ? `${request.toName} <${request.to}>` : request.to;

  // NORMALISED TO UNDEFINED WHEN THERE ARE NONE, so a message with no files
  // serialises exactly the body this app has always sent. An empty array would
  // still emit an `attachments` key, which is a change to every RFI and digest
  // for the sake of a feature they do not use.
  const attachments = request.attachments?.length
    ? request.attachments.map((attachment) => ({
        filename: attachment.filename,
        content: attachment.content.toString("base64"),
      }))
    : undefined;

  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: request.subject,
        text: request.text,
        attachments,
      }),
    });
  } catch (err) {
    // Network-level failure. The message never reached the provider, so
    // there will be no webhook and no provider id — this is the only way
    // the log ever learns about it.
    return {
      ok: false,
      error: `Couldn't reach the email provider: ${err instanceof Error ? err.message : "unknown error"}`,
      configured: true,
    };
  }

  let body: ResendResponse = {};
  try {
    body = (await response.json()) as ResendResponse;
  } catch {
    // Ignored — a non-JSON body is handled by the status check below.
  }

  if (!response.ok) {
    return {
      ok: false,
      error: body.message ?? `Email provider refused it (HTTP ${response.status})`,
      configured: true,
    };
  }
  if (!body.id) {
    // Accepted but unidentifiable. Every later webhook joins on this id, so
    // without it the message could never be reconciled — better to record
    // the failure than to log a message we can never learn anything about.
    // The provider ACCEPTED this. The mail has almost certainly gone; we
    // just have no id to match a delivery webhook against. Reporting it as
    // a plain failure is how a user resends and a GC gets two copies, so
    // the caller is told it may have sent.
    return {
      ok: false,
      error: "The provider accepted this but returned no message id, so delivery can't be tracked for it",
      configured: true,
      mayHaveSent: true,
    };
  }

  return { ok: true, providerMessageId: body.id, from };
}

/** Maps a provider event name onto our own vocabulary.
 *
 * Unknown names return null and the event is dropped rather than guessed
 * at — inventing a status from a name we don't recognise is how a log
 * starts lying. */
export type OutboundEventType =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED"
  | "OPENED";

export function mapResendEventType(name: string): OutboundEventType | null {
  switch (name) {
    case "email.sent":
      return "SENT";
    case "email.delivered":
      return "DELIVERED";
    case "email.bounced":
      return "BOUNCED";
    case "email.complained":
      return "COMPLAINED";
    case "email.opened":
      return "OPENED";
    case "email.delivery_delayed":
      return "QUEUED";
    default:
      return null;
  }
}
