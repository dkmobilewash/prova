/**
 * Outbound email for the tool, straight to Resend's HTTP API.
 *
 * Its own few lines rather than C-Stream's `packages/integrations/src/
 * email.ts`, because this app shares nothing with C-Stream at runtime --
 * and because it needs ATTACHMENTS, which that module deliberately does
 * not send. Plain text, like C-Stream's: a waiver email is a sentence and a
 * file, and HTML mail is filtered more.
 *
 * PREVIEWS EMAIL NOBODY BUT THE ALLOWLIST. Diego, 2026-10-08: no email to
 * anyone but diego@cstream.ai without his confirmation. So outside Vercel
 * production every recipient must be in EMAIL_ALLOWLIST (default exactly
 * that address); anyone else is SKIPPED, reported as skipped, and the flow
 * carries on so a preview can still be clicked end to end. Production has
 * no allowlist, and is not deployed.
 */

export const DEFAULT_ALLOWLIST = "diego@cstream.ai";

export interface Attachment {
  filename: string;
  content: Uint8Array;
}

export type SendResult =
  | { status: "sent"; id: string }
  | { status: "skipped-preview" }
  | { status: "not-configured" }
  | { status: "rejected"; error: string }
  | { status: "failed"; error: string };

export interface EmailEnv {
  RESEND_API_KEY?: string;
  LIEN_TOOL_EMAIL_FROM?: string;
  EMAIL_ALLOWLIST?: string;
  VERCEL_ENV?: string;
}

/**
 * Did this send or sign-up put the address somewhere Diego can find it?
 *
 * A skipped preview send counts, because the allowlist skipping it is the
 * point. "Not configured" counts only outside production, so a preview
 * without a Resend key can still be clicked end to end. In production a
 * missing key is a lead lost.
 */
export function landed(result: SendResult, env: EmailEnv): boolean {
  if (result.status === "sent" || result.status === "skipped-preview") return true;
  return result.status === "not-configured" && env.VERCEL_ENV !== "production";
}

/** A send that THROWS (a network error, a DNS failure) becomes a "failed"
 * result rather than an exception, so a caller cannot drop it with a bare
 * `.catch(() => null)` -- which is how a lead used to vanish with no log. */
export async function settle(attempt: Promise<SendResult>): Promise<SendResult> {
  try {
    return await attempt;
  } catch (error) {
    return { status: "failed", error: error instanceof Error ? error.message : String(error) };
  }
}

/** One log line for a send that did not land, naming WHAT failed and why
 * but never the address: a runtime log is not where a lead's email goes. */
export function reportUnlanded(
  what: string,
  result: SendResult,
  env: EmailEnv,
  log: (line: string) => void = console.error,
): void {
  if (landed(result, env)) return;
  log(`[lien-waiver] ${what} did not go out: ${result.status}${"error" in result ? ` (${result.error})` : ""}`);
}

export function allowed(to: string, env: EmailEnv): boolean {
  if (env.VERCEL_ENV === "production") return true;
  const list = (env.EMAIL_ALLOWLIST ?? DEFAULT_ALLOWLIST)
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(to.trim().toLowerCase());
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value.trim());
}

export async function sendEmail(
  message: { to: string; subject: string; text: string; attachments?: Attachment[]; replyTo?: string },
  env: EmailEnv = process.env as EmailEnv,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  if (!allowed(message.to, env)) return { status: "skipped-preview" };
  const key = env.RESEND_API_KEY?.trim();
  const from = env.LIEN_TOOL_EMAIL_FROM?.trim();
  if (!key || !from) return { status: "not-configured" };
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      reply_to: message.replyTo,
      attachments: message.attachments?.map((attachment) => ({
        filename: attachment.filename,
        content: Buffer.from(attachment.content).toString("base64"),
      })),
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
  if (response.ok && body.id) return { status: "sent", id: body.id };
  // Resend answers 422 for an address it will not send to; that is the
  // person's typo, not our outage, and the page says so.
  if (response.status === 422) return { status: "rejected", error: body.message ?? "address rejected" };
  return { status: "failed", error: `${response.status} ${body.name ?? ""} ${body.message ?? ""}`.trim() };
}

/** Add a person to the tool's Resend audience. `unsubscribed` is true
 * unless they ticked the marketing box -- the transactional email they
 * asked for is not consent to anything else. Same allowlist as sending. */
export async function addContact(
  contact: { email: string; name: string; marketingOptIn: boolean },
  env: EmailEnv & { RESEND_AUDIENCE_ID?: string } = process.env as EmailEnv,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  if (!allowed(contact.email, env)) return { status: "skipped-preview" };
  const key = env.RESEND_API_KEY?.trim();
  const audience = env.RESEND_AUDIENCE_ID?.trim();
  if (!key || !audience) return { status: "not-configured" };
  const [first, ...rest] = contact.name.trim().split(/\s+/);
  const response = await fetcher(`https://api.resend.com/audiences/${encodeURIComponent(audience)}/contacts`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: contact.email.trim(),
      first_name: first ?? "",
      last_name: rest.join(" "),
      unsubscribed: !contact.marketingOptIn,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (response.ok) return { status: "sent", id: body.id ?? "" };
  return { status: "failed", error: `${response.status} ${body.message ?? ""}`.trim() };
}
