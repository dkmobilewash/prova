import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

// Plan comparison's stored half: a person's change or removal of a sheet's
// demolition-plan pairing, and the switch. The automatic pairing is derived
// from the sheets' numbers and titles every load and never stored.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { savePriorPlanChoice, savePlanCompareSwitch } = await import("./planCompare");
const { pairingsForPlan } = await import("@/lib/takeoff/priorPlanLoad");

let companyId = "";
let jobId = "";
let planId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Plan Compare Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `plancompare_${Date.now()}`, email: `plancompare_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Renovation Job", status: "ESTIMATE" } });
  jobId = job.id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:reno.pdf", fileName: "reno.pdf" } });
  planId = plan.id;
  const inventory = await prisma.planIngestJob.create({ data: { planId, companyId, stage: "PAGE_INVENTORY", pageCount: 4, finishedAt: new Date() } });
  const titles: Record<number, [string, string]> = {
    1: ["D100", "DEMOLITION FLOOR PLAN - LEVEL 1"],
    2: ["A100", "FLOOR PLAN - LEVEL 1"],
    3: ["D101", "DEMOLITION FLOOR PLAN - LEVEL 2"],
    4: ["A101", "FLOOR PLAN - LEVEL 2"],
  };
  for (const n of [1, 2, 3, 4]) {
    await prisma.planSheetText.create({ data: { planId, pageNumber: n, hasTextLayer: true, widthPt: 2592, heightPt: 1728 } });
    await prisma.planSheetProposal.create({
      data: { ingestJobId: inventory.id, planId, pageNumber: n, proposedSheetNumber: titles[n][0], proposedTitle: titles[n][1], proposedPageType: "PLAN", proposedReason: "test", proposedConfidence: "HIGH", model: "test", promptVersion: "test" },
    });
  }
});

describe("a sheet's demolition-plan pairing", () => {
  it("is paired automatically by sheet number, with nothing stored", async () => {
    const p = await pairingsForPlan(planId);
    expect(p.byPage.get(2)).toEqual({ demoPage: 1, source: "auto", basis: "sheet-number" });
    expect(p.byPage.get(4)).toEqual({ demoPage: 3, source: "auto", basis: "sheet-number" });
    expect(await prisma.takeoffPlanPage.count({ where: { planId, priorPageChoice: { not: null } } })).toBe(0);
  });

  it("a person can change it, remove it, and go back to the automatic one", async () => {
    expect((await savePriorPlanChoice({ jobId, planId, pageNumber: 2, choice: 3 })).ok).toBe(true);
    expect((await pairingsForPlan(planId)).byPage.get(2)).toEqual({ demoPage: 3, source: "user", basis: "chosen" });
    expect((await savePriorPlanChoice({ jobId, planId, pageNumber: 2, choice: "none" })).ok).toBe(true);
    expect((await pairingsForPlan(planId)).byPage.has(2)).toBe(false);
    expect((await savePriorPlanChoice({ jobId, planId, pageNumber: 2, choice: "auto" })).ok).toBe(true);
    expect((await pairingsForPlan(planId)).byPage.get(2)?.source).toBe("auto");
  });

  it("refuses a sheet paired with itself, and a plan from another company", async () => {
    const self = await savePriorPlanChoice({ jobId, planId, pageNumber: 2, choice: 2 });
    expect(self.ok).toBe(false);
    const other = await savePriorPlanChoice({ jobId, planId: "not-this-companys-plan", pageNumber: 2, choice: 1 });
    expect(other.ok).toBe(false);
  });
});

describe("the company switch", () => {
  it("starts off, and the owner can turn it on and off", async () => {
    expect((await prisma.company.findUnique({ where: { id: companyId }, select: { planCompareOn: true } }))?.planCompareOn).toBe(false);
    const on = new FormData();
    on.set("planCompareOn", "on");
    expect((await savePlanCompareSwitch(on)).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId }, select: { planCompareOn: true } }))?.planCompareOn).toBe(true);
    expect((await savePlanCompareSwitch(new FormData())).ok).toBe(true);
    expect((await prisma.company.findUnique({ where: { id: companyId }, select: { planCompareOn: true } }))?.planCompareOn).toBe(false);
  });

  it("refuses anyone but the owner", async () => {
    context.role = "ADMIN";
    const refused = await savePlanCompareSwitch(new FormData());
    context.role = "OWNER";
    expect(refused.ok).toBe(false);
  });
});
