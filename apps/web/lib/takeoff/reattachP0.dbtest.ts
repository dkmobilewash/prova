import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { wallItemsForSheet } from "@/lib/plan-ingest/wallItems";
import { DROPPED_ITEM, DROPPED_LABEL, HELD_ITEM, KEPT_LABEL } from "./estimateHold";
import { UNTYPED_ITEM } from "./untypedItem";

/**
 * ── A PERSON'S DECISION IS NEVER DELETED OR SILENTLY RESET BY A FINDER RE-RUN OR A DEPLOY ──
 *
 * P0, prereg-reattach-P0.md (amendment 1). refreshSheetWalls deleted every DETECTED row,
 * re-created them from the new reading and gave a person's kept/dropped back only on an
 * EXACT (1e-9) coordinate match. After a deploy that moved runs, a dropped wall went back
 * on the estimate. Detection is injected: each case writes the new reading as a proposal.
 * 100 ft per page width, so 0.003 = 0.3 ft.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const pending: Promise<unknown>[] = [];
vi.mock("next/server", async (actual) => ({ ...(await actual<object>()), after: (work: () => Promise<unknown>) => void pending.push(work()) }));
vi.mock("./detectWallsForCalibration", () => ({
  oneFinderSlot: <T,>(work: () => Promise<T>) => work(),
  detectWallsForCalibration: async (t: { onBoundary?: (b: unknown) => void }) => {
    t.onBoundary?.({ pairings: [], segments: [], held: [] });
    return "written";
  },
}));
const { refreshSheetWalls } = await import("./refreshSheetWalls");
const { addSheetExclusion } = await import("@/lib/actions/takeoffExclusions");

type Run = { x1: number; y1: number; x2: number; y2: number; thicknessFeet: number };
const r = (x1: number, x2: number, y: number): Run => ({ x1, y1: y, x2, y2: y, thicknessFeet: 0.33 });
// Every end moved 0.3 ft: 0.212 ft along and 0.212 ft across.
const shift = (run: Run): Run => ({ ...run, x1: run.x1 + 0.00212, x2: run.x2 + 0.00212, y1: run.y1 + 0.00212, y2: run.y2 + 0.00212 });

let companyId = "";
let jobId = "";
let planId = "";
let n = 0;
beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Reattach P0 Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `p0_${Date.now()}`, email: `p0_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "P0 Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:p0.pdf" } })).id;
});

/** A sheet posted from `runs`, with A kept, B dropped and C typed by hand; D is the model's. */
async function decidedSheet(runs: { A: Run; B: Run; C: Run; D: Run }) {
  n += 1;
  const pageId = (await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: n } })).id;
  const calibrationId = (await prisma.takeoffScaleCalibration.create({ data: { pageId, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } })).id;
  await prisma.takeoffWallProposal.create({ data: { pageId, calibrationId, thicknessInches: 4, source: "REMAINDER", runs: Object.values(runs) } });
  await wallItemsForSheet({ planId, companyId, jobId, pageNumber: n, userId: null, held: [] });
  const item = async (name: string) => (await prisma.takeoffItem.findFirst({ where: { jobId, name } }))?.id ?? (await prisma.takeoffItem.create({ data: { companyId, jobId, name, type: "LINEAR", colorHex: "#888888" } })).id;
  const on = async (run: Run) => (await prisma.takeoffMeasurement.findFirstOrThrow({ where: { pageId, source: "DETECTED", xs: { has: run.x1 }, ys: { has: run.y1 } } })).id;
  await prisma.takeoffMeasurement.update({ where: { id: await on(runs.A) }, data: { label: KEPT_LABEL, itemId: await item(UNTYPED_ITEM) } });
  await prisma.takeoffMeasurement.update({ where: { id: await on(runs.B) }, data: { label: DROPPED_LABEL, itemId: await item(DROPPED_ITEM) } });
  await prisma.takeoffMeasurement.update({ where: { id: await on(runs.C) }, data: { label: "C wall (set by hand)", itemId: await item("C walls") } });
  return { pageId, calibrationId, pageNumber: n };
}
/** What each place holds, and the feet the estimate carries per item (dropped and held carry none). */
async function state(pageId: string) {
  const rows = await prisma.takeoffMeasurement.findMany({ where: { pageId, source: "DETECTED" }, select: { xs: true, ys: true, label: true, item: { select: { name: true } } } });
  const feet: Record<string, number> = {};
  for (const m of rows) {
    const name = m.item?.name ?? "none";
    if (name === DROPPED_ITEM || name === HELD_ITEM) continue;
    feet[name] = Math.round(((feet[name] ?? 0) + Math.hypot(m.xs[1]! - m.xs[0]!, m.ys[1]! - m.ys[0]!) * 100) * 1000) / 1000;
  }
  const at = (y: number) => rows.filter((m) => Math.abs(m.ys[0]! - y) < 0.01).map((m) => [m.label, m.item?.name]);
  return { rows: rows.length, feet, at };
}
const runs = { A: r(0.1, 0.22, 0.2), B: r(0.1, 0.22, 0.4), C: r(0.1, 0.22, 0.6), D: r(0.1, 0.3, 0.8) };

