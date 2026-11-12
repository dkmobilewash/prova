import { describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { jobSteps } from "@/lib/job-steps";
import { loadJobStepFacts } from "@/lib/job-steps-query";
import { TRADE_PRESETS } from "@/lib/trade-presets";

/**
 * The Baker flow walk's biggest step C-Stream could do itself: on Send, a new user typed
 * an inclusion and an exclusion before the proposal could go (6 of Send's 13 presses).
 * Now the trade pick puts the trade's usual inclusions and exclusions in the company's
 * clause library, and a new job starts with them on its proposal: Send asks for
 * nothing. A company with no library starts with none, as before.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { applyTradePreset } = await import("@/lib/actions/tradePresets");
const { createEstimateJob } = await import("./create-job");

async function newCompany(name: string) {
  const company = await prisma.company.create({ data: { name: `${name} ${Date.now()}` } });
  const owner = await prisma.user.create({ data: { companyId: company.id, clerkId: `sc_${company.id}`, email: `sc_${company.id}@example.test`, role: "OWNER" } });
  context.company.id = company.id;
  context.id = owner.id;
  return company.id;
}

describe("a new job's proposal starts with the company's standard clauses", () => {
  it("the framing trade's inclusions and exclusions go in the library, and a new job starts with them: Send asks for nothing", async () => {
    const companyId = await newCompany("Starting Clauses");
    expect(await applyTradePreset("FRAMING_DRYWALL")).toEqual({ ok: true });
    const preset = TRADE_PRESETS.find((p) => p.choice === "FRAMING_DRYWALL")!;
    const library = await prisma.proposalClause.findMany({ where: { companyId }, orderBy: { sortOrder: "asc" }, select: { kind: true, text: true } });
    expect(library).toEqual([
      ...preset.clauses.inclusions.map((text) => ({ kind: "INCLUSION", text })),
      ...preset.clauses.exclusions.map((text) => ({ kind: "EXCLUSION", text })),
    ]);

    const created = await createEstimateJob(companyId, { jobName: "Baker EOC", contact: { name: "Walker Builders" } });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const jobId = created.value.jobId;
    const onJob = await prisma.jobProposalClause.findMany({ where: { jobId }, orderBy: { sortOrder: "asc" }, select: { kind: true, text: true } });
    expect(onJob).toEqual(library);

    // What the stepper says at Send: no stop for clauses.
    const facts = await loadJobStepFacts(companyId, jobId);
    expect(facts.clausesReady).toBe(true);
    // Copies, not links: editing the library later moves nothing on the job.
    await prisma.proposalClause.updateMany({ where: { companyId }, data: { text: "edited later" } });
    expect((await prisma.jobProposalClause.findMany({ where: { jobId }, select: { text: true } })).map((c) => c.text)).not.toContain("edited later");
  });

  it("a company with no clause library starts its jobs with none, and Send still asks", async () => {
    const companyId = await newCompany("No Library");
    const created = await createEstimateJob(companyId, { jobName: "Plain job", contact: { name: "GC" } });
    if (!created.ok) throw new Error(created.error);
    expect(await prisma.jobProposalClause.count({ where: { jobId: created.value.jobId } })).toBe(0);
    const facts = await loadJobStepFacts(companyId, created.value.jobId);
    expect(facts.clausesReady).toBe(false);
    expect(jobSteps(facts).steps).toBeDefined();
  });
});
