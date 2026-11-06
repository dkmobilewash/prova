/**
 * THE LEGEND READ STORES THE SET'S SHEET-WIDE HEIGHT WHEN IT SAVES ITS PROPOSAL.
 *
 * Walk v6 on Baker, a fresh company: the queue's first screen offered the
 * ceiling plan's 10'-0" on every drawn group, because the "all walls to deck"
 * height (15'-0") was stored only by `legendHeightsFor`, which nothing ran
 * until Accept all added the legend's types. Accept all wrote 10'. The real
 * deps' `saveProposal` now runs it, so the height is there before the queue.
 *
 * Read from the source, comments stripped, per `readingPanelExcludes.test.ts`:
 * the real deps talk to Postgres and a plan file, which no unit test here has.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const source = strip(readFileSync(new URL("./wallLegend.ts", import.meta.url).pathname, "utf8"));

describe("the wall-legend stage's real deps", () => {
  it("store the set's heights after the proposal is upserted", () => {
    const save = source.slice(source.indexOf("saveProposal: async"));
    expect(save.indexOf("planLegendProposal.upsert"), "saveProposal no longer upserts the proposal").toBeGreaterThan(-1);
    const call = save.indexOf("legendHeightsFor(");
    expect(call, "saveProposal does not store the set's sheet-wide height").toBeGreaterThan(save.indexOf("planLegendProposal.upsert"));
    expect(save.slice(call, call + 200)).toMatch(/companyId: row\.companyId/);
  });
});
