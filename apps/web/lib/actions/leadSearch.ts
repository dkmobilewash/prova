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
// THE ASK COMMAND'S OWN JUDGING, imported rather than reimplemented. Three of
// these four were already exported and one was private; a second copy of any of
// them is how the two controls start disagreeing.
import { knownRecords, placeAgainstKnown, pursuitNoteFor } from "@/lib/ask/commands/leads";
import { bidDayFor } from "@/lib/leads/bidDay";
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

/**
 * One lead, with everything the screen needs already decided HERE.
 *
 * ── WHY THE SERVER DECIDES ALL OF IT, AND NOT THE COMPONENT ──
 *
 * The judging helpers live in `lib/ask/commands/leads.ts`, which imports
 * `prisma` — so a client component cannot import them without dragging the
 * database client into the browser, which `client-boundary.test.ts` exists to
 * refuse. Computing the placement, the note and the parsed day here means the
 * panel renders plain data and needs no new imports at all.
 *
 * ── AND WHY THESE THREE FIELDS EXIST, WHICH IS THE HONEST PART ──
 *
 * The first version of this action returned `{ leads }` and nothing else. A
 * browser run on 2026-10-02 found all three gaps, none of which any test here
 * could see, and each was a thing the Ask command had been doing all along:
 *
 *   `already`  — `placeAgainstKnown` tells you a lead is already on the
 *                pipeline, a job or a bid, by URL, by name and fuzzily. Without
 *                it the panel offered "Track this as a pursuit" on a lead that
 *                was already tracked, and `createBidPursuit` has no
 *                duplicate-name guard, so that makes a real duplicate row.
 *   `note`     — `pursuitNoteFor` already existed and was already exported. A
 *                second implementation shipped in `lib/lead-search.ts` anyway,
 *                which is CLAUDE.md's "nothing is ever missing from a list
 *                nobody imports" with me as the author. It is deleted.
 *   `bidDay`   — the Ask path writes `expectedBidDate` when the page's date
 *                reads as a full calendar day, and leaves it blank otherwise.
 *                This action refused to ever write it, and argued the point at
 *                length. Two controls disagreeing about one field is worse than
 *                either answer, so this now does what Ask does, by Diego's call
 *                on 2026-10-02. The raw text still goes in the note either way,
 *                so an unparseable "late spring" is never silently dropped.
 */
export type PlacedLead = {
  lead: FoundLead;
  /** Something this company already has that looks like this lead, when the
   *  match was close but not certain. An exact match is dropped instead — see
   *  `hiddenAlreadyKnown`. */
  already: { kind: "pipeline" | "job" | "bid"; name: string; href: string } | null;
  /** What the pursuit form's note should start with. */
  note: string;
  /** ISO day, ONLY when the page's date read as a whole calendar day. */
  bidDay: string | null;
};

export type LeadSearchFound = {
  leads: PlacedLead[];
  /** Web searches this pass billed. Shown, because it is the unit the bill is
   *  counted in and the project look-up already shows it. */
  searches: number;
  /** Dropped because the company already has them, exactly. Counted rather
   *  than listed: "nothing new" is the useful sentence, not a list of things
   *  the person already owns. */
  hiddenAlreadyKnown: number;
};

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

  // The SERVER'S idea of the viewer's today, used for the search floor and
  // again below to keep a stale date out of the form.
  const today = await viewerToday();

  const finder = boundLeadFinder({ companyId: context.company.id, userId: context.id });
  const result = await finder({
    trades,
    region: { city, state },
    sizeBand: sizeBandFrom(formData),
    publicWorkOnly: formData.get("publicWorkOnly") === "on" ? true : undefined,
    // Never the form's: a browser-supplied "today" is a browser-supplied filter.
    bidsAfter: today,
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

  // THE SAME SET THE ASK COMMAND JUDGES AGAINST, from the same query, so the
  // two controls cannot disagree about what counts as "already have it".
  const known = await knownRecords(context.company.id);

  const leads: PlacedLead[] = [];
  let hiddenAlreadyKnown = 0;
  for (const lead of result.leads) {
    const placement = placeAgainstKnown(
      { projectName: lead.fields.projectName, sourceUrl: lead.source.url },
      known,
    );
    // THE HIDE/BADGE ASYMMETRY IS COPIED DELIBERATELY, not reinvented: an exact
    // match on the URL or the name is dropped, a fuzzy one is shown with a
    // badge. `placeAgainstKnown`'s own comment calls that asymmetry the part
    // worth a test, and having it one way here and another way in Ask would be
    // the second list this feature has already been caught growing.
    if (placement.hidden) {
      hiddenAlreadyKnown += 1;
      continue;
    }
    leads.push({
      lead,
      already: placement.like
        ? { kind: placement.like.kind, name: placement.like.name, href: placement.like.href }
        : null,
      note: pursuitNoteFor({
        sourceUrl: lead.source.url,
        location: lead.fields.location ?? null,
        scopeSummary: lead.fields.scopeSummary ?? null,
        sizeText: lead.fields.sizeText ?? null,
        deliveryMethod: lead.fields.deliveryMethod ?? null,
      }),
      bidDay: bidDayFor(lead.fields.bidDate, today),
    });
  }

  return { ok: true, value: { leads, searches: result.searches, hiddenAlreadyKnown } };
}
