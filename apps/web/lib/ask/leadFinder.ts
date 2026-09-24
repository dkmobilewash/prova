import {
  ASK_DEFAULT_MODEL,
  findLeads as liveFindLeads,
  LEAD_MAX_SEARCHES,
  type LeadSearch,
  type LeadSearchInput,
} from "@prova/integrations";
import { recordAskUsage as liveRecordAskUsage, type AskUsageRecord } from "./usage";
import type { LeadFinder } from "./commands";

/**
 * The lead finder the Ask loop hands a command, bound to one company for
 * usage accounting.
 *
 * Its own module rather than a closure inside answer.ts (which is where
 * `BidResearcher` is bound) so that the accounting can be TESTED: every
 * pass lands in AskUsage under `feature: "lead-search"`, with the search
 * count on the totals, and never under "ask" — a pass must not cost a
 * person one of their hourly questions, and the whole cost case for
 * scheduling this later rests on these rows existing now. The two live
 * dependencies are injectable for exactly that test; production callers
 * pass nothing.
 *
 * The paid monthly cap is NOT claimed here. A person is asking, so the
 * question `answer.ts` already claimed for the turn is what this is; a
 * background run would need its own unit (the spec's stage 3), and there
 * is no background run.
 */
export type LeadFinderDeps = {
  findLeads: (input: LeadSearchInput) => Promise<LeadSearch>;
  recordAskUsage: (record: AskUsageRecord) => Promise<void>;
};

export function boundLeadFinder(
  actor: { companyId: string; userId: string },
  deps?: LeadFinderDeps,
): LeadFinder {
  return async (input) => {
    // The live dependencies are looked up HERE, when a pass runs, and not
    // when this module loads: a dozen tests mock `@prova/integrations`
    // partially, and an import-time read of an export the mock left out
    // takes the whole Ask module graph down with it.
    const { findLeads, recordAskUsage } = deps ?? { findLeads: liveFindLeads, recordAskUsage: liveRecordAskUsage };
    const result = await findLeads({
      trades: input.trades,
      region: input.region,
      sizeBand: input.sizeBand,
      publicWorkOnly: input.publicWorkOnly,
      bidsAfter: input.bidsAfter,
      maxSearches: LEAD_MAX_SEARCHES,
    });
    // Ids and counts only; never the query, never a lead.
    console.log("[ask] lead search", {
      companyId: actor.companyId,
      ok: result.ok,
      reason: result.ok ? null : result.reason,
      searches: result.searches,
      leads: result.ok ? result.leads.length : 0,
    });
    if (result.usage.passes > 0) {
      await recordAskUsage({
        companyId: actor.companyId,
        userId: actor.userId,
        model: ASK_DEFAULT_MODEL,
        usage: result.usage,
        outcome: result.ok ? "answered" : `error:${result.reason}`,
        feature: "lead-search",
      });
    }
    if (!result.ok) return { ok: false, reason: result.reason };
    return { ok: true, leads: result.leads };
  };
}
