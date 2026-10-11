/**
 * THE NIGHTLY PUSH TO SMARTLEAD — the pure half, so it is tested without a
 * database or a network.
 *
 * Smartlead is the sequencer; this decides WHO goes to it and in what shape.
 * The route (`app/api/cron/outbound-push`) and the owner's button
 * (`lib/actions/outboundPush.ts`) both go through `lib/smartlead/run.ts`,
 * which is the only thing that writes.
 *
 * ── WHAT SMARTLEAD'S DOCS ACTUALLY SAY (read 2026-10-10) ──
 *
 * `POST https://server.smartlead.ai/api/v1/campaigns/{campaign_id}/leads?api_key=…`
 * with `{ lead_list: [{ email, first_name, last_name, company_name,
 * phone_number, website, custom_fields }], settings: { ignore_global_block_list,
 * ignore_unsubscribe_list, ignore_community_bounce_list,
 * ignore_duplicate_leads_in_other_campaign } }`. Both the API reference and the
 * help centre say **400 leads per call**, not 100; this sends 100 anyway, which
 * is inside the limit and costs nothing at a 50-a-day cap.
 *
 * THE RESPONSE IS ONE MORE PLACE THEIR DOCS DISAGREE. The API reference
 * documents `{ success, message, added_count, skipped_count, skipped_leads }`;
 * the help centre documents no response at all; the shape this module was
 * first specified against (`upload_count`, `total_leads`, `block_count`,
 * `duplicate_count`, `invalid_email_count`, `unsubscribed_leads`) appears in
 * neither page read. So `countsFrom` reads both spellings, and the run stores
 * the RAW response on every PUSHED event — same rule as the webhook: the first
 * real response settles the shape, and it must not be lost to a parser that
 * guessed.
 *
 * Every `settings` flag is sent explicitly as `false`. Those are the vendor's
 * own suppression lists; a default that ever flipped to `true` would mail
 * someone who unsubscribed through Smartlead's link rather than ours.
 */

import { configuredBaseUrl } from "@/lib/notification-run";

export const SMARTLEAD_API = "https://server.smartlead.ai/api/v1";
export const SMARTLEAD_BATCH = 100;

export type PushCandidate = {
  id: string;
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  licenceNumber: string | null;
  doNotContact: boolean;
  outboundStatus: string;
};

export type PushExclusions = {
  /** Suppressed — asked to stop, by any route. Counted first: it wins. */
  doNotContact: number;
  noEmail: number;
  /** Already QUEUED, SEQUENCED, REPLIED… — in the machine or past it. */
  notNew: number;
  /** Would have gone, and the cap said not today. */
  overCap: number;
};

/** Who goes, and how many did not and why. Order of the input is kept. */
export function selectPushable<T extends PushCandidate>(
  leads: T[],
  { limit }: { limit: number },
): { pushable: T[]; excluded: PushExclusions } {
  const excluded: PushExclusions = { doNotContact: 0, noEmail: 0, notNew: 0, overCap: 0 };
  const pushable: T[] = [];
  for (const lead of leads) {
    if (lead.doNotContact) excluded.doNotContact++;
    else if (!lead.email?.trim()) excluded.noEmail++;
    else if (lead.outboundStatus !== "NEW") excluded.notNew++;
    else if (pushable.length >= limit) excluded.overCap++;
    else pushable.push(lead);
  }
  return { pushable, excluded };
}

export type SmartleadLead = {
  email: string;
  first_name: string;
  last_name: string;
  company_name: string;
  phone_number?: string;
  custom_fields: Record<string, string>;
};

/** "Maria de la Cruz" → Maria / de la Cruz. One word is a first name. */
export function splitName(name: string | null): { first: string; last: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
}

export function toSmartleadLead(lead: PushCandidate, { unsubscribeUrl }: { unsubscribeUrl: string }): SmartleadLead {
  const { first, last } = splitName(lead.contactName);
  return {
    email: lead.email!.trim(),
    first_name: first,
    last_name: last,
    company_name: lead.companyName,
    ...(lead.phone?.trim() ? { phone_number: lead.phone.trim() } : {}),
    custom_fields: {
      lead_id: lead.id,
      licence: lead.licenceNumber ?? "",
      city: lead.city ?? "",
      // The sequence copy prints this as {{unsubscribe_url}}. A lead without
      // it is never sent — see `outboundConfig` in run.ts.
      unsubscribe_url: unsubscribeUrl,
    },
  };
}

export type PushCounts = { added: number | null; skipped: number | null };

const n = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null;

