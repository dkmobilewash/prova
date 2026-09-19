import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@prova/db";

/**
 * Gap 2 against a real Postgres: a signed day locks its daily report and its
 * delays along with its hours, through every door the app has and through
 * the database itself; the weather and a drafted change order are the two
 * things allowed through; and the sign-off freezes the crew and the report.
 *
 * The job has no site coordinates, so nothing here calls the weather
 * service — its own behaviour is unit-tested in lib/weather.test.ts.
 */

const context = {
  company: { id: "" },
  companyId: "",
  id: "",
  role: "OWNER" as string,
  jobFunction: null as string | null,
};

vi.mock("@/lib/auth", () => ({
  requireCompanyContext: async () => context,
  requireApiContext: async () => context,
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { createDailyFieldReport, updateDailyFieldReport, deleteDailyFieldReport } = await import("./actions/fieldReports");
const { logDelay, removeDelay } = await import("./actions/delays");
const { draftChangeOrderFromDelay } = await import("./actions/changeOrders");
const signoffs = await import("@/app/api/v1/jobs/[id]/signoffs/route");
const delaysRoute = await import("@/app/api/v1/jobs/[id]/delays/route");

const DAY = "2026-09-10";
let jobId = "";
let reportId = "";

function form(values: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(values)) fd.set(k, v);
  return fd;
}
const post = (url: string, body: unknown) => new NextRequest(`http://test${url}`, { method: "POST", body: JSON.stringify(body) });
const params = () => ({ params: Promise.resolve({ id: jobId }) });

describe("a signed day locks its daily report and delays", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Report Lock Co" } });
    context.company.id = company.id;
    context.companyId = company.id;
    const owner = await prisma.user.create({
      data: { companyId: company.id, clerkId: `rl_${Date.now()}`, email: `rl_${Date.now()}@example.test`, role: "OWNER" },
    });
    context.id = owner.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    const job = await prisma.job.create({
      data: { companyId: company.id, contactId: contact.id, name: "Report Lock Job", status: "CONTRACTED" },
    });
    jobId = job.id;
    const local = await prisma.unionLocal.create({
      data: { companyId: company.id, parentInternational: "UBC", localNumber: "ZZ1", jurisdictionName: "Test" },
    });
    const craft = await prisma.craftClassification.create({
      data: { companyId: company.id, unionLocalId: local.id, name: "Carpenter JM" },
    });
    const crew = await prisma.crewMember.create({ data: { companyId: company.id, legalFirstName: "Ana", legalLastName: "Ruiz" } });
    await prisma.timeEntry.createMany({
      data: [
        { jobId, employeeUserId: owner.id, date: new Date(`${DAY}T00:00:00Z`), hours: "8", craftClassificationId: craft.id },
        { jobId, crewMemberId: crew.id, date: new Date(`${DAY}T00:00:00Z`), hours: "6", craftClassificationId: craft.id },
      ],
    });
  });

  afterAll(async () => {
    await prisma.timesheetSignoff.deleteMany({ where: { jobId } });
    await prisma.delayEvent.deleteMany({ where: { jobId } });
    await prisma.changeOrder.deleteMany({ where: { jobId } });
    await prisma.changeOrderCounter.deleteMany({ where: { jobId } });
    await prisma.dailyFieldReport.deleteMany({ where: { jobId } });
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.crewMember.deleteMany({ where: { companyId: context.company.id } });
    await prisma.craftClassification.deleteMany({ where: { companyId: context.company.id } });
    await prisma.unionLocal.deleteMany({ where: { companyId: context.company.id } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("files a report and a delay while the day is open", async () => {
    expect(
      await createDailyFieldReport(jobId, form({ reportDate: DAY, workPerformed: "Framed L3 corridor", crewPresent: "Electricians on L3" })),
    ).toEqual({ ok: true });
    reportId = (await prisma.dailyFieldReport.findFirstOrThrow({ where: { jobId } })).id;

    expect(
      await logDelay(
        jobId,
        form({ date: DAY, cause: "MATERIAL", responsibleParty: "SUPPLIER", description: "Studs late", workersAffected: "2", startTime: "7:00", endTime: "9:00", gcNotifiedHow: "PHONE", gcNotifiedWho: "Sam" }),
      ),
    ).toEqual({ ok: true });
    const delay = await prisma.delayEvent.findFirstOrThrow({ where: { jobId } });
    expect(Number(delay.hoursLost)).toBe(4);
    expect(delay.gcNotifiedAt).not.toBeNull();
  });

  it("keeps an older report's typed delays when an edit doesn't send them", async () => {
    await prisma.dailyFieldReport.update({ where: { id: reportId }, data: { delays: "legacy typed delay" } });
    expect(await updateDailyFieldReport(reportId, form({ workPerformed: "Framed L3 corridor and stair", crewPresent: "Electricians on L3" }))).toEqual({ ok: true });
    expect((await prisma.dailyFieldReport.findUniqueOrThrow({ where: { id: reportId } })).delays).toBe("legacy typed delay");
  });

  it("freezes the crew and the report into the sign-off", async () => {
    const res = await signoffs.POST(post(`/api/v1/jobs/${jobId}/signoffs`, { date: DAY, signerName: "Fred", signaturePath: "M1 1L9 9" }), params());
    expect(res.status).toBe(201);
    const signoff = await prisma.timesheetSignoff.findFirstOrThrow({ where: { jobId } });
    expect(signoff.manpower).toMatchObject({ headcount: 2, hours: 14, byCraft: [{ craft: "Carpenter JM", headcount: 2, hours: 14 }] });
    expect(signoff.reportSnapshot).toMatchObject({
      report: { workPerformed: "Framed L3 corridor and stair", otherTradesOnSite: "Electricians on L3" },
      delays: [{ cause: "MATERIAL", hoursLost: "4" }],
    });
  });

  it("refuses report and delay changes on the signed day, through the app and the database", async () => {
    expect(await updateDailyFieldReport(reportId, form({ workPerformed: "changed" }))).toMatchObject({ ok: false });
    expect(await deleteDailyFieldReport(reportId)).toMatchObject({ ok: false });
    expect(await logDelay(jobId, form({ date: DAY, cause: "WEATHER", responsibleParty: "NOBODY", description: "rain" }))).toMatchObject({ ok: false });
    const phone = await delaysRoute.POST(
      post(`/api/v1/jobs/${jobId}/delays`, { date: DAY, cause: "WEATHER", responsibleParty: "NOBODY", description: "rain" }),
      params(),
    );
    expect(phone.status).toBe(409);
    const delay = await prisma.delayEvent.findFirstOrThrow({ where: { jobId } });
    expect(await removeDelay(delay.id)).toMatchObject({ ok: false });

    await expect(prisma.dailyFieldReport.update({ where: { id: reportId }, data: { workPerformed: "raw" } })).rejects.toThrow(/signed and locked/);
    await expect(prisma.delayEvent.delete({ where: { id: delay.id } })).rejects.toThrow(/signed and locked/);
  });

  it("still lets the weather arrive and a change order be drafted on a signed day", async () => {
    await prisma.dailyFieldReport.update({ where: { id: reportId }, data: { weatherAuto: { kind: "observed", summary: "Rain" } } });
    const delay = await prisma.delayEvent.findFirstOrThrow({ where: { jobId } });
    expect(await draftChangeOrderFromDelay(delay.id)).toEqual({ ok: true });
    const linked = await prisma.delayEvent.findUniqueOrThrow({ where: { id: delay.id }, include: { changeOrder: true } });
    expect(linked.changeOrder).toMatchObject({ status: "DRAFT", title: `Delay ${DAY}: Material late or wrong` });
    expect(linked.changeOrder?.description).toContain("Crew-hours lost: 4.");
    expect(linked.changeOrder?.description).toContain("GC notified by phone (Sam)");
    expect(await draftChangeOrderFromDelay(delay.id)).toMatchObject({ ok: false });
    expect(await removeDelay(delay.id)).toMatchObject({ ok: false });
  });

  it("opens back up after a reopen", async () => {
    await prisma.timesheetSignoff.updateMany({ where: { jobId, reopenedAt: null }, data: { reopenedAt: new Date(), reopenReason: "fix" } });
    expect(await updateDailyFieldReport(reportId, form({ workPerformed: "Framed L3 corridor, stair and landing" }))).toEqual({ ok: true });
    expect(await logDelay(jobId, form({ date: DAY, cause: "WEATHER", responsibleParty: "NOBODY", description: "rain after lunch" }))).toEqual({ ok: true });
  });
});
