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

const { draftChangeOrderFromTmTicket } = await import("./actions/changeOrders");

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
          labor: [{ workerName: "Ana Ruiz", hours: "8", payType: "REGULAR", craftLabel: "Carpenter JM", lineItemDescription: null }],
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
    expect(text).toContain("Ana Ruiz — 8 h, regular, Carpenter JM");
    expect(text).toContain("40 sheets 5/8 type X — Foundation");
    // Signed at 22:12Z on a Denver site: 4:12 PM MDT, the site's own clock.
    expect(text).toContain("signed on site by Sam Patel, Sep 10, 2026, 4:12 PM MDT (drawn signature on file)");
    expect(text).toContain("Photos: 1 job photo captured on 2026-09-10");
    expect(text).toContain("Not priced.");
    // No proposals: pricing is the open decision.
    expect(await prisma.changeOrderProposal.count({ where: { changeOrderId: linked.changeOrderId! } })).toBe(0);

    expect(await draftChangeOrderFromTmTicket(ticketId)).toMatchObject({ ok: false });
    expect(await prisma.changeOrder.count({ where: { jobId } })).toBe(1);
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
