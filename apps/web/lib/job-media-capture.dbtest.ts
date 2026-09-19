import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@prova/db";

/**
 * The phone's photo upload against a real Postgres: where it was taken, what
 * it was taken for, the tags picked at the shutter, and the retry that must
 * not produce a second copy.
 *
 * The blob store is stubbed — this is about the row, and a test must not
 * write to a real bucket.
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
let putCalls = 0;
vi.mock("@vercel/blob", () => ({
  put: async (pathname: string) => {
    putCalls += 1;
    return { url: `https://teststore1.public.blob.vercel-storage.com/${pathname}` };
  },
}));

const media = await import("@/app/api/v1/jobs/[id]/media/route");

let jobId = "";
let otherJobId = "";
let reportId = "";
let punchItemId = "";
let tagId = "";

function upload(fields: Record<string, string | string[]>, job = jobId) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([1, 2, 3, 4])], "site.jpg", { type: "image/jpeg" }));
  for (const [key, value] of Object.entries(fields)) {
    for (const one of Array.isArray(value) ? value : [value]) form.append(key, one);
  }
  const request = new NextRequest(`http://test/api/v1/jobs/${job}/media`, { method: "POST", body: form });
  return media.POST(request, { params: Promise.resolve({ id: job }) });
}

describe("a photo taken on the phone", () => {
  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: "Photo Co" } });
    context.company.id = company.id;
    context.companyId = company.id;
    const owner = await prisma.user.create({
      data: { companyId: company.id, clerkId: `ph_${Date.now()}`, email: `ph_${Date.now()}@example.test`, role: "OWNER" },
    });
    context.id = owner.id;
    const contact = await prisma.contact.create({ data: { companyId: company.id, name: "GC" } });
    jobId = (await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Photo Job" } })).id;
    otherJobId = (await prisma.job.create({ data: { companyId: company.id, contactId: contact.id, name: "Other Job" } })).id;
    reportId = (
      await prisma.dailyFieldReport.create({
        data: { companyId: company.id, jobId, reportDate: new Date("2026-09-19T00:00:00Z"), workPerformed: "framing" },
      })
    ).id;
    punchItemId = (await prisma.punchListItem.create({ data: { companyId: company.id, jobId, description: "Patch L3" } })).id;
    tagId = (
      await prisma.jobMediaTag.create({ data: { companyId: company.id, name: "Before", normalizedName: "before" } })
    ).id;
  });

  afterAll(async () => {
    await prisma.jobMediaTagAssignment.deleteMany({ where: { tag: { companyId: context.company.id } } });
    await prisma.jobMedia.deleteMany({ where: { companyId: context.company.id } });
    await prisma.jobMediaTag.deleteMany({ where: { companyId: context.company.id } });
    await prisma.punchListItem.deleteMany({ where: { companyId: context.company.id } });
    await prisma.dailyFieldReport.deleteMany({ where: { companyId: context.company.id } });
    await prisma.job.deleteMany({ where: { companyId: context.company.id } });
    await prisma.contact.deleteMany({ where: { companyId: context.company.id } });
    await prisma.user.deleteMany({ where: { companyId: context.company.id } });
    await prisma.company.delete({ where: { id: context.company.id } });
    await prisma.$disconnect();
  });

  it("keeps where and when it was taken, what it was for, and its tags", async () => {
    const res = await upload({
      capturedAt: "2026-09-19T14:05:00.000Z",
      capturedLatitude: "45.5123456",
      capturedLongitude: "-122.6789012",
      capturedAccuracyMeters: "8.4",
      caption: "West wall before patch",
      dailyFieldReportId: reportId,
      punchListItemId: punchItemId,
      tagIds: [tagId],
      clientOperationId: "op-photo-1",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      // Rounded to the five decimals the server stores — about a metre.
      capturedLatitude: 45.51235,
      capturedLongitude: -122.6789,
      capturedAccuracyMeters: 8.4,
      dailyFieldReportId: reportId,
      punchListItemId: punchItemId,
      tags: [{ id: tagId, name: "Before" }],
    });
    expect(new Date(body.capturedAt).toISOString()).toBe("2026-09-19T14:05:00.000Z");
  });

  it("replays a retried upload instead of storing a second copy", async () => {
    const before = putCalls;
    const res = await upload({ capturedAt: "2026-09-19T14:05:00.000Z", clientOperationId: "op-photo-1" });
    expect(res.status).toBe(200);
    // The blob was not written again either: the replay is checked first.
    expect(putCalls).toBe(before);
    expect(await prisma.jobMedia.count({ where: { jobId } })).toBe(1);
  });

  it("refuses a report or punch item from another job, and a half a location", async () => {
    const otherReport = await prisma.dailyFieldReport.create({
      data: { companyId: context.company.id, jobId: otherJobId, reportDate: new Date("2026-09-19T00:00:00Z"), workPerformed: "x" },
    });
    expect((await upload({ capturedAt: "2026-09-19T14:05:00.000Z", dailyFieldReportId: otherReport.id })).status).toBe(400);
    const otherItem = await prisma.punchListItem.create({
      data: { companyId: context.company.id, jobId: otherJobId, description: "x" },
    });
    expect((await upload({ capturedAt: "2026-09-19T14:05:00.000Z", punchListItemId: otherItem.id })).status).toBe(400);
    expect((await upload({ capturedAt: "2026-09-19T14:05:00.000Z", capturedLatitude: "45.5" })).status).toBe(400);
    expect(await prisma.jobMedia.count({ where: { jobId } })).toBe(1);
  });

  it("takes a photo with no location at all — the photo is the point", async () => {
    const res = await upload({ capturedAt: "2026-09-19T15:00:00.000Z", clientOperationId: "op-photo-2" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ capturedLatitude: null, capturedAccuracyMeters: null, tags: [] });
  });

  it("keeps the photo when the day's report is deleted", async () => {
    await prisma.dailyFieldReport.delete({ where: { id: reportId } });
    const photo = await prisma.jobMedia.findFirstOrThrow({ where: { clientOperationId: "op-photo-1" } });
    expect(photo.dailyFieldReportId).toBeNull();
    expect(photo.punchListItemId).toBe(punchItemId);
  });
});
