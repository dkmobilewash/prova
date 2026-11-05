import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * "Started, I'll tell you when it's done", wired end to end against a real
 * Postgres. takeoff.test.ts proves the card and the alert builder apart; what
 * only a database can prove is that the two MEET: confirmAskProposal writes
 * the run as the card's target, and the alert query finds exactly that row —
 * for the person who asked, once the run has finished, and for nobody else.
 * startPlanIngest is the one fake (it needs a PDF in storage); it returns a
 * real PlanIngestJob row this test created.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const fake = vi.hoisted(() => ({ runId: "" }));
vi.mock("@/lib/actions/planIngest", () => ({
  startPlanIngest: async () => ({ ok: true, value: { jobId: fake.runId, stage: "WALLS" } }),
}));

const { confirmAskProposal } = await import("@/lib/actions/ask");
const { loadAlerts } = await import("@/lib/alerts-query");
const { linkToken } = await import("@/lib/tokens");

let companyId = "";
let askerId = "";
let otherId = "";
let jobId = "";
let cardId = "";
const TODAY = new Date().toISOString().slice(0, 10);
const takeoffAlerts = async (userId: string) =>
  (await loadAlerts(companyId, userId, TODAY)).visible.filter((alert) => alert.kind === "TAKEOFF_RUN_DONE");

describe("a takeoff run started from Ask tells the asker when it is done", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "TAKEOFF-ASK-DBTEST Co" } });
    companyId = company.id;
    context.company.id = companyId;
    const asker = await prisma.user.create({ data: { companyId, clerkId: `tk_${Date.now()}`, email: `tk_${Date.now()}@example.test`, role: "OWNER" } });
    const other = await prisma.user.create({ data: { companyId, clerkId: `tk2_${Date.now()}`, email: `tk2_${Date.now()}@example.test`, role: "OWNER" } });
    askerId = asker.id;
    otherId = other.id;
    context.id = askerId;
    const contact = await prisma.contact.create({ data: { companyId, name: "TAKEOFF-ASK GC" } });
    const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "TAKEOFF-ASK Washington Village" } });
    jobId = job.id;
    const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "https://example.test/wv.pdf", fileName: "wv.pdf" } });
    const run = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId, stage: "WALLS", pageCount: 4, startedByUserId: askerId } });
    fake.runId = run.id;
    cardId = linkToken();
    await prisma.askProposal.create({
      data: {
        id: cardId,
        companyId,
        createdByUserId: askerId,
        command: "run_takeoff",
        mode: "DIRECT",
        question: "run takeoff on Washington Village",
        input: { jobName: "Washington Village" },
        resolved: { jobId, jobName: job.name, planId: plan.id, sheets: 4 },
        preview: [{ label: "Job", value: job.name }],
        model: "test",
        toolUseId: "tu_takeoff",
        toolUseIdsInContext: [],
        expiresAt: new Date(Date.now() + 10 * 60_000),
      },
    });
  });

  afterAll(async () => {
    await prisma.askProposal.deleteMany({ where: { companyId } });
    await prisma.planIngestJob.deleteMany({ where: { companyId } });
    await prisma.takeoffPlan.deleteMany({ where: { companyId } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
  });

  it("the tap records the run as the card's target in the audit trail", async () => {
    const result = await confirmAskProposal(cardId);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    const row = await prisma.askProposal.findUniqueOrThrow({ where: { id: cardId } });
    expect(row).toMatchObject({ outcome: "OK", targetType: "PlanIngestJob", targetId: fake.runId });
  });

  it("says nothing while the run is still going", async () => {
    expect(await takeoffAlerts(askerId)).toHaveLength(0);
  });

  it("alerts the asker, with the takeoff link, once the run finishes — and not their colleague", async () => {
    await prisma.planIngestJob.update({ where: { id: fake.runId }, data: { finishedAt: new Date() } });
    const mine = await takeoffAlerts(askerId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ href: `/jobs/${jobId}/takeoff`, title: "Takeoff finished on TAKEOFF-ASK Washington Village" });
    expect(await takeoffAlerts(otherId)).toHaveLength(0);
  });
});
