import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { loadPilotMetrics, type PilotRow } from "./pilotMetrics";

// The pilot dashboard's figures, counted from rows the product writes, for two
// pilot companies whose every figure this file can state; the operating company
// is never a row; the sample job and anything older than 7 days stay out of the
// figures they must stay out of.
const NOW = new Date("2026-11-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);
const tag = `${Date.now()}`;
let a = "";
let b = "";
let operator = "";

async function company(name: string, isProvaOperator = false) {
  const id = (await prisma.company.create({ data: { name: `${name} ${tag}`, isProvaOperator } })).id;
  const contact = await prisma.contact.create({ data: { companyId: id, name: "GC" } });
  return { id, contactId: contact.id };
}

beforeAll(async () => {
  const A = await company("Pilot A");
  const B = await company("Pilot B");
  const O = await company("Operator", true);
  a = A.id;
  b = B.id;
  operator = O.id;
  await prisma.user.create({ data: { companyId: a, clerkId: `pa_${tag}`, email: `pa_${tag}@a.test`, role: "OWNER", lastSeenAt: hoursAgo(1) } });

  // A: a real job with a plan, a sheet with walls (one typed by a person, one auto-posted), a bid sent 3 h after the upload.
  const job = await prisma.job.create({ data: { companyId: a, contactId: A.contactId, name: "A real job", status: "ESTIMATE", createdAt: hoursAgo(30) } });
  const plan = await prisma.takeoffPlan.create({ data: { companyId: a, jobId: job.id, fileUrl: "local:a.pdf", fileName: "a.pdf", createdAt: hoursAgo(10) } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId: plan.id, pageNumber: 1 } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  for (const label of ["W1 wall (set by hand)", "W1 wall (auto, from printed tag)", "wall, untyped"]) {
    await prisma.takeoffMeasurement.create({ data: { pageId: page.id, calibrationId: cal.id, kind: "LINEAR", source: "DETECTED", xs: [0, 1], ys: [0, 0], label } });
  }
  await prisma.signatureRequest.create({ data: { jobId: job.id, token: `tok_${tag}`, createdAt: hoursAgo(7) } });
  // A's sample job and its plan: in no figure.
  const sample = await prisma.job.create({ data: { companyId: a, contactId: A.contactId, name: "Sample", status: "ESTIMATE", isSample: true } });
  const samplePlan = await prisma.takeoffPlan.create({ data: { companyId: a, jobId: sample.id, fileUrl: "sample:office", fileName: "s.pdf" } });
  const samplePage = await prisma.takeoffPlanPage.create({ data: { planId: samplePlan.id, pageNumber: 1 } });
  const sampleCal = await prisma.takeoffScaleCalibration.create({ data: { pageId: samplePage.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffMeasurement.create({ data: { pageId: samplePage.id, calibrationId: sampleCal.id, kind: "LINEAR", source: "DETECTED", xs: [0, 1], ys: [0, 0], label: "W1 wall (set by hand)" } });
  // A: one problem report today, one 10 days ago, and a help question (not a report).
  const mail = (subject: string, createdAt: Date) =>
    prisma.outboundMessage.create({ data: { companyId: a, channel: "EMAIL", toAddress: "s@x.test", fromAddress: "n@x.test", body: "b", subject, relatedType: "HELP_REQUEST", createdAt } });
  await mail(`Problem report — Pilot A — /takeoff/${job.id}`, hoursAgo(2));
  await mail("Problem report — Pilot A — /jobs", hoursAgo(240));
  await mail("Help — Pilot A — /jobs", hoursAgo(2));
  // A: errors today (a plan page and a failed email), and an old one that is out of the window.
  const ingest = await prisma.planIngestJob.create({ data: { planId: plan.id, companyId: a, stage: "TITLE_BLOCK", pageCount: 2 } });
  await prisma.planIngestTask.create({ data: { jobId: ingest.id, pageNumber: 1, stage: "TITLE_BLOCK", error: "the model refused" } });
  const failed = await mail("Proposal", hoursAgo(3));
  await prisma.outboundMessageEvent.create({ data: { messageId: failed.id, type: "FAILED", occurredAt: hoursAgo(3) } });
  const old = await mail("Old proposal", hoursAgo(300));
  await prisma.outboundMessageEvent.create({ data: { messageId: old.id, type: "BOUNCED", occurredAt: hoursAgo(300) } });

  // B: one job, nothing else.
  await prisma.job.create({ data: { companyId: b, contactId: B.contactId, name: "B job", status: "ESTIMATE", createdAt: hoursAgo(50) } });
  // The operator's own job, which must not make it a row.
  await prisma.job.create({ data: { companyId: operator, contactId: O.contactId, name: "Ours", status: "ESTIMATE" } });
});

describe("the pilot dashboard's figures", () => {
  let rows: PilotRow[] = [];
  const row = (id: string) => rows.find((r) => r.companyId === id);

  beforeAll(async () => {
    rows = await loadPilotMetrics(NOW);
  });

  it("counts each pilot's own activity, and only theirs, leaving the sample out", () => {
    expect(row(a)).toMatchObject({
      jobs: 1,
      planSets: 1,
      sheetsTakenOff: 1,
      wallsTypedByPerson: 1,
      autoPosted: 1,
      uploadToBidHours: 3,
      bidsSent: 1,
      problemReports: 2,
      problemReports7d: 1,
      planReadErrors7d: 1,
      emailErrors7d: 1,
    });
    expect(row(a)!.lastActivity).toEqual(hoursAgo(1));
    expect(row(b)).toMatchObject({ jobs: 1, planSets: 0, sheetsTakenOff: 0, wallsTypedByPerson: 0, autoPosted: 0, uploadToBidHours: null, bidsSent: 0, problemReports: 0, planReadErrors7d: 0, emailErrors7d: 0 });
    expect(row(b)!.lastActivity).toEqual(hoursAgo(50));
  });

  it("never lists Prova's own operating company, and orders by last activity", () => {
    expect(row(operator)).toBeUndefined();
    const ours = rows.filter((r) => r.companyId === a || r.companyId === b).map((r) => r.companyId);
    expect(ours).toEqual([a, b]);
  });
});
