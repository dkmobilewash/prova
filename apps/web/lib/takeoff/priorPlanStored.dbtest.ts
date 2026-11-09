import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { PRIOR_PLAN_READ, storedPriorsOf } from "./priorPlanLoad";

// Walk, 2026-11-08 (E Street A2.1 paired with A1.1): Run takeoff set 26 walls aside on
// the server and the screen never said so. The server's result is stored per page and
// read back for the pairing bar.
let planId = "";
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Prior Plan Stored Co" } });
  const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
  const job = await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Reno Job", status: "ESTIMATE" } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId: company.id, jobId: job.id, fileUrl: "local:plan.pdf", fileName: "plan.pdf" } });
  planId = plan.id;
});

describe("what the server's comparison set aside, read back for the screen", () => {
  it("returns each page's pairing result and skips a malformed row", async () => {
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 28, kind: PRIOR_PLAN_READ, value: { demoPage: 24, sheet: "A1.1", n: 26, feet: 485.9, why: null } } });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 30, kind: PRIOR_PLAN_READ, value: { demoPage: 25, sheet: "A1.2", n: 0, feet: 0, why: "the demolition plan has no drawing to compare with" } } });
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 31, kind: PRIOR_PLAN_READ, value: { sheet: "A1.3" } } });
    expect(await storedPriorsOf(planId)).toEqual({
      28: { demoPage: 24, sheet: "A1.1", n: 26, feet: 485.9, why: null },
      30: { demoPage: 25, sheet: "A1.2", n: 0, feet: 0, why: "the demolition plan has no drawing to compare with" },
    });
  });
});
