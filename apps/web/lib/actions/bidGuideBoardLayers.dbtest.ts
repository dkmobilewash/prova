import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { STARTER_TYPES } from "@/lib/wall-type-starters";

/**
 * "How many layers of board are on the W2 walls?" answered with a tap, against
 * a real Postgres — through `runGuideAction`, so the REAL `updateWallType` and
 * `refreshWallSchedule` do the writing, and the facts come from the REAL
 * loader. Runs against a SCRATCH database only (vitest.db.setup.mts).
 *
 * The cast: W2 built from the starter's own parts (its board marked per layer),
 * 10 ft default height, two runs on an ESTIMATE job already on the estimate;
 * a legend-style type whose board factor already says 2 and is NOT per layer,
 * on the same job; the same company's CONTRACTED job; another company.
 */

const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const { runGuideAction } = await import("@/lib/actions/bidGuide");
const { refreshWallSchedule } = await import("@/lib/actions/wallTypes");
const { loadJobGuideFacts } = await import("@/lib/bid/guide/facts");
const { buildJobGuide } = await import("@/lib/bid/guide/buildJobGuide");

const t = `bl_${Date.now()}`;
const CODE = `W2${t}`.toUpperCase();
const LEGEND = `L1${t}`.toUpperCase();
const NOW = new Date("2026-10-26T15:00:00.000Z");
let companyId = "";
let otherCompanyId = "";
let jobId = "";
let contractedJobId = "";
let otherJobId = "";
let w2 = "";
let legend = "";

/** The chip the screen would draw, read off the real guide for the real rows. */
async function chipArg(forJob: string, label: string): Promise<string> {
  const facts = (await loadJobGuideFacts(companyId, forJob))!;
  const ask = buildJobGuide(facts, NOW).ask!;
  expect(ask.id).toBe("board-layers");
  return ask.actions.find((action) => action.label === label)!.actionArg!;
}

const layersOf = async (id: string) => (await prisma.wallType.findUniqueOrThrow({ where: { id }, select: { boardLayers: true } })).boardLayers;

/** The job's live wall lines, by the description the schedule gives them. */
async function quantities(forJob: string): Promise<Record<string, number>> {
  const lines = await prisma.jobLineItem.findMany({ where: { jobId: forJob, isDeleted: false, wallTypeComponentId: { not: null } } });
  return Object.fromEntries(lines.map((line) => [line.description.replace(`${CODE} — `, "W2 — ").replace(`${LEGEND} — `, "L1 — "), Number(line.quantity)]));
}

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `BL Co ${t}` } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: `BL Other ${t}` } })).id;
  context.company.id = companyId;
  const gc = await prisma.contact.create({ data: { companyId, name: `GC ${t}` } });
  const otherGc = await prisma.contact.create({ data: { companyId: otherCompanyId, name: `GC2 ${t}` } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: `Civic Center ${t}`, status: "ESTIMATE" } })).id;
  contractedJobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: `Signed ${t}`, status: "CONTRACTED" } })).id;
  otherJobId = (await prisma.job.create({ data: { companyId: otherCompanyId, contactId: otherGc.id, name: `Theirs ${t}`, status: "ESTIMATE" } })).id;

  const starterW2 = STARTER_TYPES.find((type) => type.code === "W2")!;
  w2 = (
    await prisma.wallType.create({
      data: {
        companyId,
        code: CODE,
        name: starterW2.name,
        sides: 2,
        studSpacingIn: 16,
        defaultHeightFt: 10,
        thicknessIn: "4.88",
        notes: "keep me",
        components: { create: starterW2.parts.map((part, sortOrder) => ({ ...part, sortOrder })) },
      },
    })
  ).id;
  // A legend-made type writes the layer count INTO the factor and marks nothing per layer.
  legend = (
    await prisma.wallType.create({
      data: {
        companyId,
        code: LEGEND,
        name: "legend wall",
        defaultHeightFt: 10,
        components: { create: [{ description: "5/8in gypsum board, 2 layers per side", unit: "SF", basis: "BOARDED_SQFT", factor: 2 }] },
      },
    })
  ).id;
  const theirs = await prisma.wallType.create({
    data: { companyId: otherCompanyId, code: CODE, name: "theirs", defaultHeightFt: 10, components: { create: [{ description: "Board", unit: "SF", basis: "BOARDED_SQFT", perLayer: true }] } },
  });

  await prisma.wallRun.createMany({
    data: [
      { companyId, jobId, wallTypeId: w2, label: "Corridor", lengthFt: 100 },
      { companyId, jobId, wallTypeId: w2, label: "Lobby", lengthFt: 50 },
      { companyId, jobId, wallTypeId: legend, label: "Shaft", lengthFt: 20 },
      { companyId, jobId: contractedJobId, wallTypeId: w2, label: "Signed run", lengthFt: 10 },
      { companyId: otherCompanyId, jobId: otherJobId, wallTypeId: theirs.id, label: "Their run", lengthFt: 70 },
    ],
  });
  // The walls are already on the estimate, priced as one layer.
  expect(await refreshWallSchedule(jobId)).toMatchObject({ ok: true });
});

