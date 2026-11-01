import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { addFinishLinesToEstimate } = await import("./takeoff");

let companyId = "";
let jobId = "";
let pageId = "";

beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Finish Lines Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const user = await prisma.user.create({ data: { clerkId: `user_finish_${Date.now()}`, email: `finish-${Date.now()}@example.test`, companyId } });
  context.id = user.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "Test GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Finish Lines Job", status: "ESTIMATE" } })).id;
  const plan = await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x", fileName: "x.pdf" } });
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } })).id;
});

afterAll(async () => {
  await prisma.jobLineItem.deleteMany({ where: { jobId } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlanPage.deleteMany({ where: { id: pageId } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("addFinishLinesToEstimate", () => {
  it("posts one line per finish, named for the sheet, and a second press replaces them", async () => {
    const out = await addFinishLinesToEstimate(jobId, pageId, "A101", [{ label: "Floor CPT-1", quantity: 887.5, unit: "sq ft" }, { label: "Base RB-1", quantity: 527, unit: "lin ft" }]);
    expect(out).toEqual({ ok: true, value: { added: 2 } });
    const rows = await prisma.jobLineItem.findMany({ where: { jobId }, orderBy: { description: "asc" } });
    expect(rows.map((r) => [r.description, Number(r.quantity), r.unit])).toEqual([["A101 — Base RB-1", 527, "lin ft"], ["A101 — Floor CPT-1", 887.5, "sq ft"]]);
    await addFinishLinesToEstimate(jobId, pageId, "A101", [{ label: "Floor CPT-1", quantity: 900, unit: "sq ft" }]);
    const again = await prisma.jobLineItem.findMany({ where: { jobId, isDeleted: false } });
    expect(again.map((r) => [r.description, Number(r.quantity)])).toEqual([["A101 — Floor CPT-1", 900]]);
  });
  it("writes nothing when one quantity is bad, or the job is another company's", async () => {
    const before = await prisma.jobLineItem.count({ where: { jobId } });
    expect((await addFinishLinesToEstimate(jobId, pageId, "A101", [{ label: "Floor", quantity: 5, unit: "sq ft" }, { label: "Base", quantity: Number.NaN, unit: "lin ft" }])).ok).toBe(false);
    expect((await addFinishLinesToEstimate("not-a-job", pageId, "A101", [{ label: "Floor", quantity: 5, unit: "sq ft" }])).ok).toBe(false);
    expect(await prisma.jobLineItem.count({ where: { jobId } })).toBe(before);
  });
});
