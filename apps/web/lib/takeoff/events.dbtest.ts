import { beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@prova/db";

/**
 * Takeoff events from the real actions, end to end on a scratch database: the
 * auto-post rule, Enter with a pick and a typed height, Accept all as one press,
 * Skip, Undo, a later Set type and Clear type, and the signing link. Then the
 * per-job figures read back, and the rows hold nothing off the drawing.
 */
const context = { company: { id: "" }, id: "", role: "OWNER" as string, jobFunction: null as string | null };
vi.mock("@/lib/auth", () => ({ requireCompanyContext: async () => context }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("./autoPost", async (actual) => ({ ...(await actual<typeof import("./autoPost")>()), autoPosts: (source: string) => source === "tag" }));
const { wallItemsForSheet } = await import("@/lib/plan-ingest/wallItems");
const { confirmSheetSuggestions, undoSheetSuggestions, setWallGroupType, clearWallGroupType, undoAutoPost } = await import("@/lib/actions/wallGroupType");
const { recordQueueSkip } = await import("@/lib/actions/takeoffEvents");
const { createSignatureRequest } = await import("@/lib/actions/billing");
const { loadJobAutomation } = await import("./eventStatsQuery");
const { groupTarget } = await import("./eventTarget");

let companyId = "";
let jobId = "";
let planId = "";
const tagged = [{ x1: 0.2, y1: 0.2, x2: 0.5, y2: 0.2, thicknessFeet: 0.5 }];
const g1 = [{ x1: 0.1, y1: 0.5, x2: 0.4, y2: 0.5 }];
const g2 = [{ x1: 0.1, y1: 0.7, x2: 0.4, y2: 0.7 }];
const g3 = [{ x1: 0.1, y1: 0.9, x2: 0.4, y2: 0.9 }];
const g4 = [{ x1: 0.6, y1: 0.5, x2: 0.9, y2: 0.5 }];
const kinds = async () => (await prisma.takeoffEvent.findMany({ where: { jobId }, orderBy: { createdAt: "asc" }, select: { kind: true } })).map((e) => e.kind);

beforeAll(async () => {
  companyId = (await prisma.company.create({ data: { name: "Events Co", autoPostOn: true } })).id;
  context.company.id = companyId;
  context.id = (await prisma.user.create({ data: { companyId, clerkId: `events_${Date.now()}`, email: `events_${Date.now()}@example.test`, role: "OWNER" } })).id;
  const contact = await prisma.contact.create({ data: { companyId, name: "GC" } });
  jobId = (await prisma.job.create({ data: { companyId, contactId: contact.id, name: "Events Job", status: "ESTIMATE" } })).id;
  planId = (await prisma.takeoffPlan.create({ data: { companyId, jobId, fileUrl: "local:x.pdf", fileName: "x.pdf" } })).id;
  await prisma.wallType.create({ data: { companyId, code: "A1", name: "Partition A1", thicknessIn: 6, defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
  await prisma.wallType.create({ data: { companyId, code: "B2", name: "Partition B2", defaultHeightFt: 10, sides: 2, components: { create: [{ description: "studs", basis: "LINEAR_FT", factor: 1 }] } } });
  const page = await prisma.takeoffPlanPage.create({ data: { planId, pageNumber: 1 } });
  const cal = await prisma.takeoffScaleCalibration.create({ data: { pageId: page.id, x1: 0, y1: 0, x2: 1, y2: 0, declaredDistanceFeet: "100" } });
  await prisma.takeoffWallProposal.createMany({ data: [
    { pageId: page.id, calibrationId: cal.id, thicknessInches: 6, source: "TAG", sourceLabel: "A1", namedCode: "A1", runs: tagged },
    ...[g1, g2, g3, g4].map((runs, i) => ({ pageId: page.id, calibrationId: cal.id, thicknessInches: 4 + i, source: "REMAINDER" as const, runs: runs.map((r) => ({ ...r, thicknessFeet: (4 + i) / 12 })) })),
  ] });
});

const group = (runs: typeof g1, code: string, inches: number, event?: { source?: string; picked?: boolean; heightEdited?: boolean }) => ({ planId, pageNumber: 1, code, inches, runs, heightFt: 10, level: null, event });

describe("takeoff events, from the real actions", () => {
  it("the auto-post rule records one AUTO_POST, with its source and the group's target", async () => {
    expect((await wallItemsForSheet({ planId, companyId, jobId, pageNumber: 1, userId: null })).kind).toBe("written");
    const auto = await prisma.takeoffEvent.findFirstOrThrow({ where: { jobId, kind: "AUTO_POST" } });
    expect(auto).toMatchObject({ companyId, planId, pageNumber: 1, source: "tag", target: groupTarget(planId, 1, tagged) });
  });

  it("Enter with a pick and a typed height: ACCEPT, PICK and HEIGHT_EDIT on one target; Accept all is one batch", async () => {
    const one = await confirmSheetSuggestions(jobId, [group(g1, "B2", 4, { source: "thickness", picked: true, heightEdited: true })]);
    expect(one.ok && one.value.accepted).toBe(1);
    const rows = await prisma.takeoffEvent.findMany({ where: { jobId, target: groupTarget(planId, 1, g1) }, select: { kind: true, source: true } });
    expect(rows.map((r) => r.kind).sort()).toEqual(["ACCEPT", "HEIGHT_EDIT", "PICK"]);
    expect(rows.find((r) => r.kind === "ACCEPT")!.source).toBe("thickness");
    const all = await confirmSheetSuggestions(jobId, [group(g2, "B2", 5, { source: "none" }), group(g3, "B2", 6, { source: "none" })], "accept_all");
    expect(all.ok && all.value.accepted).toBe(2);
    const batch = await prisma.takeoffEvent.findMany({ where: { jobId, kind: "ACCEPT_ALL" }, select: { batch: true } });
    expect(batch).toHaveLength(2);
    expect(new Set(batch.map((b) => b.batch)).size).toBe(1);
    // Undo of that Accept all: one UNDO per group it took.
    expect(all.ok && (await undoSheetSuggestions(jobId, all.value.undo)).ok).toBe(true);
    expect(await prisma.takeoffEvent.count({ where: { jobId, kind: "UNDO" } })).toBe(2);
  });

  it("Skip, a later Set type and Clear type, Undo of the auto-post, and the signing link are recorded", async () => {
    expect(await recordQueueSkip(jobId, { planId, pageNumber: 1, runs: g4 })).toEqual({ ok: true });
    expect(await setWallGroupType(jobId, { planId, pageNumber: 1, code: "A1", inches: 4, runs: g1 })).toEqual({ ok: true });
    expect((await clearWallGroupType(jobId, { planId, pageNumber: 1, runs: g1 })).ok).toBe(true);
    expect((await undoAutoPost(jobId, planId, 1)).ok).toBe(true);
    await createSignatureRequest(jobId);
    expect(await kinds()).toEqual(expect.arrayContaining(["SKIP", "CHANGE", "CHANGE", "UNDO", "SEND"]));
    expect(await prisma.takeoffEvent.count({ where: { jobId, kind: "UNDO", target: groupTarget(planId, 1, tagged) } })).toBe(1);
  });

  it("the job's figures: touches, auto-posted, accepted, changed after accepting, minutes to send", async () => {
    // Another company's job, with an event of its own: never in this company's figures.
    const other = (await prisma.company.create({ data: { name: "Other Events Co" } })).id;
    const otherGc = await prisma.contact.create({ data: { companyId: other, name: "GC" } });
    const otherJob = await prisma.job.create({ data: { companyId: other, contactId: otherGc.id, name: "Their job", status: "ESTIMATE" } });
    await prisma.takeoffEvent.create({ data: { companyId: other, jobId: otherJob.id, kind: "ACCEPT" } });
    const rows = await loadJobAutomation(companyId);
    expect(rows.map((r) => r.jobId)).toEqual([jobId]);
    const [row] = rows;
    // Touches: ACCEPT, PICK, HEIGHT_EDIT (3) + one Accept all press + 2 UNDO + SKIP + 2 CHANGE + 1 UNDO (auto) = 10.
    // Changed after accepting: g1 (Set type, Clear), g2 and g3 (undone), the auto-posted group (undone) = 4.
    expect(row).toMatchObject({ touches: 10, autoPosted: 1, accepted: 3, changedAfterAccept: 4 });
    expect(row!.minutesToSend).not.toBeNull();
  });

  it("NO PLAN CONTENT: every source is a code, every target a 16-hex hash, and nothing else but ids and times", async () => {
    const rows = await prisma.takeoffEvent.findMany({ where: { jobId } });
    for (const r of rows) {
      expect(Object.keys(r).sort()).toEqual(["batch", "companyId", "createdAt", "id", "jobId", "kind", "pageNumber", "planId", "source", "target", "userId"]);
      expect(r.companyId).toBe(companyId);
      if (r.target !== null) expect(r.target).toMatch(/^[0-9a-f]{16}$/);
      if (r.source !== null) expect(["tag", "tag-variant", "carried", "sibling", "note", "thickness", "none"]).toContain(r.source);
    }
  });
});