describe("a deploy that moves every run end 0.3 ft", () => {
  it("keeps every kept, dropped and typed decision, and the estimate's feet per item do not change", async () => {
    const sheet = await decidedSheet(runs);
    const before = await state(sheet.pageId);
    await prisma.takeoffWallProposal.create({ data: { pageId: sheet.pageId, calibrationId: sheet.calibrationId, thicknessInches: 4, source: "REMAINDER", runs: Object.values(runs).map(shift) } });
    await refreshSheetWalls({ pageId: sheet.pageId, calibrationId: sheet.calibrationId, planId, companyId, pageNumber: sheet.pageNumber, feetPerUnit: 100, wallTypes: [], jobId, userId: null });
    const after = await state(sheet.pageId);
    expect([after.at(0.2), after.at(0.4), after.at(0.6)]).toEqual([[[KEPT_LABEL, UNTYPED_ITEM]], [[DROPPED_LABEL, DROPPED_ITEM]], [["C wall (set by hand)", "C walls"]]]);
    expect(after.feet).toEqual(before.feet);
    expect(after.rows).toBe(4);
  });
});

describe("adding an exclusion after such a deploy", () => {
  it("keeps the decisions", async () => {
    const sheet = await decidedSheet(runs);
    await prisma.takeoffWallProposal.create({ data: { pageId: sheet.pageId, calibrationId: sheet.calibrationId, thicknessInches: 4, source: "REMAINDER", runs: Object.values(runs).map(shift) } });
    expect((await addSheetExclusion(jobId, sheet.pageId, "WORK_AREA", [0, 0.9, 0.9, 0], [0, 0, 0.9, 0.9])).ok).toBe(true);
    await Promise.all(pending.splice(0));
    const after = await state(sheet.pageId);
    expect([after.at(0.2), after.at(0.4), after.at(0.6)]).toEqual([[[KEPT_LABEL, UNTYPED_ITEM]], [[DROPPED_LABEL, DROPPED_ITEM]], [["C wall (set by hand)", "C walls"]]]);
  });
});

describe("a decided row the new reading no longer has", () => {
  it("is kept exactly as it was and flagged as needing a look, never deleted or flipped", async () => {
    const sheet = await decidedSheet(runs);
    // B (dropped) is gone from the new reading; the rest moved 0.3 ft.
    await prisma.takeoffWallProposal.create({ data: { pageId: sheet.pageId, calibrationId: sheet.calibrationId, thicknessInches: 4, source: "REMAINDER", runs: [runs.A, runs.C, runs.D].map(shift) } });
    const outcome = await refreshSheetWalls({ pageId: sheet.pageId, calibrationId: sheet.calibrationId, planId, companyId, pageNumber: sheet.pageNumber, feetPerUnit: 100, wallTypes: [], jobId, userId: null });
    expect(outcome).toMatchObject({ kind: "replaced", needsLook: 1 });
    const kept = await prisma.takeoffMeasurement.findMany({ where: { pageId: sheet.pageId, source: "DETECTED", label: DROPPED_LABEL }, select: { xs: true, ys: true } });
    expect(kept).toEqual([{ xs: [runs.B.x1, runs.B.x2], ys: [runs.B.y1, runs.B.y2] }]);
  });
});
