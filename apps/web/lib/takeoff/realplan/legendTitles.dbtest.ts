import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { prisma } from "@prova/db";
import { pageInventoryWork, realDeps } from "@/lib/plan-ingest/pageInventory";
import { takeoffSheetVerdict } from "@/lib/takeoff/takeoffSheet";

/**
 * On the real drawings, through the inventory's own title reader: Baker A001
 * and A111 were named by their keynote table's heading and A111 (the reflected
 * ceiling plan) was measured by the whole-set run. HPL I-110..I-112 were named
 * "KEYNOTES" the same way and are partition plans, so they must stay measured.
 *
 * BAKER_PDF and HPL_PDF name the drawings (outside the repository); each half
 * is skipped without its file. The sweep over all 36 training sets is in the
 * PR body: only these two Baker sheets change verdict.
 */
async function titles(pdf: string, pages: number[]): Promise<Map<number, string | null>> {
  const company = await prisma.company.create({ data: { name: "Legend titles" } });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Legend", status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId: company.id, jobId: job.id, fileUrl: "local:set.pdf" } });
  const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId: company.id, stage: "PAGE_INVENTORY", pageCount: Math.max(...pages) } });
  const bytes = readFileSync(pdf);
  const work = pageInventoryWork({ planId: plan.id, companyId: company.id, ingestJobId: ingest.id, jobId: job.id, startedByUserId: null }, { ...realDeps, readPlanBytes: async () => ({ ok: true as const, bytes }), planTextReadOn: async () => true });
  for (const n of pages) expect((await work({ id: `t${n}`, pageNumber: n, stage: "PAGE_INVENTORY", attempts: 1 })).ok).toBe(true);
  const rows = await prisma.planSheetProposal.findMany({ where: { planId: plan.id }, select: { pageNumber: true, proposedSheetNumber: true, proposedTitle: true } });
  return new Map(rows.map((r) => [r.pageNumber, r.proposedTitle]));
}
const skipped = (number: string, title: string | null | undefined) => takeoffSheetVerdict({ sheetNumber: number, title }).skipAutomatically;

describe.skipIf(!process.env.BAKER_PDF)("Baker: a legend heading no longer names a plan sheet", () => {
  it("A001 is the demolition plan and A111 the ceiling plan, and the whole-set run skips both; A100 and A101 still count", async () => {
    const named = await titles(process.env.BAKER_PDF!, [11, 12, 13, 14]);
    expect(named.get(11)).toBe("DEMOLITION PLAN");
    expect(named.get(14)).toBe("REFLECTED CEILING PLAN");
    expect([skipped("A001", named.get(11)), skipped("A111", named.get(14))]).toEqual([true, true]);
    expect([skipped("A100", named.get(12)), skipped("A101", named.get(13))]).toEqual([false, false]);
  }, 300_000);
});

describe.skipIf(!process.env.HPL_PDF)("HPL: partition plans named KEYNOTES stay measured", () => {
  it("I-110..I-112 are no longer called KEYNOTES, and none is skipped", async () => {
    const named = await titles(process.env.HPL_PDF!, [3, 4, 5]);
    for (const [n, number] of [[3, "I-110"], [4, "I-111"], [5, "I-112"]] as const) {
      expect(named.get(n)).not.toMatch(/KEYNOTE/i);
      expect(skipped(number, named.get(n))).toBe(false);
    }
  }, 300_000);
});
