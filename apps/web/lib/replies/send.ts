import { SMARTLEAD_API } from "@/lib/smartlead/push";

/**
 * SEND ONE ANSWER INTO THE PROSPECT'S THREAD, through Smartlead, so it leaves
 * from the same mailbox the cold email did and lands as a reply rather than
 * a new message.
 *
 * ── THE ENDPOINT, AS DOCUMENTED (read 2026-10-15) ──
 *
 * `POST /campaigns/{campaign_id}/reply-email-thread?api_key=…` with
 * `{ email_stats_id, email_body, reply_message_id?, to_email? }`. The
 * reference says `email_stats_id` is "the email stats ID for the message to
 * reply to" and does not say where to get it; the webhook pages disagree on
 * what they carry (`stats_id` on one, `reply.message_id` on another, and the
 * EMAIL_REPLY reference this repo was first written against has since moved).
 * So `threadIds` reads every spelling, and a payload with NONE of them is a
 * reply nobody can answer through the API — the caller queues it for a
 * person, who answers from the inbox. Guessing an id would post into
 * somebody's thread at random.
 *
 * ── IDEMPOTENT ON `smartleadMessageId` ──
 *
 * A reply whose row already carries a message id is not sent again, whatever
 * else is asked. The id is whatever the vendor returned, or a sentinel naming
 * our own row when it returned none — a sent message with no vendor id is
 * still sent. ponytail: two approvals in the same second can both pass the
 * check before either writes; the page's one-tap button is the only caller
 * and it disables itself in flight. A claim-update is the upgrade if a second
 * caller ever appears.
 */

export type ThreadIds = { emailStatsId: string | null; messageId: string | null };

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null;

export function threadIds(payload: Record<string, unknown>): ThreadIds {
  const reply = payload.reply && typeof payload.reply === "object" ? (payload.reply as Record<string, unknown>) : {};
  const emailStatsId = str(payload.email_stats_id) ?? str(payload.stats_id) ?? str(reply.stats_id);
  const messageId = str(payload.reply_message_id) ?? str(reply.message_id) ?? str(payload.message_id);
  return { emailStatsId, messageId };
}

export type SendInput = {
  reply: { id: string; fromEmail: string; draft: string | null; smartleadMessageId: string | null };
  ids: ThreadIds;
  campaignId: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
};

export type SendOutcome =
  | { ok: true; messageId: string; alreadySent: boolean }
  | { ok: false; error: string };

export async function sendReply(input: SendInput): Promise<SendOutcome> {
  const { reply, ids } = input;
  if (reply.smartleadMessageId) return { ok: true, messageId: reply.smartleadMessageId, alreadySent: true };
  if (!reply.draft?.trim()) return { ok: false, error: "Nothing to send: the draft is empty." };
  if (!ids.emailStatsId && !ids.messageId) return { ok: false, error: "No thread id on the reply event — answer it from the inbox." };

  const doFetch = input.fetchImpl ?? fetch;
  const url = `${SMARTLEAD_API}/campaigns/${encodeURIComponent(input.campaignId)}/reply-email-thread?api_key=${encodeURIComponent(input.apiKey)}`;
  let response: Response;
  try {
    response = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email_stats_id: ids.emailStatsId ?? ids.messageId,
        ...(ids.messageId ? { reply_message_id: ids.messageId } : {}),
        email_body: reply.draft.replace(/\n/g, "<br>"),
        to_email: reply.fromEmail,
        add_signature: false,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return { ok: false, error: "Could not reach Smartlead. Nothing was sent." };
  }
  const text = await response.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
  } catch {
    // Reported below as text.
  }
  if (!response.ok || body.success === false) {
    const said = (typeof body.message === "string" ? body.message : text).replace(/\s+/g, " ").trim().slice(0, 200);
    return { ok: false, error: `Smartlead answered ${response.status}${said ? ` ("${said}")` : ""}. Nothing was sent.` };
  }
  const messageId = str(body.message_id) ?? str(body.id) ?? `sent:${reply.id}`;
  return { ok: true, messageId, alreadySent: false };
}
