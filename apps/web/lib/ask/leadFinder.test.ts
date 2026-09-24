import { describe, expect, it, vi } from "vitest";
import { ASK_DEFAULT_MODEL, type LeadSearch } from "@prova/integrations";
import { boundLeadFinder } from "./leadFinder";

/**
 * Metering for a lead pass. Pinned because it is where money leaks:
 * every pass that reached the model lands in AskUsage under
 * `feature: "lead-search"` with the search count on the totals — the
 * rows the spec's cost table is to be replaced from — and NEVER under
 * "ask", which is the feature `askAllowance` counts a person's hourly
 * questions from. And the finder forwards exactly the five typed fields
 * plus the search cap, nothing a caller stapled on.
 */
const usage = { passes: 3, inputTokens: 61_000, outputTokens: 2_900, cacheReadTokens: 0, cacheWriteTokens: 0, webSearches: 3 };
const actor = { companyId: "co-1", userId: "u-1" };
const input = {
  trades: ["EIFS" as const],
  region: { city: "Long Beach", state: "CA", radiusMiles: 40 },
  sizeBand: undefined,
  publicWorkOnly: true,
  bidsAfter: "2026-09-24",
};

function deps(result: LeadSearch) {
  return { findLeads: vi.fn().mockResolvedValue(result), recordAskUsage: vi.fn().mockResolvedValue(undefined) };
}

describe("boundLeadFinder", () => {
  it("records a pass under lead-search with the search count, never under ask", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps({ ok: true, leads: [], searches: 3, usage });
    const result = await boundLeadFinder(actor, d)(input);
    expect(result).toEqual({ ok: true, leads: [] });
    expect(d.recordAskUsage).toHaveBeenCalledTimes(1);
    expect(d.recordAskUsage).toHaveBeenCalledWith({
      companyId: "co-1",
      userId: "u-1",
      model: ASK_DEFAULT_MODEL,
      usage,
      outcome: "answered",
      feature: "lead-search",
    });
    for (const call of d.recordAskUsage.mock.calls) expect(call[0].feature).not.toBe("ask");
    expect(d.recordAskUsage.mock.calls[0][0].usage.webSearches).toBe(3);
    // Ids and counts in the log line, never the query.
    expect(log).toHaveBeenCalledWith("[ask] lead search", { companyId: "co-1", ok: true, reason: null, searches: 3, leads: 0 });
    log.mockRestore();
  });

  it("forwards exactly the five typed fields plus the search cap — nothing stapled onto the input", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const d = deps({ ok: true, leads: [], searches: 0, usage: { ...usage, passes: 1 } });
    await boundLeadFinder(actor, d)({ ...input, companyName: "Acme Drywall", medianJobValue: 415000 } as never);
    expect(d.findLeads).toHaveBeenCalledWith({ ...input, maxSearches: 3 });
    expect(Object.keys(d.findLeads.mock.calls[0][0]).sort()).toEqual(["bidsAfter", "maxSearches", "publicWorkOnly", "region", "sizeBand", "trades"]);
    vi.restoreAllMocks();
  });

  it("records a failed pass with its reason, and records nothing for a pass that never reached the model", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const failed = deps({ ok: false, reason: "unavailable", searches: 0, usage: { ...usage, passes: 1 } });
    expect(await boundLeadFinder(actor, failed)(input)).toEqual({ ok: false, reason: "unavailable" });
    expect(failed.recordAskUsage).toHaveBeenCalledWith(expect.objectContaining({ outcome: "error:unavailable", feature: "lead-search" }));

    const invalid = deps({ ok: false, reason: "invalid", searches: 0, usage: { ...usage, passes: 0, inputTokens: 0, outputTokens: 0, webSearches: 0 } });
    expect(await boundLeadFinder(actor, invalid)(input)).toEqual({ ok: false, reason: "invalid" });
    expect(invalid.recordAskUsage).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
