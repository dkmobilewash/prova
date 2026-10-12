import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

/**
 * A waiting row that is ONE record opens THAT record (heuristic F11): the
 * job-filtered list with the row's own anchor, not the top of the list. And
 * the anchor has to exist on the row component, or the hash lands nowhere —
 * so both halves are asserted, the href from the loader and the id from the
 * component source.
 */

const db = vi.hoisted(() => ({
  rfi: { findMany: vi.fn() },
  submittal: { findMany: vi.fn() },
  materialOrder: { findMany: vi.fn() },
  bidInvitation: { findMany: vi.fn() },
  job: { findMany: vi.fn() },
}));
vi.mock("@prova/db", () => ({ prisma: db }));

import { loadAreaWaiting } from "./areas-data";

const owner = { role: "OWNER", jobFunction: null };

describe("waiting rows link to the record", () => {
  it("RFI and submittal rows land on their own row", async () => {
    db.rfi.findMany.mockResolvedValue([
      { id: "r1", number: 4, subject: "Header", jobId: "j1", sentOn: new Date("2026-10-01"), dueBy: null, job: { name: "Oak" } },
    ]);
    db.submittal.findMany.mockResolvedValue([
      {
        id: "s1",
        number: 2,
        title: "Studs",
        jobId: "j1",
        job: { name: "Oak" },
        revisions: [{ revisionNumber: 0, sentOn: new Date("2026-10-02"), dueBack: null, returnedOn: null, outcome: null, responseNotes: null, responseUrl: null, responseFileName: null }],
      },
    ]);
    const { list } = await loadAreaWaiting("paperwork", "c1", owner, "2026-10-11");
    const hrefs = list.rows.map((row) => row.href);
    expect(hrefs).toContain("/rfis?job=j1#rfi-r1");
    expect(hrefs).toContain("/submittals?job=j1#submittal-s1");
  });

  it("an open order lands on its own row", async () => {
    db.materialOrder.findMany.mockResolvedValue([
      { id: "o1", number: 7, description: "Board", jobId: "j1", orderedOn: new Date("2026-10-01"), promisedFor: null, job: { name: "Oak" }, vendor: { name: "Supply" } },
    ]);
    const { list } = await loadAreaWaiting("materials-equipment", "c1", owner, "2026-10-11");
    expect(list.rows[0]!.href).toBe("/material-orders?job=j1#order-o1");
  });

  // A bid row opens the bid's own page, not a hash on the /bids list.
  it("a bid due lands on the bid's own page", async () => {
    db.bidInvitation.findMany.mockResolvedValue([
      { id: "b1", projectName: "Oak", dueDate: new Date("2026-10-20T00:00:00.000Z"), contact: { name: "Turner" } },
    ]);
    db.job.findMany.mockResolvedValue([]);
    const { list } = await loadAreaWaiting("jobs-bids", "c1", owner, "2026-10-11");
    expect(list.rows[0]!.href).toBe("/ai/bids/b1");
  });

  it("each row component carries the id the hash points at", () => {
    const source = (file: string) => readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");
    expect(source("RfiRow.tsx")).toContain("id={`rfi-${rfi.id}`}");
    expect(source("SubmittalRow.tsx")).toContain("id={`submittal-${submittal.id}`}");
    expect(source("MaterialOrderRow.tsx")).toContain("id={`order-${order.id}`}");
    expect(source("LienDeadlinesBoard.tsx")).toContain("id={`lien-${row.id}`}");
  });
});
