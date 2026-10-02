"use server";

import {
  CITY_PATTERN,
  LEAD_SIZE_BANDS,
  LEAD_TRADES,
  US_STATE_CODES,
  type FoundLead,
  type LeadSizeBand,
  type LeadTrade,
} from "@prova/integrations";
import { requireCompanyContext } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { boundLeadFinder } from "@/lib/ask/leadFinder";
import { viewerToday } from "@/lib/viewerToday";
import type { ActionResultWith } from "@/lib/actions/shared";

/**
 * FIND PUBLIC PROJECTS OUT TO BID, FROM /pipeline.
 *
 * `LEAD_SEARCH` shipped gated, metered and model-routed and had no control
 * anywhere: it ran inside the `find_bid_leads` Ask command and nowhere else, so
 * using it meant knowing to type a sentence at the assistant. An audit of the
 * estimating lane on 2026-10-01 put it at 2 of 4 — no UI, no eval. This is the
 * UI half.
 *
 * ── IT REUSES `boundLeadFinder` RATHER THAN REBUILDING THE PASS ──
 *
 * That module already does the gate, the usage row and the log line, and its own
 * header says why it is a module rather than a closure: so the ACCOUNTING can be
 * tested. A second copy here would be a second place for the `feature:
 * "lead-search"` row to be forgotten, and `leadFinder.ts`'s comment about the
 * cost case for scheduling this later resting on those rows existing is exactly
 * the thing a duplicate quietly breaks.
 *
 * So this action is input validation plus a call. Everything about spend,
 * switching off, and what reaches `AskUsage` is unchanged and shared with Ask.
 *
 * ── THE PRIVACY BOUNDARY IS A TYPE, AND THIS ACTION MUST NOT WIDEN IT ──
 *
 * `leads.ts` states it at length: `LeadSearchInput` can carry the five trades as
 * the ENUM, a city matching `CITY_PATTERN`, a two-letter state code, a size
 * BAND, a public-work flag and an ISO day — and `leadQueryTurn` renders the whole
 * outgoing turn from a fixed template, refusing anything that does not fit. That
 * is a stronger boundary than the project look-up's two typed strings, and the
 * reason it is stronger is that none of these fields can carry free text at all.
 *
 * This action therefore parses into those types and never passes a string
 * through. A city with a digit in it is refused HERE with a sentence, rather than
 * sent and refused there as `invalid` — same outcome, better message. It must
 * never grow a "notes" or "keywords" field: that would be a free-text hole in a
 * boundary whose whole strength is that it has none.
 *
 * `bidsAfter` comes from `viewerToday()` on the server and is never taken from
 * the form. A browser-supplied "today" is a browser-supplied filter, and the
 * calendar this app judges bid dates on is the viewer's own.
 *
 * ── IT WRITES NOTHING ──
 *
 * Leads are returned, not stored. A search nobody acts on leaves no row, which
 * is right for a list of other people's projects. Tracking one opens the ordinary
 * pursuit form and the write goes through `createBidPursuit`.
 */

const NOT_YOURS =
  "Estimating isn't part of your job function. The account owner sets who sees what, on the Team page.";

export type LeadSearchFound = { leads: FoundLead[] };

function tradesFrom(formData: FormData): LeadTrade[] {
  const raw = formData.getAll("trades").filter((value): value is string => typeof value === "string");
  // Membership, not a cast: an unknown trade is dropped rather than sent.
  return LEAD_TRADES.filter((trade) => raw.includes(trade));
}

function sizeBandFrom(formData: FormData): LeadSizeBand | undefined {
  const raw = formData.get("sizeBand");
  return LEAD_SIZE_BANDS.find((band) => band === raw);
}

export async function searchBidLeads(formData: FormData): Promise<ActionResultWith<LeadSearchFound>> {
  const context = await requireCompanyContext();
  if (!can(context, "MANAGE_ESTIMATING")) return { ok: false, error: NOT_YOURS };

  const trades = tradesFrom(formData);
  if (trades.length === 0) {
    return { ok: false, error: "Pick at least one trade to search for." };
  }

  const city = typeof formData.get("city") === "string" ? String(formData.get("city")).trim() : "";
  const state = typeof formData.get("state") === "string" ? String(formData.get("state")).trim().toUpperCase() : "";
  // REFUSED HERE WITH A SENTENCE rather than sent and rejected as `invalid`.
  // The pattern is `leads.ts`'s own export, so this check cannot drift from the
  // one that actually guards the outgoing turn.
  if (!CITY_PATTERN.test(city)) {
    return {
      ok: false,
      error: "Give a city as letters only — no numbers, commas or quotes. The state goes in its own box.",
    };
  }
  if (!US_STATE_CODES.has(state)) {
    return { ok: false, error: "Give the state as a two-letter code, like NV." };
  }

  const finder = boundLeadFinder({ companyId: context.company.id, userId: context.id });
  const result = await finder({
    trades,
    region: { city, state },
    sizeBand: sizeBandFrom(formData),
    publicWorkOnly: formData.get("publicWorkOnly") === "on" ? true : undefined,
    // The SERVER'S idea of the viewer's today, never the form's.
    bidsAfter: await viewerToday(),
  });

  if (!result.ok) {
    // `off` carries its own sentence, and it is the only one that does — it
    // names who can switch the feature back on, and that wording lives in
    // `lib/ai/settings.ts` so it reads the same everywhere it appears.
    if (result.reason === "off") {
      return { ok: false, error: result.sentence ?? "Lead search is switched off for this company." };
    }
    return {
      ok: false,
      error:
        result.reason === "unavailable"
          ? "Web search isn't available for this workspace, so there is nothing to look through."
          : result.reason === "invalid"
            ? "That search couldn't be built from those answers. Check the city and state."
            : "The search couldn't be completed. Try again in a moment.",
    };
  }

  return { ok: true, value: { leads: result.leads } };
}
