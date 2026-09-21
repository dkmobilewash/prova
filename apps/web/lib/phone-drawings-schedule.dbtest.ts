import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@prova/db";

/**
 * The two read-only endpoints the phone gained for Gap 5, against a real
 * Postgres.
 *
 * The half that needs a database rather than a unit test is the DERIVED
 * attendance: `CrewScheduleDay` has no `attended` column on purpose, so
 * "planned and never logged" is a join between two tables and a date,
 * and the join is exactly where it can be wrong.
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

const drawings = await import("@/app/api/v1/jobs/[id]/drawings/route");
const schedule = await import("@/app/api/v1/jobs/[id]/schedule/route");

let jobId = "";
let crewId = "";

function get(mod: { GET: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response> }, query = "") {
  const request = new NextRequest(`http://test/api/v1/jobs/${jobId}/x${query}`);
  return mod.GET(request, { params: Promise.resolve({ id: jobId }) });
}

describe("drawings and the schedule, as the phone reads them", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Sheet Co" } });
    context.company.id = company.id;
    context.companyId = company.id;
    const owner = await prisma.user.create({
      data: {
        companyId: company.id,
        clerkId: `dr_${Date.now()}`,
        email: `dr_${Date.now()}@example.test`,
        role: "OWNER",
      },
    });
    context.id = owner.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Sheet Job" } })).id;
    crewId = (
      await prisma.crewMember.create({
        data: { companyId: company.id, legalFirstName: "Mike", legalLastName: "Ramirez" },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.timeEntry.deleteMany({ where: { jobId } });
    await prisma.crewScheduleDay.deleteMany({ where: { jobId } });
    await prisma.drawingRevision.deleteMany({ where: { set: { jobId } } });
    await prisma.drawingSet.deleteMany({ where: { jobId } });
    await prisma.crewMember.deleteMany({ where: { companyId: context.companyId } });
    await prisma.job.deleteMany({ where: { companyId: context.companyId } });
    await prisma.contact.deleteMany({ where: { companyId: context.companyId } });
    await prisma.user.deleteMany({ where: { companyId: context.companyId } });
    await prisma.company.delete({ where: { id: context.companyId } });
    await prisma.$disconnect();
  });

  it("says which revision governs and whether site has it", async () => {
    const set = await prisma.drawingSet.create({
      data: { companyId: context.companyId, jobId, name: "Architectural" },
    });
    await prisma.drawingRevision.createMany({
      data: [
        {
          setId: set.id,
          label: "Rev 1",
          issuedOn: new Date("2026-01-05T00:00:00.000Z"),
          receivedOn: new Date("2026-01-07T00:00:00.000Z"),
          fileUrl: "https://example.test/a.pdf",
          fileName: "A-rev1.pdf",
        },
        { setId: set.id, label: "Rev 2", issuedOn: new Date("2026-03-01T00:00:00.000Z") },
      ],
    });

    const body = await (await get(drawings)).json();
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ name: "Architectural", currentNotReceived: true });
    // Rev 2 governs and has not arrived; Rev 1 is what the crew holds.
    expect(body[0].revisions[0].label).toBe("Rev 2");
    expect(body[0].revisions[1].fileName).toBe("A-rev1.pdf");
  });

  it("derives a missing timecard from a planned day with no hours", async () => {
    // Two planned days in the past, one of which was worked.
    await prisma.crewScheduleDay.createMany({
      data: [
        { companyId: context.companyId, jobId, crewMemberId: crewId, workDate: new Date("2026-02-02T00:00:00.000Z") },
        { companyId: context.companyId, jobId, crewMemberId: crewId, workDate: new Date("2026-02-03T00:00:00.000Z") },
      ],
    });
    await prisma.timeEntry.create({
      // No companyId: a time entry is scoped by its job, not by the
      // company directly.
      data: { jobId, crewMemberId: crewId, date: new Date("2026-02-02T00:00:00.000Z"), hours: "8" },
    });

    const body = await (await get(schedule, "?from=2026-02-01&to=2026-02-05")).json();
    const byDate = Object.fromEntries(body.map((row: { workDate: string }) => [row.workDate, row]));
    expect(byDate["2026-02-02"]).toMatchObject({ workerName: "Mike Ramirez", hoursLogged: true });
    // The one nobody logged — the whole reason this screen shows the past.
    expect(byDate["2026-02-03"]).toMatchObject({ hoursLogged: false });
  });

  it("takes the VIEWER'S day, so an evening in Albuquerque is not tomorrow", async () => {
    // The device bug, 2026-09-20: at 18:03 Mountain the UTC date is
    // already the 21st, so today's planned day came back as past with no
    // hours — an accusation aimed at a day still being worked.
    await prisma.crewScheduleDay.create({
      data: {
        companyId: context.companyId,
        jobId,
        crewMemberId: crewId,
        workDate: new Date("2026-02-10T00:00:00.000Z"),
      },
    });

    // TODAY IS NOT OVER, so nothing is claimed about it. The first
    // version of this test asserted `false` here — it encoded the bug it
    // was written to prevent, which is worth more as a warning than the
    // assertion is as a check: at 18:03 nobody has filed today's hours,
    // and "no hours logged" is an accusation about a shift still being
    // worked.
    const sameDay = await (await get(schedule, "?from=2026-02-10&to=2026-02-10&today=2026-02-10")).json();
    expect(sameDay[0].hoursLogged).toBeNull();

    // Tomorrow, from the viewer's position: also nothing.
    const notYet = await (await get(schedule, "?from=2026-02-10&to=2026-02-10&today=2026-02-09")).json();
    expect(notYet[0].hoursLogged).toBeNull();

    // The day AFTER it ends is when the question becomes a fact.
    const over = await (await get(schedule, "?from=2026-02-10&to=2026-02-10&today=2026-02-11")).json();
    expect(over[0].hoursLogged).toBe(false);
  });

  it("refuses a today that is not a date", async () => {
    expect((await get(schedule, "?from=2026-02-01&to=2026-02-05&today=yesterday")).status).toBe(400);
  });

  it("does not accuse a future day of having no hours", async () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 3);
    const day = future.toISOString().slice(0, 10);
    await prisma.crewScheduleDay.create({
      data: {
        companyId: context.companyId,
        jobId,
        crewMemberId: crewId,
        workDate: new Date(`${day}T00:00:00.000Z`),
      },
    });

    const body = await (await get(schedule, `?from=${day}&to=${day}`)).json();
    expect(body[0]).toMatchObject({ workDate: day, hoursLogged: null });
  });

  it("refuses a nonsense window rather than guessing", async () => {
    expect((await get(schedule, "?from=nonsense&to=2026-02-05")).status).toBe(400);
    expect((await get(schedule, "?from=2026-02-05&to=2026-02-01")).status).toBe(400);
  });

  it("refuses both endpoints for another company's job", async () => {
    const other = await prisma.company.create({ data: { name: "Other Co" } });
    const otherContact = await prisma.contact.create({ data: { companyId: other.id, name: "GC" } });
    const otherJob = await prisma.job.create({
      data: { companyId: other.id, contactId: otherContact.id, name: "Not ours" },
    });

    const request = new NextRequest(`http://test/api/v1/jobs/${otherJob.id}/x`);
    const params = { params: Promise.resolve({ id: otherJob.id }) };
    expect((await drawings.GET(request, params)).status).toBe(400);
    expect((await schedule.GET(request, params)).status).toBe(400);

    await prisma.job.delete({ where: { id: otherJob.id } });
    await prisma.contact.delete({ where: { id: otherContact.id } });
    await prisma.company.delete({ where: { id: other.id } });
  });
});
