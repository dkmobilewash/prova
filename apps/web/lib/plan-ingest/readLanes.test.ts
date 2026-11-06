import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The open page's slice reads a model-bound stage on several lanes.
 * `claim.dbtest.ts` proves the lanes are safe and parallel; this proves the
 * slice the page calls actually uses them, and only for stages that spend.
 */
const source = readFileSync(new URL("../actions/planIngest.ts", import.meta.url), "utf8");

describe("advancePlanIngest's lanes", () => {
  it("runs MODEL_LANES workers on a spending stage and one on a free one", () => {
    const start = source.indexOf("export async function advancePlanIngest(");
    expect(start).toBeGreaterThan(-1);
    const body = source.slice(start, source.indexOf("\nexport ", start + 1));
    expect(body).toMatch(/runIngestLanes\(STAGE_SPENDS\[job\.stage\] \? MODEL_LANES : 1,/);
    expect(body).not.toMatch(/\brunIngest\(/);
  });
});
