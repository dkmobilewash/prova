/**
 * WHERE THE STALE-SUGGESTION REFRESH STARTS: when a legend is saved, and when
 * the queue loads (`suggestionRefresh.ts`). Both run in a request against
 * Postgres and a plan file, which no unit test has, so they are read from the
 * source, comments stripped, per `legendStoresGeneralHeight.test.ts`.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const read = (path: string) => strip(readFileSync(new URL(path, import.meta.url).pathname, "utf8"));

describe("the suggestion refresh is started", () => {
  it("by the wall-legend stage, once its proposal is saved", () => {
    const work = read("../plan-ingest/wallLegend.ts");
    const save = work.indexOf("await deps.saveProposal(");
    expect(save, "the stage no longer saves its proposal").toBeGreaterThan(-1);
    expect(work.indexOf("refreshSuggestionsAfterResponse({ planId: ctx.planId, companyId: ctx.companyId })"), "a saved legend no longer refreshes the suggestions").toBeGreaterThan(save);
  });
  it("by the review queue's load, for its plan", () => {
    expect(read("./reviewQueueQuery.ts")).toContain("refreshSuggestionsAfterResponse({ planId: plan.id, companyId })");
  });
});
