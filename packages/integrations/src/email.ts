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

export type EmailSendRequest = {
  to: string;
  toName?: string | null;
  subject: string;
  /** Plain text. Deliberately not HTML: a construction RFI is text, and
   * HTML mail is measurably more likely to be filtered. */
  text: string;
  /** Overrides the configured default. Recorded per message by the caller. */
  from?: string;
};

export type EmailSendResult =
  | { ok: true; providerMessageId: string; from: string }
  | { ok: false; error: string; configured: boolean };

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
 * would be redacted in production and the log would say nothing. */
export async function sendEmail(request: EmailSendRequest): Promise<EmailSendResult> {
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

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject: request.subject, text: request.text }),
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
    return { ok: false, error: "Email provider accepted it but returned no message id", configured: true };
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