/** Both documented spellings; null where the vendor said nothing. */
export function countsFrom(body: Record<string, unknown>): PushCounts {
  const added = n(body.added_count) ?? n(body.upload_count);
  const parts = [body.block_count, body.duplicate_count, body.invalid_email_count].map(n);
  const unsub = Array.isArray(body.unsubscribed_leads) ? body.unsubscribed_leads.length : n(body.unsubscribed_leads);
  const legacy = [...parts, unsub].filter((x): x is number => x !== null);
  const skipped = n(body.skipped_count) ?? (legacy.length ? legacy.reduce((a, b) => a + b, 0) : null);
  return { added, skipped };
}

export type PushedBatch<T> = { leads: T[]; counts: PushCounts; response: Record<string, unknown> };

export type PushOutcome<T> = {
  batches: PushedBatch<T>[];
  /** A sentence, or null when every batch went. Batches before it DID go. */
  error: string | null;
};

/**
 * Posts in chunks of ≤100 and STOPS at the first failure — a refusal on
 * batch 2 says nothing good about batch 3. Never throws for anything the
 * vendor or the network does; the batches that went are returned so the run
 * records exactly those and nothing else.
 */
export async function pushLeads<T extends PushCandidate>(
  client: { apiKey: string; fetch?: typeof fetch },
  campaignId: string,
  leads: T[],
  toLead: (lead: T) => SmartleadLead,
): Promise<PushOutcome<T>> {
  const doFetch = client.fetch ?? fetch;
  const batches: PushedBatch<T>[] = [];
  for (let i = 0; i < leads.length; i += SMARTLEAD_BATCH) {
    const chunk = leads.slice(i, i + SMARTLEAD_BATCH);
    const which = `leads ${i + 1}–${i + chunk.length} of ${leads.length}`;
    // The key rides in the query string because that is the vendor's only
    // documented auth. So this URL is never logged and never in an error.
    const url = `${SMARTLEAD_API}/campaigns/${encodeURIComponent(campaignId)}/leads?api_key=${encodeURIComponent(client.apiKey)}`;
    let response: Response;
    try {
      response = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          lead_list: chunk.map(toLead),
          settings: {
            ignore_global_block_list: false,
            ignore_unsubscribe_list: false,
            ignore_community_bounce_list: false,
            ignore_duplicate_leads_in_other_campaign: false,
          },
        }),
        cache: "no-store",
      });
    } catch {
      return { batches, error: `Could not reach Smartlead to send ${which}. Nothing from that batch on was sent.` };
    }
    const text = await response.text().catch(() => "");
    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
    } catch {
      // A non-JSON body is reported below as text.
    }
    if (!response.ok || body.success === false) {
      const said = (typeof body.message === "string" ? body.message : text).replace(/\s+/g, " ").trim().slice(0, 200);
      return {
        batches,
        error: `Smartlead answered ${response.status} to ${which}${said ? ` ("${said}")` : ""}. Nothing from that batch on was sent.`,
      };
    }
    batches.push({ leads: chunk, counts: countsFrom(body), response: body });
  }
  return { batches, error: null };
}

/** The four settings a send needs — see `lib/smartlead/run.ts` for why
 * the unsubscribe link's two are on the list. Pure, so the page can ask it. */
export const DEFAULT_DAILY_CAP = 50;

export type OutboundConfig =
  | { ok: true; apiKey: string; campaignId: string; tokenSecret: string; baseUrl: string; dailyCap: number }
  | { ok: false; missing: string[] };

export function outboundConfig(env: Record<string, string | undefined>): OutboundConfig {
  const apiKey = env.SMARTLEAD_API_KEY?.trim();
  const campaignId = env.SMARTLEAD_CAMPAIGN_ID?.trim();
  const tokenSecret = env.OUTBOUND_TOKEN_SECRET?.trim();
  const baseUrl = configuredBaseUrl(env.NOTIFY_BASE_URL);
  const missing = [
    apiKey ? null : "SMARTLEAD_API_KEY",
    campaignId ? null : "SMARTLEAD_CAMPAIGN_ID",
    tokenSecret ? null : "OUTBOUND_TOKEN_SECRET",
    baseUrl ? null : "NOTIFY_BASE_URL",
  ].filter((x): x is string => x !== null);
  if (missing.length || !apiKey || !campaignId || !tokenSecret || !baseUrl) return { ok: false, missing };
  // Blank is the default, not zero: `Number("")` is 0, and `.env.example`
  // ships the variable blank.
  const raw = env.OUTBOUND_DAILY_CAP?.trim();
  const dailyCap = raw && /^\d+$/.test(raw) ? Number(raw) : DEFAULT_DAILY_CAP;
  return { ok: true, apiKey, campaignId, tokenSecret, baseUrl, dailyCap };
}

