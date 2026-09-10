import { describe, expect, it, vi } from "vitest";
import { serverToday } from "@/lib/serverToday";

/**
 * Issue #103, finding 5: the tool's own description already promised "how
 * old each is", and the handler never returned an age at all — only
 * `currentIssuedOn` and a list of labels. Told never to do arithmetic, the
 * model had no honest way to answer "how old is our current sheet" except
 * to subtract the date from today itself, which is exactly what this
 * design forbids.
 *
 * The fix reuses `daysToReachUs` (components/drawingLabels.ts) — the same
 * function `/drawings` already renders through `DrawingSetRow` as "N days
 * to reach us" once received, or "waiting N days" while it hasn't. Dates
 * are computed relative to `serverToday()` here rather than hardcoded, so
 * the test does not depend on which real day it happens to run on.
 */

function isoDaysAgo(days: number): string {
  const today = serverToday();
  const ms = Date.parse(`${today}T00:00:00.000Z`) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

const REV_RECEIVED_ISSUED = isoDaysAgo(20);
const REV_RECEIVED_RECEIVED = isoDaysAgo(15);
const REV_CURRENT_ISSUED = isoDaysAgo(3);

const SET = {
  name: "Level 4 Architectural",
  job: { name: "Riverside Medical" },
  revisions: [
    {
      id: "rev-1",
      label: "Rev 1",
      issuedOn: new Date(`${REV_RECEIVED_ISSUED}T00:00:00.000Z`),
      receivedOn: new Date(`${REV_RECEIVED_RECEIVED}T00:00:00.000Z`),
      description: null,
      fileUrl: null,
      fileName: null,
    },
    // The newest issue, superseding Rev 1, and never received.
    {
      id: "rev-2",
      label: "Rev 2",
      issuedOn: new Date(`${REV_CURRENT_ISSUED}T00:00:00.000Z`),
      receivedOn: null,
      description: null,
      fileUrl: null,
      fileName: null,
    },
  ],
};

vi.mock("@prova/db", () => ({
  prisma: {
    drawingSet: {
      findMany: vi.fn(async () => [SET]),
    },
    job: {
      findFirst: vi.fn(async () => ({ id: "job-1" })),
    },
  },
}));

async function askDrawingCurrency() {
  const { runTool } = await import("./handlers");
  const result = await runTool(
    { companyId: "company-1", principal: { role: "OWNER", jobFunction: null } },
    "drawing_currency",
    {},
  );
  return (result.data as Array<Record<string, unknown>>)[0];
}

describe("drawing_currency age", () => {
  it("returns how old the current (unreceived) revision is, not just its issue date", async () => {
    const row = await askDrawingCurrency();
    expect(row.buildFrom).toBe("Rev 2");
    expect(row.currentIssuedOn).toBe(REV_CURRENT_ISSUED);
    // The exact old-code gap: this field did not exist at all.
    expect(row.currentRevisionAgeInDays).toBe(3);
  });

  it("gives each not-yet-received revision its own days-waiting figure", async () => {
    const row = await askDrawingCurrency();
    expect(row.issuedButNotReceived).toEqual([
      { label: "Rev 2", issuedOn: REV_CURRENT_ISSUED, daysWaiting: 3 },
    ]);
  });
});
