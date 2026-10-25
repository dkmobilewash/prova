import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * `deleteEstimateJob` against a real Postgres, where foreign keys are enforced.
 *
 * Reported 2026-10-19 by a user walk on main: Job Overview -> Remove -> "Remove
 * it" on an estimate that had been taken off and priced threw
 * `TakeoffPlan_jobId_fkey` and, once the plan was deleted by hand,
 * `JobBidRecap_jobId_fkey` — both redacted in production to "This page didn't
 * load". No unit test could see it: the action's mocked Prisma has no foreign
 * keys. So the estimate here carries every working paper an estimator makes
 * (plan, page, calibration, measurement, takeoff item, wall run, bid recap,
 * proposal clause, line item) and the job must go with all of them, in one
 * transaction. Evidence — an RFI, a recorded cost, a lien deadline — must
 * still refuse with a sentence and delete nothing.
 *
 * Named `.dbtest.ts` so the ordinary suite does not collect it; runs under
 * `vitest.db.config.mts`, which refuses anything that is not a scratch database.
 */
const context = {
  company: { id: "" },
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const deletedFiles: string[] = [];
vi.mock("@/lib/blob", () => ({
  deleteDocument: async (url: string) => {
    deletedFiles.push(url);
  },
}));
vi.mock("@/lib/weather", () => ({ geocodeSite: async () => null }));

const { deleteEstimateJob } = await import("./jobDetails");

let companyId = "";
let contactId = "";
const stamp = Date.now();

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Remove Job Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({
    data: { companyId, clerkId: `rmjob_${stamp}`, email: `rmjob_${stamp}@example.test`, role: "OWNER" },
  });
  context.id = owner.id;
  contactId = (await prisma.contact.create({ data: { companyId, name: "Test GC" } })).id;
});

beforeEach(() => {
  context.role = "OWNER";
  deletedFiles.length = 0;
});

afterAll(async () => {
  const jobs = await prisma.job.findMany({ where: { companyId }, select: { id: true } });
  const jobIds = jobs.map((j) => j.id);
  await prisma.costEntry.deleteMany({ where: { lineItem: { jobId: { in: jobIds } } } });
  await prisma.rfi.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.lienDeadline.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobProposalClause.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobBidRecap.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.wallRun.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.jobLineItem.deleteMany({ where: { jobId: { in: jobIds } } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.wallType.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
  await prisma.$disconnect();
});

/** An estimate somebody took off and priced: the shape that threw on 19 Oct. */
async function workedUpEstimate(name: string) {
  const job = await prisma.job.create({ data: { companyId, contactId, name, status: "ESTIMATE" } });
  const jobId = job.id;
  const lineItem = await prisma.jobLineItem.create({ data: { jobId, description: "5/8 Type X board" } });
  const fileUrl = `https://example.test/${name.replace(/\W+/g, "-")}.pdf`;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } });
  const calibration = await prisma.takeoffScaleCalibration.create({
    data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" },
  });
  const item = await prisma.takeoffItem.create({
    data: { companyId, jobId, name: "Partitions", type: "LINEAR", colorHex: "#336699" },
  });
  await prisma.takeoffMeasurement.create({
    data: { pageId: page.id, calibrationId: calibration.id, kind: "AREA", itemId: item.id },
  });
  await prisma.jobLineItem.update({ where: { id: lineItem.id }, data: { takeoffItemId: item.id } });
  const wallType = await prisma.wallType.create({ data: { companyId, code: `W-${name}`, name: "Interior partition" } });
  await prisma.wallRun.create({ data: { companyId, jobId, wallTypeId: wallType.id, label: "Corridor", lengthFt: "40" } });
  await prisma.jobBidRecap.create({ data: { companyId, jobId, overheadPercent: "10", profitPercent: "8" } });
  await prisma.jobProposalClause.create({ data: { companyId, jobId, kind: "EXCLUSION", text: "Fire caulking" } });
  return { jobId, lineItemId: lineItem.id, planId: plan.id, fileUrl };
}

describe("deleteEstimateJob", () => {
  it("removes a taken-off, priced estimate together with its working papers", async () => {
    const { jobId, planId, fileUrl } = await workedUpEstimate("Taken off and priced");

    const result = await deleteEstimateJob(jobId);

    expect(result).toEqual({ ok: true });
    expect(await prisma.job.count({ where: { id: jobId } })).toBe(0);
    expect(await prisma.takeoffPlan.count({ where: { jobId } })).toBe(0);
    expect(await prisma.takeoffPlanPage.count({ where: { planId } })).toBe(0);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(0);
    expect(await prisma.wallRun.count({ where: { jobId } })).toBe(0);
    expect(await prisma.jobBidRecap.count({ where: { jobId } })).toBe(0);
    expect(await prisma.jobProposalClause.count({ where: { jobId } })).toBe(0);
    expect(await prisma.jobLineItem.count({ where: { jobId } })).toBe(0);
    // The plan's file goes too — after the rows, never before.
    expect(deletedFiles).toEqual([fileUrl]);
  });

  it("refuses an estimate with an RFI on file, by name, and removes nothing", async () => {
    const { jobId } = await workedUpEstimate("Has an RFI");
    await prisma.rfi.create({ data: { companyId, jobId, number: 1, subject: "Head of wall", question: "Deflection?" } });

    const result = await deleteEstimateJob(jobId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Has an RFI has 1 RFI on file, so its record stays. Only an estimate nobody has worked can be removed.");
    expect(await prisma.job.count({ where: { id: jobId } })).toBe(1);
    expect(await prisma.takeoffPlan.count({ where: { jobId } })).toBe(1);
    expect(await prisma.jobBidRecap.count({ where: { jobId } })).toBe(1);
    expect(deletedFiles).toEqual([]);
  });

  it("refuses an estimate with a lien deadline — a RESTRICT child the old list never named", async () => {
    const { jobId } = await workedUpEstimate("Has a lien deadline");
    await prisma.lienDeadline.create({
      data: { companyId, jobId, kind: "PRELIMINARY_NOTICE", dueOn: new Date("2026-11-01T00:00:00Z") },
    });

    const result = await deleteEstimateJob(jobId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1 lien deadline on file");
    expect(await prisma.job.count({ where: { id: jobId } })).toBe(1);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(1);
  });

  it("refuses an estimate with a cost recorded against one of its line items", async () => {
    const { jobId, lineItemId } = await workedUpEstimate("Has a cost");
    await prisma.costEntry.create({ data: { lineItemId, description: "Board delivery", amount: "1200" } });

    const result = await deleteEstimateJob(jobId);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("1 recorded cost on file");
    expect(await prisma.jobLineItem.count({ where: { jobId } })).toBe(1);
  });

  it("still refuses a non-owner with a sentence", async () => {
    const { jobId } = await workedUpEstimate("Member tries");
    context.role = "MEMBER";

    const result = await deleteEstimateJob(jobId);

    expect(result.ok).toBe(false);
    expect(await prisma.job.count({ where: { id: jobId } })).toBe(1);
  });
});