afterAll(async () => {
  const jobs = [jobId, contractedJobId, otherJobId];
  await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobs } } });
  await prisma.wallRun.deleteMany({ where: { jobId: { in: jobs } } });
  await prisma.wallTypeComponent.deleteMany({ where: { wallType: { companyId: { in: [companyId, otherCompanyId] } } } });
  await prisma.wallType.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.job.deleteMany({ where: { id: { in: jobs } } });
  await prisma.contact.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await prisma.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await prisma.$disconnect();
});

beforeEach(() => {
  context.company.id = companyId;
  context.role = "OWNER";
  context.jobFunction = null;
});

describe("the facts, from real rows", () => {
  it("asks about W2 (a per-layer part, no answer) with every run's footage, and never about the legend type", async () => {
    const facts = (await loadJobGuideFacts(companyId, jobId))!;
    const byCode = Object.fromEntries(facts.wallTypes.map((type) => [type.code, type]));
    expect(byCode[CODE]!.layersUnanswered).toMatchObject({ runCount: 2, lengthFt: 150, sides: 2 });
    expect(byCode[LEGEND]!.layersUnanswered).toBeNull();
    const ask = buildJobGuide(facts, NOW).ask!;
    expect(ask.id).toBe("board-layers");
    expect(ask.body).toMatch(/^2 runs of W2BL_\d+ \(150 LF\) are counted at one layer each side until you say\./);
  });

  it("the estimate as it stands, unanswered: one layer of the starter's board", async () => {
    expect(await quantities(jobId)).toEqual({
      "W2 — 3⅝″ 20ga studs": 76 + 39,
      "W2 — 3⅝″ 20ga track, top and bottom": 300,
      // 150 LF × 10 ft × 2 sides = 3,000 sq ft; / 32 × 1.10 = 103.125 → 104
      "W2 — ⅝″ Type X board, 4x8 sheets": 104,
      "W2 — Hang, tape and finish ⅝″ board": 3000,
      "W2 — R-13 batt insulation": 1500,
      // 20 × 10 × 2 × factor 2
      "L1 — 5/8in gypsum board, 2 layers per side": 800,
    });
  });
});

describe("setBoardLayers through runGuideAction, real rows", () => {
  it("refuses a person without estimating, and writes nothing", async () => {
    const arg = await chipArg(jobId, "2 layers each side");
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect((await runGuideAction(jobId, "setBoardLayers", arg)).ok).toBe(false);
    expect(await layersOf(w2)).toBeNull();
  });

  it("refuses another company, and a contracted job", async () => {
    const arg = await chipArg(jobId, "2 layers each side");
    expect((await runGuideAction(otherJobId, "setBoardLayers", arg)).ok).toBe(false);
    context.company.id = otherCompanyId;
    expect(await runGuideAction(jobId, "setBoardLayers", arg)).toEqual({ ok: false, error: "That job isn't on your account any more." });
    context.company.id = companyId;
    expect((await runGuideAction(contractedJobId, "setBoardLayers", arg)).ok).toBe(false);
    expect(await layersOf(w2)).toBeNull();
  });

  it("refuses a stale question — a run added since the screen was drawn — and writes nothing", async () => {
    const arg = await chipArg(jobId, "2 layers each side");
    const added = await prisma.wallRun.create({ data: { companyId, jobId, wallTypeId: w2, label: "Added", lengthFt: 5 } });
    try {
      expect(await runGuideAction(jobId, "setBoardLayers", arg)).toEqual({ ok: false, error: expect.stringContaining("changed since you saw the question") });
      expect(await layersOf(w2)).toBeNull();
    } finally {
      await prisma.wallRun.delete({ where: { id: added.id } });
    }
  });

  it("two layers: the type keeps every other field, the board doubles on THIS job, nothing else moves", async () => {
    const arg = await chipArg(jobId, "2 layers each side");
    expect(await runGuideAction(jobId, "setBoardLayers", arg)).toEqual({ ok: true });

    const row = await prisma.wallType.findUniqueOrThrow({ where: { id: w2 } });
    expect(row).toMatchObject({ code: CODE, boardLayers: 2, sides: 2, notes: "keep me" });
    expect(Number(row.defaultHeightFt)).toBe(10);
    expect(Number(row.thicknessIn)).toBe(4.88);

    expect(await quantities(jobId)).toEqual({
      "W2 — 3⅝″ 20ga studs": 115,
      "W2 — 3⅝″ 20ga track, top and bottom": 300,
      // 3,000 / 32 × 2 × 1.10 = 206.25 → 207
      "W2 — ⅝″ Type X board, 4x8 sheets": 207,
      "W2 — Hang, tape and finish ⅝″ board": 3000,
      "W2 — R-13 batt insulation": 1500,
      "L1 — 5/8in gypsum board, 2 layers per side": 800,
    });
    // The contracted job's walls were not refreshed.
    expect(await quantities(contractedJobId)).toEqual({});

    // The question is gone, and the same tap again is stale rather than a second write.
    const facts = (await loadJobGuideFacts(companyId, jobId))!;
    expect(buildJobGuide(facts, NOW).ask!.id).not.toBe("board-layers");
    expect((await runGuideAction(jobId, "setBoardLayers", arg)).ok).toBe(false);
  });
});
