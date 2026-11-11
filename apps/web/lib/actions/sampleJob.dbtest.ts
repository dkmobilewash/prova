import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

// "Try it on a sample set": the sample job a new company gets, built by the same
// steps a pilot's job goes through, on the invented sample sheet, then deleted.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { createSampleJob, deleteSampleJob } = await import("./sampleJob");
const { startPlanIngest } = await import("./planIngest");
const { loadReviewQueue } = await import("@/lib/takeoff/reviewQueueQuery");
const { SAMPLE_READS_NOTHING } = await import("@/lib/sample-job/samplePlan");

let companyId = "";
let jobId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Sample Job Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `sample_${Date.now()}`, email: `sample_${Date.now()}@example.test`, role: "OWNER" } })).id;
});

describe("the sample job", () => {
  it("is built on the invented sheet: scale set, walls found and on the job, one group in the estimate, the rest waiting in the queue", async () => {
    const made = await createSampleJob();
    expect(made.ok, made.ok ? "" : made.error).toBe(true);
    jobId = made.ok ? made.value.jobId : "";
    const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, select: { isSample: true, name: true, contact: { select: { name: true } } } });
    expect(job).toMatchObject({ isSample: true, name: "Sample — Professional office suite", contact: { name: "Sample GC (invented)" } });
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, select: { id: true, fileUrl: true, pages: { select: { calibrations: { select: { declaredDistanceFeet: true } }, wallProposals: { select: { id: true } } } } } });
    expect(plan.fileUrl).toBe("sample:office");
    // S13 is 1728 pt at 1/8" = 1'-0": 24 paper inches, 192 ft across.
    expect(Number(plan.pages[0]!.calibrations[0]!.declaredDistanceFeet)).toBe(192);
    expect(plan.pages[0]!.wallProposals.length).toBeGreaterThan(0);
    const onJob = await prisma.takeoffMeasurement.count({ where: { page: { planId: plan.id }, kind: "LINEAR", source: "DETECTED" } });
    expect(onJob).toBeGreaterThan(0);
    const lines = await prisma.jobLineItem.findMany({ where: { jobId }, select: { description: true, quantity: true } });
    expect(lines.length, "the typed group wrote no estimate lines").toBeGreaterThan(0);
    const queue = await loadReviewQueue(companyId, jobId);
    const left = queue.items.filter((item) => item.kind === "type");
    console.log(`SAMPLE: ${plan.pages[0]!.wallProposals.length} proposal row(s), ${onJob} run(s) on the job, ${lines.length} line(s), ${left.length} group(s) left to type: ${left.map((g) => `${g.inches}" ${Math.round(g.feet ?? 0)} ft`).join(", ")}; queue kinds ${[...new Set(queue.items.map((i) => i.kind))].join(",")}`);
    expect(left.length, "nothing left for the new user to confirm in the queue").toBeGreaterThan(0);
  });

  it("pressed again, opens the same one", async () => {
    const again = await createSampleJob();
    expect(again).toEqual({ ok: true, value: { jobId } });
    expect(await prisma.job.count({ where: { companyId, isSample: true } })).toBe(1);
  });

  it("never starts a reading that uses plan sheets, and says why", async () => {
    const plan = await prisma.takeoffPlan.findFirstOrThrow({ where: { jobId }, select: { id: true } });
    expect(await startPlanIngest(plan.id, "TITLE_BLOCK")).toEqual({ ok: false, error: SAMPLE_READS_NOTHING });
    expect(await prisma.planIngestJob.count({ where: { planId: plan.id, stage: "TITLE_BLOCK" } })).toBe(0);
  });

  it("deletes in one press, takeoff and all, and the invented GC with it; a real job is refused", async () => {
    const contact = await prisma.contact.create({ data: { companyId, name: "Real GC" } });
    const real = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Real job", status: "ESTIMATE" } });
    expect(await deleteSampleJob(real.id)).toEqual({ ok: false, error: "Real job is a real job, not the sample, so it is not removed from here." });
    expect(await deleteSampleJob(jobId)).toEqual({ ok: true });
    expect(await prisma.job.count({ where: { id: jobId } })).toBe(0);
    expect(await prisma.takeoffPlan.count({ where: { jobId } })).toBe(0);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(0);
    expect(await prisma.contact.count({ where: { companyId, name: "Sample GC (invented)" } })).toBe(0);
    expect(await prisma.job.count({ where: { id: real.id } })).toBe(1);
  });
});
