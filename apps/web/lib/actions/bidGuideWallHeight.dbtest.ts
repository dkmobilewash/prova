import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * "How tall are the W2 walls on Civic Center?" answered with a tap, against a
 * real Postgres — through `runGuideAction`, so the REAL `updateWallType` and
 * `refreshWallSchedule` do the writing. Runs against a SCRATCH database only
 * (vitest.db.setup.mts).
 *
 * The cast: W2 (one board component, no default height) with two runs on an
 * ESTIMATE job and nothing on its estimate yet; the same company's CONTRACTED
 * job; another company's job and wall type.
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
const { loadJobGuideFacts } = await import("@/lib/bid/guide/facts");
const { buildJobGuide } = await import("@/lib/bid/guide/buildJobGuide");

const t = `wh_${Date.now()}`;
/** Upper case, as `updateWallType` stores a tag — see the rename test for why it matters. */
const CODE = `W2${t}`.toUpperCase();
const NOW = new Date("2026-10-26T15:00:00.000Z");
let companyId = "";
let otherCompanyId = "";
let jobId = "";
let contractedJobId = "";
let otherJobId = "";
let w2 = "";
let otherType = "";

/** The chip the screen would draw for this height, read off the real guide. */
async function chipArg(forJob: string, heightLabel: string): Promise<string> {
  const facts = (await loadJobGuideFacts(companyId, forJob))!;
  const ask = buildJobGuide(facts, NOW).ask!;
  expect(ask.id).toBe("wall-height");
  return ask.actions.find((action) => action.label === heightLabel)!.actionArg!;
}

const heightOf = async (id: string) => {
  const row = await prisma.wallType.findUniqueOrThrow({ where: { id }, select: { defaultHeightFt: true } });
  return row.defaultHeightFt == null ? null : Number(row.defaultHeightFt);
};
const wallLines = (forJob: string) => prisma.jobLineItem.findMany({ where: { jobId: forJob, isDeleted: false, wallTypeComponentId: { not: null } } });

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `WH Co ${t}` } })).id;
  otherCompanyId = (await prisma.company.create({ data: { name: `WH Other ${t}` } })).id;
  context.company.id = companyId;
  const gc = await prisma.contact.create({ data: { companyId, name: `GC ${t}` } });
  const otherGc = await prisma.contact.create({ data: { companyId: otherCompanyId, name: `GC2 ${t}` } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: `Civic Center ${t}`, status: "ESTIMATE" } })).id;
  contractedJobId = (await prisma.job.create({ data: { companyId, contactId: gc.id, name: `Signed ${t}`, status: "CONTRACTED" } })).id;
  otherJobId = (await prisma.job.create({ data: { companyId: otherCompanyId, contactId: otherGc.id, name: `Theirs ${t}`, status: "ESTIMATE" } })).id;

  // A thickness and a board-layer answer, because the height tap re-sends the
  // whole row and once cleared the thickness by leaving it out.
  w2 = (
    await prisma.wallType.create({
      data: { companyId, code: CODE, name: "rated wall", sides: 2, studSpacingIn: 16, notes: "keep me", thicknessIn: "4.88", boardLayers: 2 },
    })
  ).id;
  await prisma.wallTypeComponent.create({ data: { wallTypeId: w2, description: "Board", unit: "SF", basis: "BOARDED_SQFT" } });
  otherType = (await prisma.wallType.create({ data: { companyId: otherCompanyId, code: CODE, name: "theirs" } })).id;
  await prisma.wallTypeComponent.create({ data: { wallTypeId: otherType, description: "Board", unit: "SF", basis: "BOARDED_SQFT" } });

  await prisma.wallRun.createMany({
    data: [
      { companyId, jobId, wallTypeId: w2, label: "Corridor", lengthFt: 100 },
      { companyId, jobId, wallTypeId: w2, label: "Lobby", lengthFt: 50 },
      { companyId, jobId: contractedJobId, wallTypeId: w2, label: "Signed run", lengthFt: 10 },
      { companyId: otherCompanyId, jobId: otherJobId, wallTypeId: otherType, label: "Their run", lengthFt: 70 },
    ],
  });
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

