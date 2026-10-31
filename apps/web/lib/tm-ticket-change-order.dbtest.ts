import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * A signed T&M ticket starts exactly one DRAFT change order, carrying the
 * ticket's frozen snapshot rather than today's time entries. Modelled on the
 * delay half of daily-report-lock.dbtest.ts, against a real Postgres, so the
 * conditional link (two clicks, one draft) is exercised on the real
 * constraint rather than a mock.
 */

const context = { company: { id: "" }, companyId: "", id: "", role: "OWNER" as string, jobFunction: null as string | null };

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
  requireApiContext: async () => context,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { draftChangeOrderFromTmTicket, proposeAddedScope, approveChangeOrder, createChangeOrder, submitChangeOrder } =
  await import("./actions/changeOrders");
const { bidRecap } = await import("@/lib/bid-recap");

const DAY = "2026-09-10";
let jobId = "";
let ticketId = "";

describe("a T&M ticket drafts one change order", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "TM Draft Co" } });
    context.company.id = company.id;
    context.companyId = company.id;
    const owner = await prisma.user.create({
      data: { companyId: company.id, clerkId: `tm_${Date.now()}`, email: `tm_${Date.now()}@example.test`, role: "OWNER" },
    });
    context.id = owner.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "TM Draft Job", status: "CONTRACTED", siteTimeZone: "America/Denver" },
    });
    jobId = job.id;
    // Pricing inputs: a craft with a wage schedule covering the work date,
    // a burden rate in force, and this job's own recap rates.
    const local = await prisma.unionLocal.create({
      data: { companyId: company.id, parentInternational: "UBC", localNumber: "ZZ9", jurisdictionName: "Test" },
    });
    const craft = await prisma.craftClassification.create({
      data: { companyId: company.id, unionLocalId: local.id, name: "Carpenter JM" },
    });
    await prisma.fringeRateSchedule.create({
      data: {
        companyId: company.id,
        craftClassificationId: craft.id,
        baseWage: "42.10",
        pensionRate: "6.50",
        vacationRate: "2.20",
        healthWelfareRate: "9.80",
        trainingRate: "0.60",
        effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await prisma.employerBurdenRate.create({
      data: { companyId: company.id, effectiveDate: new Date("2026-01-01T00:00:00Z"), percent: "31.250" },
    });
    await prisma.jobBidRecap.create({
      data: { companyId: company.id, jobId, laborMarkupPercent: "15", materialMarkupPercent: "12", overheadPercent: "10", profitPercent: "8" },
    });
    // A photo on the work date and one the day after: only the first counts.
    await prisma.jobMedia.createMany({
      data: [
        { companyId: company.id, jobId, blobUrl: "https://x.test/a.jpg", contentType: "image/jpeg", byteSize: 1, capturedAt: new Date(`${DAY}T15:00:00Z`) },
        { companyId: company.id, jobId, blobUrl: "https://x.test/b.jpg", contentType: "image/jpeg", byteSize: 1, capturedAt: new Date(`2026-09-11T01:00:00Z`) },
      ],
    });
    const ticket = await prisma.tmTicket.create({
      data: {
        companyId: company.id,
        jobId,
        workDate: new Date(`${DAY}T00:00:00Z`),
        workDescription: "Reframed the L3 corridor soffit after the duct moved",
        // FROZEN at signing. No time entries exist on this job at all, so a
        // draft that re-read the day's entries would say zero hours.
        snapshot: {
          labor: [
            { workerName: "Ana Ruiz", hours: "8", payType: "STRAIGHT", craftLabel: "Carpenter JM", lineItemDescription: null },
            { workerName: "Luis Ortega", hours: "2.5", payType: "OVERTIME", craftLabel: "Laborer", lineItemDescription: null },
          ],
          materials: [{ description: "40 sheets 5/8 type X", vendorName: "Foundation", orderedOn: DAY }],
        },
        signerName: "Sam Patel",
        signedAt: new Date(`${DAY}T22:12:00Z`),
        signaturePath: "M 1 1 L 2 2",
        createdByUserId: owner.id,
      },
    });
    ticketId = ticket.id;
  });

  afterAll(async () => {
    await prisma.tmTicket.deleteMany({ where: { jobId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId } });
    await prisma.changeOrderProposal.deleteMany({ where: { changeOrder: { jobId } } });
    await prisma.jobBidRecap.deleteMany({ where: { jobId } });
    await prisma.employerBurdenRate.deleteMany({ where: { companyId: context.company.id } });
    await prisma.fringeRateSchedule.deleteMany({ where: { companyId: context.company.id } });
    await prisma.craftClassification.deleteMany({ where: { companyId: context.company.id } });
    await prisma.unionLocal.deleteMany({ where: { companyId: context.company.id } });
    await prisma.changeOrder.deleteMany({ where: { jobId } });
    await prisma.changeOrderCounter.deleteMany({ where: { jobId } });
    await prisma.jobMedia.deleteMany({ where: { jobId } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("creates a DRAFT from the frozen snapshot, links the ticket, and refuses a second", async () => {
    expect(await draftChangeOrderFromTmTicket(ticketId)).toEqual({ ok: true });

    const linked = await prisma.tmTicket.findUniqueOrThrow({ where: { id: ticketId }, include: { changeOrder: true } });
    expect(linked.changeOrder).toMatchObject({
      status: "DRAFT",
      number: 1,
      title: `T&M ${DAY}: Reframed the L3 corridor soffit after the duct moved`,
    });
    const text = linked.changeOrder?.description ?? "";
    expect(text).toContain("Ana Ruiz — 8 h, straight time, Carpenter JM");
    expect(text).toContain("40 sheets 5/8 type X — Foundation");
    // Signed at 22:12Z on a Denver site: 4:12 PM MDT, the site's own clock.
    expect(text).toContain("signed on site by Sam Patel, Sep 10, 2026, 4:12 PM MDT (drawn signature on file)");
    expect(text).toContain("Photos: 1 job photo captured on 2026-09-10");

    // THE PRICED LINES, option A. Ana's craft has a wage: her hour is
    // 42.10 wage + 19.10 fringes + 31.25% burden on the wage (13.16) =
    // 74.36, and 8 h of that through this job's recap (labor 15%, overhead
    // 10%, profit 8%) — the expected figure is computed by the recap, not
    // typed. Luis's craft has no wage: hours kept, no cost, no price, says
    // why. The material lands unpriced for the person to cost.
    const proposals = await prisma.changeOrderProposal.findMany({
      where: { changeOrderId: linked.changeOrderId! },
      orderBy: { createdAt: "asc" },
    });
    expect(proposals.map((p) => [p.changeType, p.costCategory, p.unit, Number(p.quantity)])).toEqual([
      ["ADD", "LABOR", "hr", 8],
      ["ADD", "LABOR", "hr", 2.5],
      ["ADD", "MATERIAL", null, 1],
    ]);
    const [ana, luis, board] = proposals;
    expect(ana.budgetedUnitCost?.toFixed(2)).toBe("74.36");
    const expectedSell = bidRecap(
      [{ id: "a", quantity: 8, unitCost: 74.36, unitPrice: null, costCategory: "LABOR" }],
      { laborMarkupPercent: 15, materialMarkupPercent: 12, overheadPercent: 10, profitPercent: 8 },
    ).bidTotal;
    expect(ana.unitPrice?.toFixed(2)).toBe((Math.round((expectedSell / 8) * 100) / 100).toFixed(2));
    expect(ana.description).toContain("$42.10/h wage + fringes $19.10/h + 31.25% burden on the wage $13.16 = $74.36/h");
    expect(luis.budgetedUnitCost).toBeNull();
    expect(luis.unitPrice).toBeNull();
    expect(luis.description).toContain("UNPRICED: no wage on file for Laborer");
    expect(board.budgetedUnitCost).toBeNull();
    expect(board.unitPrice).toBeNull();

    expect(await draftChangeOrderFromTmTicket(ticketId)).toMatchObject({ ok: false });
    expect(await prisma.changeOrder.count({ where: { jobId } })).toBe(1);
  });

  it("prices an added line from the recap when the price is left blank, and the approved line keeps its category", async () => {
    const fd = new FormData();
    fd.set("title", "Equipment for the soffit");
    expect(await createChangeOrder(jobId, fd)).toEqual({ ok: true });
    const co = await prisma.changeOrder.findFirstOrThrow({ where: { jobId, title: "Equipment for the soffit" } });

    const add = new FormData();
    add.set("itemDescription", "Scissor lift, 1 week");
    add.set("unit", "wk");
    add.set("quantity", "1");
    add.set("budgetedUnitCost", "1000");
    add.set("costCategory", "EQUIPMENT");
    expect(await proposeAddedScope(co.id, add)).toEqual({ ok: true });
    const proposal = await prisma.changeOrderProposal.findFirstOrThrow({ where: { changeOrderId: co.id } });
    // No equipment markup on this job's recap, so overhead 10% then profit 8% on 1,000: 1,100 → 1,188.
    expect(proposal.unitPrice?.toFixed(2)).toBe("1188.00");
    expect(proposal.costCategory).toBe("EQUIPMENT");

    // Typed price wins over the recap.
    const typed = new FormData();
    typed.set("itemDescription", "Typed");
    typed.set("quantity", "1");
    typed.set("budgetedUnitCost", "1000");
    typed.set("unitPrice", "1500");
    typed.set("costCategory", "EQUIPMENT");
    expect(await proposeAddedScope(co.id, typed)).toEqual({ ok: true });
    const typedRow = await prisma.changeOrderProposal.findFirstOrThrow({ where: { changeOrderId: co.id, description: "Typed" } });
    expect(typedRow.unitPrice?.toFixed(2)).toBe("1500.00");

    const send = new FormData();
    send.set("submittedOn", DAY);
    expect(await submitChangeOrder(co.id, send)).toEqual({ ok: true });
    const decide = new FormData();
    decide.set("decidedOn", DAY);
    expect(await approveChangeOrder(co.id, decide)).toEqual({ ok: true });
    const line = await prisma.jobLineItem.findFirstOrThrow({ where: { jobId, description: "Scissor lift, 1 week" } });
    expect(line.costCategory).toBe("EQUIPMENT");
    expect(line.unitPrice?.toFixed(2)).toBe("1188.00");
  });

  it("refuses a ticket from another company in the same words as a missing one", async () => {
    const other = await prisma.company.create({ data: { name: "Other Co" } });
    const contact = await prisma.contact.create({ data: { companyId: other.id, name: "GC2" } });
    const job = await prisma.job.create({ data: { companyId: other.id, contactId: contact.id, name: "Other job", status: "CONTRACTED" } });
    const ticket = await prisma.tmTicket.create({
      data: { companyId: other.id, jobId: job.id, workDate: new Date(`${DAY}T00:00:00Z`), workDescription: "x", snapshot: {}, signerName: "A", signedAt: new Date() },
    });
    try {
      const result = await draftChangeOrderFromTmTicket(ticket.id);
      expect(result).toEqual({ ok: false, error: "That ticket is gone. Reload the page." });
      expect(await prisma.changeOrder.count({ where: { jobId: job.id } })).toBe(0);
    } finally {
      await prisma.tmTicket.deleteMany({ where: { jobId: job.id } });
      await prisma.job.delete({ where: { id: job.id } });
      await prisma.contact.delete({ where: { id: contact.id } });
      await prisma.company.delete({ where: { id: other.id } });
    }
  });
});
