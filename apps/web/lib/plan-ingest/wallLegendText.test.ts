import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAN_READING_UNAVAILABLE } from "@/lib/ai/providerOutage";
import { wallLegendWork, type WallLegendDeps, type WallLegendProposalRow } from "./wallLegend";
import type { PlanPdf } from "./planPdf";

/**
 * ── THE LEGEND STAGE READS THE TEXT WHEN THE MODEL CANNOT ──
 *
 * With the company's switch off, its allowance spent or the provider out of credit, a new set used
 * to get no wall types at all (0% typed on USU and Riverbend). Now the page's own text is read
 * (`legendText.ts`) and saved as the proposal, marked `model: "legend text"`; an outage still
 * reports itself, so the page retries and the model's read replaces it.
 */
const t = (str: string, x: number, y: number, h = 7) => ({ str, x, y, width: str.length * h * 0.6, height: h });
const detail = (code: string, x: number, stud: string) => [
  t("5/8\" GYPSUM BOARD, EACH SIDE", x, 300),
  t(`${stud} 20 GA. MTL. STUD FRAMING @ 16" O.C.`, x, 312),
  t("ASSEMBLY WIDTH 4 7/8\"", x, 324),
  t("SOUND ATTENUATION BATTS", x, 336),
  t(code, x + 20, 380, 10),
];
const ITEMS = [t("PARTITION TYPES", 200, 200, 14), ...detail("IW-1", 200, "3 5/8\""), ...detail("IW-2", 650, "6\""), ...detail("IW-3", 1100, "3 5/8\"")];

const pdf = {
  pageText: async () => ({ pageNumber: 4, widthPt: 2592, heightPt: 1728, rotation: 0, items: ITEMS }),
  pageStrokes: async () => ({ segments: [] }),
  close: async () => {},
} as unknown as PlanPdf;

function deps(over: Partial<WallLegendDeps>): { deps: WallLegendDeps; saved: WallLegendProposalRow[] } {
  const saved: WallLegendProposalRow[] = [];
  return {
    saved,
    deps: {
      loadPageTitle: async () => "PARTITION TYPES",
      openPdf: async () => pdf,
      gate: vi.fn(async () => ({ ok: true, model: "claude-test", settings: { planSheetsPerMonth: 100 } })) as unknown as WallLegendDeps["gate"],
      claim: vi.fn(async () => ({ ok: true, claim: { id: "c1" } })) as unknown as WallLegendDeps["claim"],
      markFailure: vi.fn(async () => {}) as unknown as WallLegendDeps["markFailure"],
      release: vi.fn(async () => {}) as unknown as WallLegendDeps["release"],
      extract: vi.fn(async () => ({ types: [{ code: "IW-1", name: null, lines: ["MODEL"] }], uno: [], reason: "model", confidence: "HIGH" })) as unknown as WallLegendDeps["extract"],
      recordUsage: vi.fn(async () => {}) as unknown as WallLegendDeps["recordUsage"],
      saveProposal: async (row) => {
        saved.push(row);
      },
      ...over,
    },
  };
}
const ctx = { planId: "p1", companyId: "co1", ingestJobId: "ij1", jobId: "j1", startedByUserId: null };
const task = { pageNumber: 4 } as Parameters<ReturnType<typeof wallLegendWork>>[0];

describe("the keyless read is OFF unless LEGEND_TEXT_READ=1", () => {
  it("the company's switch off and the env switch off: nothing is saved, the refusal stands", async () => {
    vi.stubEnv("LEGEND_TEXT_READ", "");
    const { deps: d, saved } = deps({ gate: vi.fn(async () => ({ ok: false, error: "Plan reading is off." })) as unknown as WallLegendDeps["gate"] });
    expect(await wallLegendWork(ctx, d)(task)).toEqual({ ok: false, error: "Plan reading is off." });
    expect(saved).toHaveLength(0);
    vi.unstubAllEnvs();
  });
});

describe("the legend stage with no model read (LEGEND_TEXT_READ=1)", () => {
  beforeEach(() => vi.stubEnv("LEGEND_TEXT_READ", "1"));
  afterEach(() => vi.unstubAllEnvs());
  it("the company's switch off: the page's text is the proposal, marked 'legend text', and the page is done", async () => {
    const { deps: d, saved } = deps({ gate: vi.fn(async () => ({ ok: false, error: "Plan reading is off." })) as unknown as WallLegendDeps["gate"] });
    const result = await wallLegendWork(ctx, d)(task);
    expect(result).toEqual({ ok: true });
    expect(saved).toHaveLength(1);
    expect(saved[0]!.model).toBe("legend text");
    expect(saved[0]!.read.types.map((x) => x.code)).toEqual(["IW-1", "IW-2", "IW-3"]);
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("the provider out of credit: the text is saved now and the page still retries, so the model's read replaces it", async () => {
    const outage = Object.assign(new Error("credit balance is too low"), { status: 400 });
    const { deps: d, saved } = deps({ extract: vi.fn(async () => { throw outage; }) as unknown as WallLegendDeps["extract"] });
    const result = await wallLegendWork(ctx, d)(task);
    expect(result).toEqual({ ok: false, error: PLAN_READING_UNAVAILABLE, outage: true });
    expect(d.release).toHaveBeenCalled();
    expect(saved.map((s) => s.model)).toEqual(["legend text"]);
  });

  it("the model's read, when there is one, is the proposal — the text read is not saved", async () => {
    const { deps: d, saved } = deps({});
    expect(await wallLegendWork(ctx, d)(task)).toEqual({ ok: true });
    expect(saved.map((s) => s.model)).toEqual(["claude-test"]);
  });
});
