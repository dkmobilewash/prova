import { afterEach, describe, expect, it, vi } from "vitest";
import { type LeadSearch } from "@prova/integrations";
import { HAIKU_4_5, modelFor } from "@prova/integrations/src/models";
import { boundLeadFinder } from "./leadFinder";

/** The model THIS feature resolves to, not Ask's. They are the same id today
 *  and the distinction is the point: writing `ASK_DEFAULT_MODEL` here would
 *  keep passing after somebody moved lead search to a cheaper model, which is
 *  exactly the change `models.ts` exists to make possible. */
const LEAD_SEARCH_MODEL = modelFor("LEAD_SEARCH").model;

// The per-company AI switch reads one row before the search runs
// (lib/ai/settings.ts). This one is settable per test rather than fixed at
// `null`, because the switch's own refusal is asserted below: `aiGate` fails
// CLOSED, so a finder that could not read the row must refuse rather than
// search, and that is a behaviour worth pinning where the search lives.
let aiSettingsRow: { aiEnabled: boolean; disabledFeatures: string[]; planSheetsPerMonth: number; modelOverride: string | null } | null = null;
vi.mock("@prova/db", () => ({
  prisma: { companyAiSettings: { findUnique: async () => aiSettingsRow } },
}));

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
      model: LEAD_SEARCH_MODEL,
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
    expect(d.findLeads).toHaveBeenCalledWith({ ...input, maxSearches: 3, model: LEAD_SEARCH_MODEL });
    // `model` joined the list in step 0 and is NOT a loosening of this test.
    // What the test is for is that nothing ABOUT THE COMPANY leaves — the two
    // fields stapled on above, `companyName` and `medianJobValue`, are still
    // absent, which is the assertion that matters. A model id is our own
    // routing decision and says nothing about the contractor.
    expect(Object.keys(d.findLeads.mock.calls[0][0]).sort()).toEqual(["bidsAfter", "maxSearches", "model", "publicWorkOnly", "region", "sizeBand", "trades"]);
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

  /**
   * THE PER-COMPANY AI SWITCH, asserted where the money would be spent.
   *
   * Both cases check the same thing twice over, because a switch that refuses
   * on screen and searches anyway is worse than no switch: `findLeads` must
   * not be called AT ALL, and no usage row may be written. The sentence is
   * carried on `off` rather than mapped from a code, so the wording stays in
   * `lib/ai/settings.ts` — see the `LeadFinder` type in commands.ts.
   */
  describe("the per-company AI switch", () => {
    afterEach(() => {
      aiSettingsRow = null;
      vi.restoreAllMocks();
    });

    it("refuses without searching when the company has AI off altogether", async () => {
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      aiSettingsRow = { aiEnabled: false, disabledFeatures: [], planSheetsPerMonth: 1500, modelOverride: null };
      const d = deps({ ok: true, leads: [], searches: 3, usage });
      const result = await boundLeadFinder(actor, d)(input);
      expect(result).toEqual({
        ok: false,
        reason: "off",
        sentence: expect.stringContaining("AI is switched off for your company"),
      });
      expect(d.findLeads).not.toHaveBeenCalled();
      expect(d.recordAskUsage).not.toHaveBeenCalled();
      // `off` in the log line, never `unavailable` — a company that switched
      // this off itself must not read as an outage in our own logs.
      expect(log).toHaveBeenCalledWith("[ask] lead search", { companyId: "co-1", ok: false, reason: "off" });
    });

    it("refuses without searching when only lead search is off", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      aiSettingsRow = { aiEnabled: true, disabledFeatures: ["LEAD_SEARCH"], planSheetsPerMonth: 1500, modelOverride: null };
      const d = deps({ ok: true, leads: [], searches: 3, usage });
      const result = await boundLeadFinder(actor, d)(input);
      // The feature's own label, not the raw enum key: `DRAFT_ESTIMATE_LINES`
      // in a sentence reads to a person like a bug.
      expect(result).toEqual({
        ok: false,
        reason: "off",
        sentence: expect.stringContaining("Lead search is switched off"),
      });
      expect(d.findLeads).not.toHaveBeenCalled();
      expect(d.recordAskUsage).not.toHaveBeenCalled();
    });

    it("searches when a DIFFERENT feature is the one switched off", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      aiSettingsRow = { aiEnabled: true, disabledFeatures: ["COMPLIANCE_EXTRACT"], planSheetsPerMonth: 1500, modelOverride: null };
      const d = deps({ ok: true, leads: [], searches: 1, usage });
      expect(await boundLeadFinder(actor, d)(input)).toEqual({ ok: true, leads: [] });
      expect(d.findLeads).toHaveBeenCalledTimes(1);
    });

    it("routes through a company's model override", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      aiSettingsRow = { aiEnabled: true, disabledFeatures: [], planSheetsPerMonth: 1500, modelOverride: HAIKU_4_5 };
      const d = deps({ ok: true, leads: [], searches: 1, usage });
      await boundLeadFinder(actor, d)(input);
      expect(d.findLeads).toHaveBeenCalledWith(expect.objectContaining({ model: HAIKU_4_5 }));
      // And the row records what actually ran, not the feature default —
      // otherwise a company on a cheap model is billed at the dear one's rate
      // the moment anybody prices this column.
      expect(d.recordAskUsage).toHaveBeenCalledWith(expect.objectContaining({ model: HAIKU_4_5 }));
    });
  });
});
