import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Against a real Postgres: quantities save with their report, totals derive,
 * an edit that says nothing leaves them, another job's line is refused, and the
 * signed-day lock holds for them too.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createFieldReport, updateFieldReport } = await import("./field-reports-core");
const { loadInstallLines } = await import("./installed-quantities-query");

let companyId = "", jobId = "", otherJobId = "", userId = "", board = "", track = "", lump = "";
const company = () => ({ id: companyId });
const file = (reportDate: string, installed?: unknown) =>
  createFieldReport(company(), userId, { jobId, reportDate, workPerformed: "Hung board", installed });
const reportOf = (result: Awaited<ReturnType<typeof file>>) => {
  if (!result.ok) throw new Error(result.error);
  return result.value.report.id;
};
const rows = (reportId: string) =>
  prisma.dailyReportInstalledQuantity.findMany({ where: { reportId }, orderBy: { lineItemId: "asc" } });

describe("installed quantities", () => {
  beforeAll(async () => {
    companyId = (await prisma.company.create({ data: { name: "Installed Co" } })).id;
    userId = (await prisma.user.create({ data: { companyId, clerkId: `iq_${Date.now()}`, email: `iq_${Date.now()}@example.test`, role: "OWNER" } })).id;
    const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
    const job = (name: string) => prisma.job.create({ data: { companyId, contactId: contact.id, name, status: "CONTRACTED" } });
    jobId = (await job("Main")).id;
    otherJobId = (await job("Other")).id;
    const line = (data: { jobId: string; description: string; unit: string; quantity: string }) => prisma.jobLineItem.create({ data });
    board = (await line({ jobId, description: "Board", unit: "SF", quantity: "10000" })).id;
    track = (await line({ jobId: otherJobId, description: "Track", unit: "LF", quantity: "500" })).id;
    lump = (await line({ jobId, description: "Mobilization", unit: "LS", quantity: "1" })).id;
  });

  afterAll(async () => {
    await prisma.timesheetSignoff.deleteMany({ where: { jobId } });
    await prisma.dailyFieldReport.deleteMany({ where: { companyId } });
    await prisma.jobLineItem.deleteMany({ where: { jobId: { in: [jobId, otherJobId] } } });
    await prisma.job.deleteMany({ where: { companyId } });
    await prisma.contact.deleteMany({ where: { companyId } });
    await prisma.user.deleteMany({ where: { companyId } });
    await prisma.company.delete({ where: { id: companyId } });
    await prisma.$disconnect();
  });

  it("saves with the report and totals to date, only for lines that take one", async () => {
    await file("2026-10-01", [{ lineItemId: board, quantity: "400" }]);
    await file("2026-10-02", [{ lineItemId: board, quantity: "600.5" }]);
    const lines = (await loadInstallLines([jobId])).get(jobId);
    expect(lines?.map((line) => [line.description, line.installedToDate])).toEqual([["Board", 1000.5]]);
    expect(lines?.some((line) => line.id === lump)).toBe(false);
  });

  it("files a report with none, as every report before this did", async () => {
    const id = reportOf(await file("2026-10-03"));
    expect(await rows(id)).toEqual([]);
  });

  it("refuses another job's line and a bad figure, and files nothing", async () => {
    expect(await file("2026-10-04", [{ lineItemId: track, quantity: "5" }])).toMatchObject({ ok: false, error: expect.stringContaining("not on this job") });
    expect(await file("2026-10-04", [{ lineItemId: board, quantity: "lots" }])).toMatchObject({ ok: false });
    expect(await prisma.dailyFieldReport.count({ where: { jobId, reportDate: new Date("2026-10-04T00:00:00Z") } })).toBe(0);
  });

  it("replaces on an edit that sends them, and keeps them on one that does not", async () => {
    const id = reportOf(await file("2026-10-05", [{ lineItemId: board, quantity: "100" }]));
    const edit = (installed?: unknown) => updateFieldReport(company(), id, { workPerformed: "Edited", installed });
    await edit();
    expect((await rows(id)).map((row) => Number(row.quantity))).toEqual([100]);
    await edit([{ lineItemId: board, quantity: "150" }]);
    expect((await rows(id)).map((row) => Number(row.quantity))).toEqual([150]);
    await edit([{ lineItemId: board, quantity: "" }]);
    expect(await rows(id)).toEqual([]);
  });

  it("goes when its report goes, so a total never counts a deleted day", async () => {
    const total = async () => (await loadInstallLines([jobId])).get(jobId)?.[0].installedToDate ?? 0;
    const before = await total();
    const id = reportOf(await file("2026-10-06", [{ lineItemId: board, quantity: "999" }]));
    expect(await total()).toBe(before + 999);
    await prisma.dailyFieldReport.delete({ where: { id } });
    expect(await total()).toBe(before);
  });

  it("is refused on a signed day, and the trigger holds if the app's check is beaten", async () => {
    const id = reportOf(await file("2026-10-07", [{ lineItemId: board, quantity: "10" }]));
    await prisma.timesheetSignoff.create({
      data: { companyId, jobId, date: new Date("2026-10-07T00:00:00Z"), signerName: "Foreman", signaturePath: "M1 1", signedAt: new Date(), entryCount: 0, totalHours: 0 },
    });
    expect(await updateFieldReport(company(), id, { workPerformed: "Late", installed: [{ lineItemId: board, quantity: "20" }] })).toMatchObject({ ok: false });
    // Same text, only the quantity moved. The trigger ignores this edit because
    // the report's own columns do not change, so this is the app's check alone.
    expect(await updateFieldReport(company(), id, { workPerformed: "Hung board", installed: [{ lineItemId: board, quantity: "20" }] })).toMatchObject({ ok: false });
    expect((await rows(id)).map((row) => Number(row.quantity))).toEqual([10]);
    // The write the core makes, with its check out of the way.
    await expect(
      prisma.dailyFieldReport.update({
        where: { id },
        data: { workPerformed: "Late", installedQuantities: { deleteMany: {}, create: [{ lineItemId: board, quantity: 20 }] } },
      }),
    ).rejects.toThrow(/signed and locked/);
    expect((await rows(id)).map((row) => Number(row.quantity))).toEqual([10]);
  });
});
