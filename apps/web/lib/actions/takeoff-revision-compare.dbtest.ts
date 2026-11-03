import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";
import { synthesiseSheet, type WallSpec } from "@/lib/takeoff/syntheticSheet";

const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
const { compareSheetRevision } = await import("./takeoffRevisions");

// Two issues of one invented sheet: the second takes out the wall at x = 40 ft
// and puts one in at x = 100 ft. 9 points to the foot, from 80 points in.
const wall = (x: number, y: number, dir: WallSpec["direction"], len: number): WallSpec => ({ fromFeet: { x, y }, direction: dir, lengthFeet: len, thicknessFeet: 0.5 });
const base = [wall(0, 0, "horizontal", 160), wall(0, 80, "horizontal", 160), wall(0, 0, "vertical", 80), wall(160, 0, "vertical", 80), wall(80, 0, "vertical", 80)];
const v1 = [...base, wall(40, 0, "vertical", 80)];
const v2 = [...base, wall(100, 0, "vertical", 80)];
const W = 2592, H = 1728;
const ux = (feet: number) => (80 + 9 * feet) / W, uy = (feet: number) => (H - 80 - 9 * feet) / W;

let dir = "", companyId = "", jobId = "", oldPlan = "", newPlan = "";
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "revcompare-"));
  process.env.TAKEOFF_LOCAL_PLAN_DIR = dir;
  writeFileSync(join(dir, "v1.pdf"), synthesiseSheet({ id: "v1", sheetSize: "ARCH_D", sheetNumber: "A101", symbols: [], walls: v1 }));
  writeFileSync(join(dir, "v2.pdf"), synthesiseSheet({ id: "v2", sheetSize: "ARCH_D", sheetNumber: "A101", symbols: [], walls: v2 }));
  companyId = (await prisma.company.create({ data: { name: "Revision Co" } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `rv_${Date.now()}`, email: `rv_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Revision", status: "ESTIMATE" } })).id;
  oldPlan = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:v1.pdf", fileName: "bid set.pdf", createdAt: new Date("2026-10-01") } })).id;
  newPlan = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:v2.pdf", fileName: "addendum 1.pdf", revisionLabel: "Addendum 1", createdAt: new Date("2026-10-15") } })).id;
  const oldPage = await prisma.takeoffPlanPage.create({ data: { planId: oldPlan, pageNumber: 1, label: "A101" } });
  await prisma.takeoffPlanPage.create({ data: { planId: newPlan, pageNumber: 1, label: "A-101" } });
  const calibrationId = (await prisma.takeoffScaleCalibration.create({ data: { pageId: oldPage.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: String(W / 9) } as never })).id;
  const item = (name: string) => prisma.takeoffItem.create({ data: { companyId, jobId, name, type: "LINEAR", colorHex: "#112233" } });
  const [walls, base] = [await item("A walls"), await item("Base")];
  const line = (itemId: string, xs: number[], ys: number[]) => prisma.takeoffMeasurement.create({ data: { itemId, pageId: oldPage.id, calibrationId, kind: "LINEAR", xs, ys, createdByUserId: context.id } });
  await line(walls.id, [ux(40), ux(40)], [uy(0), uy(80)]); // along the wall the addendum removed
  await line(walls.id, [ux(80), ux(80)], [uy(0), uy(80)]); // along a wall that stayed
  await line(base.id, [ux(0), ux(160)], [uy(80), uy(80)]); // the top wall, which both walls meet
});
afterAll(async () => {
  await prisma.takeoffMeasurement.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffItem.deleteMany({ where: { jobId } });
  await prisma.takeoffScaleCalibration.deleteMany({ where: { page: { plan: { jobId } } } });
  await prisma.takeoffPlanPage.deleteMany({ where: { plan: { jobId } } });
  await prisma.takeoffPlan.deleteMany({ where: { jobId } });
  await prisma.job.deleteMany({ where: { companyId } });
  await prisma.contact.deleteMany({ where: { companyId } });
  await prisma.user.deleteMany({ where: { companyId } });
  await prisma.company.deleteMany({ where: { id: companyId } });
});

describe("comparing a sheet with the version it replaced", () => {
  // Each wall is drawn as its two faces, half a foot apart, so a wall at 40 ft reads 40 and 40.5.
  it("finds the earlier A101 by its sheet number, and the wall moved", async () => {
    const r = await compareSheetRevision(jobId, newPlan, 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.earlier).toBe("bid set.pdf");
    const xs = (ss: { x1: number; x2: number }[]) => [...new Set(ss.map((s) => Math.floor(((s.x1 + s.x2) / 2 * W - 80) / 9)))].sort((a, b) => a - b);
    expect(xs(r.value.removed)).toEqual([40]);
    expect(xs(r.value.added)).toEqual([100]);
  });
  it("names the items measured through a change, and how many of their measurements", async () => {
    const r = await compareSheetRevision(jobId, newPlan, 1);
    if (!r.ok) throw new Error(r.error);
    expect(r.value.changedItems).toEqual([{ name: "A walls", changed: 1, total: 2 }, { name: "Base", changed: 1, total: 1 }]);
  });
  it("says so for a sheet with no earlier version", async () => {
    const r = await compareSheetRevision(jobId, oldPlan, 1);
    expect(r).toEqual({ ok: false, error: "No earlier version of this sheet is on the job." });
  });
});
