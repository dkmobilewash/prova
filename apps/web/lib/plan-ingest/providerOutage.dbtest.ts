import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { claimPlanSheet, markPlanSheetFailure, releasePlanSheet } from "@/lib/ask/planSheetSpend";
import { PLAN_READING_UNAVAILABLE } from "@/lib/ai/providerOutage";
import { creditError } from "@/lib/ai/providerOutage.testutil";
import { claimPorts, ingestViewOf } from "./claim";
import { MAX_ATTEMPTS, runIngest } from "./runner";
import { titleBlockWork, type TitleBlockDeps } from "./titleBlock";

/**
 * 2026-11-07, simulated: the account is out of Anthropic credit and every title-block
 * read gets the 400 "credit balance is too low". Through the real claim ports and the
 * real monthly allowance: nothing is charged, the page never runs out of attempts,
 * and the run says it is an outage, once.
 */
const E2E = "ZZ-DBTEST provider outage";
let companyId = "";
let ingestJobId = "";
let planId = "";

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: `${E2E} Co` } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: `${E2E} GC` } });
  const jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: `${E2E} Job`, status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  ingestJobId = (await prisma.planIngestJob.create({ data: { planId, companyId, stage: "TITLE_BLOCK", pageCount: 1 } })).id;
  await prisma.planIngestTask.create({ data: { jobId: ingestJobId, pageNumber: 1, stage: "TITLE_BLOCK" } });
});

const used = async () => (await prisma.askAllowancePeriod.findFirst({ where: { companyId }, select: { planSheetsUsed: true, failedPlanSheets: true } })) ?? { planSheetsUsed: 0, failedPlanSheets: 0 };

function stage(extract: TitleBlockDeps["extract"]) {
  const deps = {
    loadSheetText: async () => ({ id: "text_1", hasTextLayer: true, titleBlockText: "ZZ ARCHITECTS\nFIRST FLOOR PLAN\nA-101", wholePageFallback: false }),
    gate: async () => ({ ok: true as const, settings: { planSheetsPerMonth: 1500 }, model: "claude-haiku-4-5" }),
    claim: claimPlanSheet,
    markFailure: markPlanSheetFailure,
    release: releasePlanSheet,
    extract,
    saveProposal: async () => {},
    recordUsage: async () => {},
  } as unknown as TitleBlockDeps;
  return titleBlockWork({ planId, companyId, ingestJobId, jobId: "j", startedByUserId: "u" }, deps);
}

describe("plan reading while the provider refuses every call (simulated 400 credit error)", () => {
  it("CHARGES NOTHING, NEVER RUNS THE PAGE OUT OF ATTEMPTS, and the run says it is an outage", async () => {
    const work = stage((async () => { throw creditError(); }) as unknown as TitleBlockDeps["extract"]);
    // Five runs, each past the last one's backoff (`now` jumps an hour each time).
    let clock = Date.now() - 10 * 3_600_000;
    for (let run = 0; run < MAX_ATTEMPTS + 2; run += 1) {
      clock += 3_600_000;
      await runIngest({ ports: claimPorts({ jobId: ingestJobId, work, now: () => clock }), now: () => clock });
    }
    const task = await prisma.planIngestTask.findFirstOrThrow({ where: { jobId: ingestJobId }, select: { attempts: true, error: true, finishedAt: true, nextAttemptAt: true } });
    expect(task.attempts).toBe(0);
    expect(task.error).toBe(PLAN_READING_UNAVAILABLE);
    expect(task.finishedAt).toBeNull();
    expect(task.nextAttemptAt).not.toBeNull();
    expect(await used()).toEqual({ planSheetsUsed: 0, failedPlanSheets: 0 });
    const view = await ingestViewOf(ingestJobId, "TITLE_BLOCK");
    expect(view.outage).toBe(true);
    expect(view.exhausted).toBe(0);
  });

  it("and when the provider answers again, the page is read, charged once, and the outage is over", async () => {
    await prisma.planIngestTask.updateMany({ where: { jobId: ingestJobId }, data: { nextAttemptAt: null } });
    const read = { sheetNumber: "A-101", title: "FIRST FLOOR PLAN", discipline: "ARCHITECTURAL", scale: null, revision: null, issueDate: null, reason: "r", confidence: "HIGH" };
    const work = stage((async () => read) as unknown as TitleBlockDeps["extract"]);
    await runIngest({ ports: claimPorts({ jobId: ingestJobId, work }) });
    const task = await prisma.planIngestTask.findFirstOrThrow({ where: { jobId: ingestJobId }, select: { finishedAt: true } });
    expect(task.finishedAt).not.toBeNull();
    expect((await used()).planSheetsUsed).toBe(1);
    expect((await ingestViewOf(ingestJobId, "TITLE_BLOCK")).outage).toBe(false);
  });
});
