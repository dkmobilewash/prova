import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { claimPlanSheet, markPlanSheetFailure, releasePlanSheet } from "@/lib/ask/planSheetSpend";
import { creditError } from "@/lib/ai/providerOutage.testutil";
import { claimPorts, nextJobToDrain } from "./claim";
import { runIngest } from "./runner";
import { titleBlockWork, type TitleBlockDeps } from "./titleBlock";

/**
 * ── ONE SET WAITING ON THE PROVIDER NEVER HOLDS UP ANOTHER SET'S READING ──
 *
 * 2026-11-11 (the original): the background drain served the globally oldest run; cmb's
 * model read was the oldest and out of credit, so 300 drain calls reached only it and six
 * new sets never got their page inventory. Here, through the real claim ports and a
 * simulated 400 "credit balance is too low":
 *   - set A's model read (older) fails with the credit error and goes into backoff;
 *   - set B's page inventory (newer, no model) is then the drain's next run, not A;
 *   - when both can run, the set served longest ago goes first (turns, not oldest-first);
 *   - a run with nothing left to do is still offered, so it is closed.
 */
const E2E = "ZZ-DBTEST drain fairness";
let companyId = "";
let planA = "";
let planB = "";
let jobA = "";
let jobB = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `${E2E} Co` } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: `${E2E} GC` } });
  const plan = async (name: string) => {
    const jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: `${E2E} ${name}`, status: "ESTIMATE" } })).id;
    return (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: `${name}.pdf` } })).id;
  };
  planA = await plan("A");
  planB = await plan("B");
  jobA = (await prisma.planIngestJob.create({ data: { planId: planA, companyId, stage: "TITLE_BLOCK", pageCount: 1, createdAt: new Date(Date.now() - 60_000) } })).id;
  await prisma.planIngestTask.create({ data: { jobId: jobA, pageNumber: 1, stage: "TITLE_BLOCK" } });
  jobB = (await prisma.planIngestJob.create({ data: { planId: planB, companyId, stage: "PAGE_INVENTORY", pageCount: 1 } })).id;
  await prisma.planIngestTask.create({ data: { jobId: jobB, pageNumber: 1, stage: "PAGE_INVENTORY" } });
});

function outOfCredit() {
  const deps = {
    loadSheetText: async () => ({ id: "text_1", hasTextLayer: true, titleBlockText: "ZZ ARCHITECTS\nFIRST FLOOR PLAN\nA-101", wholePageFallback: false }),
    gate: async () => ({ ok: true as const, settings: { planSheetsPerMonth: 1500 }, model: "claude-haiku-4-5" }),
    claim: claimPlanSheet,
    markFailure: markPlanSheetFailure,
    release: releasePlanSheet,
    extract: async () => {
      throw creditError();
    },
    saveProposal: async () => {},
    recordUsage: async () => {},
  } as unknown as TitleBlockDeps;
  return titleBlockWork({ planId: planA, companyId, ingestJobId: jobA, jobId: "j", startedByUserId: "u" }, deps);
}

describe("the background drain, fair across sets and never stuck on a run waiting for the provider", () => {
  it("before anything ran, the older set's run is first", async () => {
    expect(await nextJobToDrain(new Date(), [planA, planB])).toBe(jobA);
  });

  it("A's model read refused with a 400 credit error: B's page inventory is next, not A", async () => {
    await runIngest({ ports: claimPorts({ jobId: jobA, work: outOfCredit() }) });
    const a = await prisma.planIngestTask.findFirstOrThrow({ where: { jobId: jobA }, select: { finishedAt: true, nextAttemptAt: true } });
    expect(a.finishedAt).toBeNull();
    expect(a.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await nextJobToDrain(new Date(), [planA, planB])).toBe(jobB);
  });

  it("both runnable: the set served longest ago goes first, then the other (turns)", async () => {
    // A's backoff over: A was served (refused) just now, B never — B first.
    await prisma.planIngestTask.updateMany({ where: { jobId: jobA }, data: { nextAttemptAt: null } });
    expect(await nextJobToDrain(new Date(), [planA, planB])).toBe(jobB);
    // B served after A: A's turn.
    await prisma.planIngestTask.updateMany({ where: { jobId: jobB }, data: { attempts: 1, error: "transient", nextAttemptAt: null } });
    expect(await nextJobToDrain(new Date(), [planA, planB])).toBe(jobA);
  });

  it("a run with nothing left to do is still offered, so the drain closes it", async () => {
    await prisma.planIngestTask.updateMany({ where: { jobId: jobB }, data: { finishedAt: new Date(), error: null } });
    await prisma.planIngestTask.updateMany({ where: { jobId: jobA }, data: { nextAttemptAt: new Date(Date.now() + 3_600_000) } });
    expect(await nextJobToDrain(new Date(), [planA, planB])).toBe(jobB);
  });
});
