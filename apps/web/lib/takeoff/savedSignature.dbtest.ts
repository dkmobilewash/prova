import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@prova/db";
import { takeoffSavedSignature } from "./workspaceLoad";

/**
 * ── "THIS TAKEOFF CHANGED IN ANOTHER TAB" MUST MEAN ANOTHER TAB ──
 *
 * Round 30 (Mid-City on serve75, #1215): the banner showed with ONE tab open, from A4.1 on. Every
 * scale save (`writeCalibration`) queues the wall finder AFTER the response, and that background job
 * writes `TakeoffWallProposal` rows once this tab has already re-rendered with the new `savedAt`. The
 * signature counted proposals, so the tab's own save tripped its own stale check on the next focus.
 * Proposals are only ever written by that finder, and only after a calibration save — which changes the
 * signature by itself — so a real second tab is still caught by its calibration or measurement.
 */
let companyId = "", jobId = "", pageId = "";
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Saved Signature Co" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Signature Job", status: "ESTIMATE" } })).id;
  const planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:plan-sheet.pdf" } })).id;
  pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } })).id;
});
const signature = () => takeoffSavedSignature(companyId, jobId);
const calibrate = () => prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });

describe("the saved signature a workspace compares on focus", () => {
  it("THIS tab's scale save, then its own background wall finder: the signature the page re-rendered with still holds", async () => {
    const calibration = await calibrate(); // this tab's one-press save; the page re-renders with this signature
    const rendered = await signature();
    // ...and after the response, the finder that save queued writes its proposals.
    await prisma.takeoffWallProposal.create({ data: { pageId, calibrationId: calibration.id, thicknessInches: 4, source: "REMAINDER", runs: [{ x1: 0.2, y1: 0.6, x2: 0.5, y2: 0.6, thicknessFeet: 0.33 }] } });
    expect(await signature()).toBe(rendered);
  });
  it("A REAL second tab's scale save changes it", async () => {
    const before = await signature();
    await calibrate();
    expect(await signature()).not.toBe(before);
  });
  it("A REAL second tab's measurement changes it", async () => {
    const before = await signature();
    await prisma.takeoffMeasurement.create({ data: { pageId, kind: "COUNT", xs: [0.1], ys: [0.1] } });
    expect(await signature()).not.toBe(before);
  });
});
