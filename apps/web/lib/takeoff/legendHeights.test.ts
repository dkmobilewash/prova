import { describe, expect, it, vi } from "vitest";

// The plan and its facts, counted: a second type within minutes must not read the set again.
const { readPlanBytes, setHeightFacts } = vi.hoisted(() => ({
  readPlanBytes: vi.fn(async () => ({ ok: true as const, bytes: Buffer.from("%PDF") })),
  setHeightFacts: vi.fn(async () => ({ facts: [], generalNote: null, factSheets: [], levels: [] })),
}));
vi.mock("@/lib/plan-ingest/planBytes", () => ({ readPlanBytes }));
vi.mock("@/lib/plan-ingest/planPdf", async (actual) => ({ ...(await actual<object>()), openPlanPdf: async () => ({ close: async () => {} }) }));
vi.mock("./levelReads", () => ({ storeLevelMarks: async () => {}, storeGeneralHeight: async () => {} }));
vi.mock("./setHeightFacts", async (actual) => ({ ...(await actual<object>()), setHeightFacts }));
const { legendHeightsFor } = await import("./legendHeights");

describe("legendHeightsFor", () => {
  it("READS THE SET'S HEIGHT FACTS ONCE for one plan's legend, not once per type (Accept all on Topeka: 3.4 s per new code)", async () => {
    const type = (code: string) => ({ code, lines: [], heightNote: null });
    await legendHeightsFor({ planId: "plan_a", companyId: "c", legendPage: 9, types: [type("P13")] });
    await legendHeightsFor({ planId: "plan_a", companyId: "c", legendPage: 9, types: [type("P14")] });
    await legendHeightsFor({ planId: "plan_a", companyId: "c", legendPage: 9, types: [type("P30")] });
    expect(readPlanBytes).toHaveBeenCalledTimes(1);
    expect(setHeightFacts).toHaveBeenCalledTimes(1);
    // Another plan, or another legend page, is read on its own.
    await legendHeightsFor({ planId: "plan_b", companyId: "c", legendPage: 9, types: [type("P13")] });
    await legendHeightsFor({ planId: "plan_a", companyId: "c", legendPage: 2, types: [type("P13")] });
    expect(readPlanBytes).toHaveBeenCalledTimes(3);
  });

  it("a read that failed is not kept: the next type tries again", async () => {
    readPlanBytes.mockClear();
    readPlanBytes.mockResolvedValueOnce({ ok: false, error: "The plan file couldn't be fetched just now." } as never);
    await legendHeightsFor({ planId: "plan_c", companyId: "c", legendPage: 9, types: [{ code: "W1", lines: [], heightNote: null }] });
    await legendHeightsFor({ planId: "plan_c", companyId: "c", legendPage: 9, types: [{ code: "W2", lines: [], heightNote: null }] });
    expect(readPlanBytes).toHaveBeenCalledTimes(2);
  });
});
