import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

// Counted windows are a suggestion: on the queue until confirmed, and only the kept ones post.
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { confirmWindows, undoConfirmWindows } = await import("./symbolCount");
const { loadReviewQueue } = await import("@/lib/takeoff/reviewQueueQuery");
const { WINDOWS_SUGGESTED } = await import("@/lib/takeoff/windowTags");

let companyId = "", jobId = "", planId = "";
const w = (tag: string, x: number) => ({ tag, x1: x, y1: 0.2, x2: x + 0.04, y2: 0.2 });
beforeAll(async () => {
  const company = await prisma.company.create({ data: { name: "Windows Confirm Test Co" } });
  companyId = company.id;
  context.company.id = companyId;
  const owner = await prisma.user.create({ data: { companyId, clerkId: `winc_${Date.now()}`, email: `winc_${Date.now()}@example.test`, role: "OWNER" } });
  context.id = owner.id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Windows", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:none.pdf", fileName: "none.pdf" } })).id;
  await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 4, kind: WINDOWS_SUGGESTED, value: { windows: [w("A", 0.1), w("A", 0.2), w("B", 0.3)] } } });
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { planId } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffPlan.deleteMany({ where: { id: planId } });
  await prisma.job.deleteMany({ where: { id: jobId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.delete({ where: { id: companyId } });
});

describe("confirming a sheet's counted windows", () => {
  it("is on the queue, and nothing is on the takeoff before it is confirmed", async () => {
    const queue = await loadReviewQueue(companyId, jobId);
    expect(queue.items.filter((i) => i.kind === "windows").map((i) => i.key)).toEqual(["windows:4"]);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(0);
  });

  it("posts only the kept windows, one count per type, and leaves the queue", async () => {
    // The second A was a false hit, dropped in the queue.
    expect(await confirmWindows(jobId, planId, 4, [0, 2])).toMatchObject({ ok: true });
    const counts = await prisma.takeoffMeasurement.findMany({ where: { kind: "COUNT", page: { planId } }, select: { label: true, xs: true, item: { select: { name: true, type: true } } }, orderBy: { label: "asc" } });
    expect(counts.map((c) => [c.label, c.xs.length, c.item?.name, c.item?.type])).toEqual([
      ["Windows — A", 1, "Windows — A", "COUNT"],
      ["Windows — B", 1, "Windows — B", "COUNT"],
    ]);
    expect((await loadReviewQueue(companyId, jobId)).items.some((i) => i.kind === "windows")).toBe(false);
  });

  it("posts once: confirming again adds nothing, and an index that is not a window is refused", async () => {
    expect(await confirmWindows(jobId, planId, 4, [0, 1, 2])).toMatchObject({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { planId } } })).toBe(2);
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 5, kind: WINDOWS_SUGGESTED, value: { windows: [w("A", 0.1)] } } });
    expect(await confirmWindows(jobId, planId, 5, [3])).toMatchObject({ ok: false });
  });
});

describe("Undo of a window confirm (Chrome on Baker: \"Confirm 9\" could not be undone)", () => {
  it("TAKES THE COUNTS AND THE ITEMS IT MADE BACK, and the windows are on the queue again after a reload", async () => {
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 6, kind: WINDOWS_SUGGESTED, value: { windows: [w("W1", 0.1), w("W1", 0.2), w("W9", 0.3)] } } });
    const before = await prisma.takeoffItem.count({ where: { jobId } });
    const confirmed = await confirmWindows(jobId, planId, 6, [0, 1, 2]);
    if (!confirmed.ok) throw new Error(confirmed.error);
    expect(await prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { planId, pageNumber: 6 } } })).toBe(2);
    expect(confirmed.value.undo.items).toHaveLength(2);
    expect(await undoConfirmWindows(jobId, planId, 6, confirmed.value.undo)).toEqual({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { planId, pageNumber: 6 } } })).toBe(0);
    expect(await prisma.takeoffItem.count({ where: { jobId } })).toBe(before);
    // "Reload": the queue is read again from the database.
    expect((await loadReviewQueue(companyId, jobId)).items.filter((i) => i.kind === "windows").map((i) => i.key)).toContain("windows:6");
    // And confirmed again (Redo), it posts again.
    expect(await confirmWindows(jobId, planId, 6, [0, 1, 2])).toMatchObject({ ok: true });
    expect(await prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { planId, pageNumber: 6 } } })).toBe(2);
  });

  it("keeps a count item that was there before, and touches nothing a forged claim names", async () => {
    // Page 4's "Windows — A" exists already; a confirm on page 7 adds to it rather than making it.
    await prisma.takeoffPlanTextRead.create({ data: { planId, pageNumber: 7, kind: WINDOWS_SUGGESTED, value: { windows: [w("A", 0.5)] } } });
    const confirmed = await confirmWindows(jobId, planId, 7, [0]);
    if (!confirmed.ok) throw new Error(confirmed.error);
    expect(confirmed.value.undo.items).toEqual([]);
    const aItem = await prisma.takeoffItem.findFirstOrThrow({ where: { jobId, name: "Windows — A" }, select: { id: true } });
    const page4 = await prisma.takeoffMeasurement.findFirstOrThrow({ where: { kind: "COUNT", page: { planId, pageNumber: 4 } }, select: { id: true } });
    // A forged undo naming page 4's count and the A item, sent for page 7.
    await undoConfirmWindows(jobId, planId, 7, { measurements: [...confirmed.value.undo.measurements, page4.id], items: [aItem.id] });
    expect(await prisma.takeoffMeasurement.count({ where: { id: page4.id } })).toBe(1);
    expect(await prisma.takeoffItem.count({ where: { id: aItem.id } })).toBe(1);
    expect(await prisma.takeoffMeasurement.count({ where: { kind: "COUNT", page: { planId, pageNumber: 7 } } })).toBe(0);
  });
});