describe("setWallHeight through runGuideAction, real rows", () => {
  it("refuses a person without estimating, and writes nothing", async () => {
    const arg = await chipArg(jobId, "9 ft");
    context.role = "MEMBER";
    context.jobFunction = "FIELD";
    expect((await runGuideAction(jobId, "setWallHeight", arg)).ok).toBe(false);
    expect(await heightOf(w2)).toBeNull();
  });

  it("refuses another company: their job with our arg, and our job from their seat", async () => {
    const arg = await chipArg(jobId, "9 ft");
    expect((await runGuideAction(otherJobId, "setWallHeight", arg)).ok).toBe(false);
    context.company.id = otherCompanyId;
    expect(await runGuideAction(jobId, "setWallHeight", arg)).toEqual({ ok: false, error: "That job isn't on your account any more." });
    // their wall type, through their own job, with our token: not a question they were asked
    const theirArg = arg.replace(w2, otherType);
    expect((await runGuideAction(otherJobId, "setWallHeight", theirArg)).ok).toBe(false);
    expect(await heightOf(w2)).toBeNull();
    expect(await heightOf(otherType)).toBeNull();
  });

  it("refuses a contracted job", async () => {
    const arg = await chipArg(jobId, "9 ft");
    expect((await runGuideAction(contractedJobId, "setWallHeight", arg)).ok).toBe(false);
    expect(await heightOf(w2)).toBeNull();
  });

  it("refuses a stale question — a run added since the screen was drawn — and writes nothing", async () => {
    const arg = await chipArg(jobId, "9 ft");
    const added = await prisma.wallRun.create({ data: { companyId, jobId, wallTypeId: w2, label: "Added", lengthFt: 5 } });
    try {
      const result = await runGuideAction(jobId, "setWallHeight", arg);
      expect(result).toEqual({ ok: false, error: expect.stringContaining("changed since you saw the question") });
      expect(await heightOf(w2)).toBeNull();
      expect(await wallLines(jobId)).toEqual([]);
    } finally {
      await prisma.wallRun.delete({ where: { id: added.id } });
    }
  });

  it("refuses rather than RENAME a tag updateWallType would rewrite (a schedule's lower-case 'W2a')", async () => {
    await prisma.wallType.update({ where: { id: w2 }, data: { code: `${CODE}a` } });
    try {
      const arg = await chipArg(jobId, "9 ft");
      const result = await runGuideAction(jobId, "setWallHeight", arg);
      expect(result).toEqual({ ok: false, error: expect.stringContaining("would be renamed") });
      const row = await prisma.wallType.findUniqueOrThrow({ where: { id: w2 } });
      expect(row.code).toBe(`${CODE}a`);
      expect(row.defaultHeightFt).toBeNull();
    } finally {
      await prisma.wallType.update({ where: { id: w2 }, data: { code: CODE } });
    }
  });

  it("the answer sets the type's height through updateWallType, keeps its other fields, and the walls become lines", async () => {
    expect(await wallLines(jobId)).toEqual([]);
    const arg = await chipArg(jobId, "9 ft");
    expect(await runGuideAction(jobId, "setWallHeight", arg)).toEqual({ ok: true });

    const row = await prisma.wallType.findUniqueOrThrow({ where: { id: w2 } });
    expect(Number(row.defaultHeightFt)).toBe(9);
    expect(row).toMatchObject({ code: CODE, name: "rated wall", sides: 2, notes: "keep me", boardLayers: 2 });
    expect(Number(row.studSpacingIn)).toBe(16);
    // The wall finder matches on this; the height tap used to clear it.
    expect(Number(row.thicknessIn)).toBe(4.88);

    // 150 LF × 9 ft × 2 sides of board, on THIS job only.
    const lines = await wallLines(jobId);
    expect(lines.length).toBe(1);
    expect(Number(lines[0]!.quantity)).toBeCloseTo(150 * 9 * 2, 2);
    expect(await wallLines(contractedJobId)).toEqual([]);

    // and the question is gone; the same tap again is stale, not a second write
    const facts = (await loadJobGuideFacts(companyId, jobId))!;
    expect(buildJobGuide(facts, NOW).ask!.id).not.toBe("wall-height");
    expect((await runGuideAction(jobId, "setWallHeight", arg)).ok).toBe(false);
  });
});
